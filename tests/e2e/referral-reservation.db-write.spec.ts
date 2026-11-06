import { expect, test } from "@playwright/test";

import { loginGateway, resolveE2eGateway, type GatewaySession } from "./support/gateway";
import { prepareReservationData, type ReservationTestData } from "./support/reservationData";

/**
 * DB 변경 E2E: 슬롯 검색 → 예약 가능한 슬롯 선택 → 검사 의뢰 입력·제출 → 의뢰 목록 → 예약 확정.
 *
 * 실행 조건: E2E_ALLOW_DB_WRITE=1 + E2E 전용 프론트(E2E_BASE_URL, config가 docker로 확인) + E2E 전용 Gateway(E2E_GATEWAY_URL, 여기서 확인)
 *   예: E2E_BASE_URL=http://127.0.0.1:3002 E2E_GATEWAY_URL=http://127.0.0.1:18080 E2E_ALLOW_DB_WRITE=1 E2E_TEST_PASSWORD=...
 *       npx playwright test tests/e2e/referral-reservation.db-write.spec.ts   (이 파일만 지정해서 실행한다)
 *
 * 확정 흐름 (백엔드 referral-service SlotResultService): POST /api/v1/referrals 201 = 접수(의뢰 PENDING·예약 REQUESTED)
 *   → Kafka: 슬롯 HOLD → 예약 HELD → BOOK → 예약 CONFIRMED·의뢰 CONFIRMED (검사기관이 따로 승인하지 않는다).
 *   비동기라 고정 sleep 대신 화면의 [상태 새로고침](조회만)과 조회 API를 조건이 맞을 때까지 다시 확인한다.
 *
 * 데이터: 검사 유형·장비·운영시간·슬롯 1개를 실행 ID 이름으로 실제 API로 만든다 (support/reservationData.ts).
 * 삭제 API가 없어 정리하지 않는다 (E2E 전용 DB에만 남는다).
 */

const password = process.env.E2E_TEST_PASSWORD ?? "";
const PARTNER_EXAMINER = "B영상의학과";
/** 비동기 확정 대기 상한 (Kafka HOLD → BOOK) */
const CONFIRM_TIMEOUT_MS = 90_000;

test.describe.configure({ mode: "serial" });

test.describe("의뢰 생성 → 예약 확정 (DB 변경)", () => {
  let data: ReservationTestData;
  let requester: GatewaySession;

  test.beforeAll(async () => {
    if (process.env.E2E_ALLOW_DB_WRITE !== "1") throw new Error("E2E_ALLOW_DB_WRITE=1일 때만 실행합니다.");
    if (!password) throw new Error("E2E_TEST_PASSWORD가 없어 실행하지 않습니다 (건너뛰지 않고 실패로 둡니다).");
    const gateway = resolveE2eGateway();
    const [admin, examiner] = await Promise.all([loginGateway(gateway, "admin", password), loginGateway(gateway, "imaging_b", password)]);
    requester = await loginGateway(gateway, "clinic_a", password);
    data = await prepareReservationData({ admin, examiner });
    console.log(`[e2e] 실행 ID ${data.runId}: 검사 유형 "${data.examTypeName}", 장비 "${data.equipmentName}", 슬롯 ${data.slotDate} (${data.slotId})`);
  });

  test("clinic_a: B영상의학과 슬롯 선택 → 의뢰·예약 요청 → 예약 확정 (화면·조회 API)", async ({ page }) => {
    await test.step("clinic_a 로그인", async () => {
      await page.goto("/login");
      await page.getByLabel("로그인 ID").fill("clinic_a");
      await page.getByLabel("비밀번호").fill(password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(page).toHaveURL(/\/referring(?:\/|$)/, { timeout: 20_000 });
      await expect(page.locator("header").getByText("의뢰기관 담당자 · clinic_a", { exact: true })).toBeVisible();
    });

    const results = page.locator('section[aria-labelledby="slot-result-title"]');
    await test.step("슬롯 검색: B영상의학과 + 이번 실행의 세부 검사 항목 → 예약 가능한 슬롯 1건", async () => {
      await page.goto("/referring/slots");
      await page.locator("#slot-organization").selectOption({ label: PARTNER_EXAMINER });
      await page.locator("#slot-exam-type").selectOption("CT");
      await page.locator("#slot-exam-item").selectOption({ label: data.examTypeName });
      const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/referring/slots/search");
      await page.getByRole("button", { name: "슬롯 검색", exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(results.getByText("총 1건의 검색 결과가 있습니다.")).toBeVisible();
    });

    const dialog = page.getByRole("dialog", { name: "새 검사 의뢰" });
    await test.step("예약 가능한 슬롯 선택 → 새 검사 의뢰 창에 선택한 슬롯 표시", async () => {
      const row = results.getByRole("row").filter({ hasText: data.examTypeName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(PARTNER_EXAMINER);
      await row.getByRole("button", { name: "예약 요청" }).click();
      await expect(dialog).toBeVisible();
      const selected = dialog.getByRole("region", { name: "선택한 검사 슬롯" });
      await expect(selected).toContainText(PARTNER_EXAMINER);
      await expect(selected).toContainText(data.examTypeName);
      await expect(selected).toContainText(data.equipmentName);
    });

    await test.step("환자 이름 입력 → 의뢰·예약 요청 → 접수", async () => {
      await dialog.getByLabel("환자 이름").fill(data.patientName);
      await dialog.getByRole("button", { name: "의뢰·예약 요청" }).click();
      await expect(dialog.locator("#referral-progress-title")).toBeVisible({ timeout: 20_000 });
    });

    await test.step("예약 확정까지 대기 (조건 기반: [상태 새로고침]으로 실제 의뢰·예약을 다시 조회)", async () => {
      const title = dialog.locator("#referral-progress-title");
      await expect
        .poll(
          async () => {
            const text = (await title.innerText()).trim();
            if (text === "예약 확정" || text === "예약 실패" || text === "상태 확인 필요") return text;
            const refresh = dialog.getByRole("button", { name: "상태 새로고침" });
            if (await refresh.isEnabled()) await refresh.click();
            return text;
          },
          { timeout: CONFIRM_TIMEOUT_MS, intervals: [2_000, 3_000, 5_000] },
        )
        .toBe("예약 확정");
      await expect(dialog.getByText("의뢰 상태 CONFIRMED · 예약 상태 CONFIRMED")).toBeVisible();
    });

    await test.step("의뢰·예약 관리 목록: 이번 환자 의뢰가 '확정'", async () => {
      await page.goto("/referring/referrals");
      const row = page.getByRole("row").filter({ hasText: data.patientName });
      await expect(row).toHaveCount(1, { timeout: 20_000 });
      await expect(row).toContainText(PARTNER_EXAMINER);
      await expect(row).toContainText("확정");
    });

    await test.step("조회 API(E2E Gateway, GET만): 의뢰 CONFIRMED · 예약 CONFIRMED · 선택한 슬롯 BOOKED", async () => {
      const page0 = await requester.get<{ contents: { id: string; patientName: string; referralStatus: string; examTypeId: string; currentReservationId: string | null }[] }>(
        "/api/v1/referrals",
        { patientName: data.patientName, page: 0, size: 10 },
      );
      const referrals = page0.contents.filter((item) => item.patientName === data.patientName);
      expect(referrals).toHaveLength(1);
      const [referral] = referrals;
      expect(referral.referralStatus).toBe("CONFIRMED");
      expect(referral.examTypeId.toLowerCase()).toBe(data.examTypeId.toLowerCase());
      expect(referral.currentReservationId).toBeTruthy();

      const reservation = await requester.get<{ referralId: string; slotId: string | null; examInstitutionId: string | null; reservationStatus: string }>(
        `/api/v1/referrals/reservations/${referral.currentReservationId}`,
      );
      expect(reservation.reservationStatus).toBe("CONFIRMED");
      expect(reservation.referralId.toLowerCase()).toBe(referral.id.toLowerCase());
      expect(reservation.slotId?.toLowerCase()).toBe(data.slotId.toLowerCase());

      const slot = await requester.get<{ id: string; status: string }>(`/api/v1/slots/${data.slotId}`);
      expect(slot.status).toBe("BOOKED");
    });
  });
});
