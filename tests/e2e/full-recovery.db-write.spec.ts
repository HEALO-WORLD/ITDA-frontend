import { expect, test } from "@playwright/test";

import { loginGateway, resolveE2eGateway, type GatewaySession } from "./support/gateway";
import {
  ASYNC_TIMEOUT_MS,
  createConfirmedReferralViaUi,
  findRescheduleCard,
  loginUi,
  PARTNER_EXAMINER,
  POLL_INTERVALS,
  registerDowntimeViaUi,
  type ConfirmedReferral,
} from "./support/referralFlow";
import { prepareAlternativeSlot, prepareReservationData, type AlternativeSlotData, type ReservationTestData } from "./support/reservationData";

/**
 * DB 변경 E2E: 예약 확정 → 장비 A 장애 → 재조정 필요 → 장비 B 대체 슬롯 선택 → 재예약 확정.
 *
 * 실행 조건: E2E_ALLOW_DB_WRITE=1 + E2E 전용 프론트(E2E_BASE_URL, config가 docker로 확인) + E2E 전용 Gateway(E2E_GATEWAY_URL, support/gateway가 확인)
 *   예: E2E_BASE_URL=http://127.0.0.1:3002 E2E_GATEWAY_URL=http://127.0.0.1:18080 E2E_ALLOW_DB_WRITE=1 E2E_TEST_PASSWORD=...
 *       npx playwright test full-recovery.db-write   (이 파일만 지정해서 실행한다)
 *
 * 재예약 정책 (referral-service ReferralService.createRescheduledReservation·SlotResultService 기준)
 * - POST /api/v1/referrals/{id}/reschedule (REQUESTER·작성자 본인): 의뢰가 NEEDS_RESCHEDULE이고 협약 ACTIVE일 때만.
 *   새 예약(REQUESTED)을 만들고 의뢰 NEEDS_RESCHEDULE → PENDING, currentReservationId = 새 예약 (201 = 접수)
 * - Kafka: 새 슬롯 HOLD → 새 예약 HELD → BOOK → 새 예약 CONFIRMED · 의뢰 CONFIRMED
 * - 기존 예약은 BLOCKED 그대로 남는다 (새 예약으로 덮어쓰지 않는다). 기존 슬롯(BOOKED)도 바꾸지 않는다
 * 화면: 재조정·알림 → [새 슬롯 검색] → 대체 검사 슬롯 검색(검사 유형 고정) → [대체 슬롯 선택] → 예약 변경 확인(후보 사전 확인, 조회만)
 *   → [이 슬롯으로 재조정 요청](Server Function이 다시 확인한 뒤 POST 1회) → 예약 재조정 현황 → 예약 재조정 완료
 *
 * 데이터: 실행마다 새 검사 유형·장비 A·슬롯 1개, 장애 처리 뒤 장비 B·대체 슬롯 1개. 삭제 API가 없어 정리하지 않는다.
 */

const password = process.env.E2E_TEST_PASSWORD ?? "";

test.describe.configure({ mode: "serial" });

type ReferralDto = { id: string; referralStatus: string; currentReservationId: string | null; examTypeId: string };
type ReservationDto = { id: string; referralId: string; slotId: string | null; equipmentId: string | null; reservationStatus: string };
type HistoryDto = { fromStatus: string | null; toStatus: string; reason: string };

test.describe("예약 확정 → 장비 장애 → 대체 슬롯 재예약 확정 (DB 변경)", () => {
  let data: ReservationTestData;
  let alternative: AlternativeSlotData;
  let requester: GatewaySession;
  let examiner: GatewaySession;
  let original: ConfirmedReferral;

  test.beforeAll(async () => {
    if (process.env.E2E_ALLOW_DB_WRITE !== "1") throw new Error("E2E_ALLOW_DB_WRITE=1일 때만 실행합니다.");
    if (!password) throw new Error("E2E_TEST_PASSWORD가 없어 실행하지 않습니다 (건너뛰지 않고 실패로 둡니다).");
    const gateway = resolveE2eGateway();
    const admin = await loginGateway(gateway, "admin", password);
    examiner = await loginGateway(gateway, "imaging_b", password);
    requester = await loginGateway(gateway, "clinic_a", password);
    data = await prepareReservationData({ admin, examiner });
    expect(data.slotStartsAt.startsWith(`${data.slotDate}T09:00`), `슬롯 시작 ${data.slotStartsAt}`).toBe(true);
    console.log(`[e2e] 실행 ID ${data.runId}: 검사 항목 "${data.examTypeName}", 장비 A "${data.equipmentName}", 슬롯 ${data.slotDate} 09:00 (${data.slotId})`);
  });

  test("기존 예약 확정 → 장비 A 장애 → 재조정 필요 → 장비 B 대체 슬롯 → 재예약 확정", async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL;
    const requesterContext = await browser.newContext({ baseURL });
    const examinerContext = await browser.newContext({ baseURL });
    try {
      const requesterPage = await requesterContext.newPage();
      const examinerPage = await examinerContext.newPage();
      const getReferral = (id: string) => requester.get<ReferralDto>(`/api/v1/referrals/${id}`);
      const getReservation = (id: string) => requester.get<ReservationDto>(`/api/v1/referrals/reservations/${id}`);

      await test.step("① clinic_a: 의뢰 생성 → 기존 예약 확정 (의뢰·예약 CONFIRMED)", async () => {
        await loginUi(requesterPage, "clinic_a", password, "referring");
        original = await createConfirmedReferralViaUi(requesterPage, data, requester);
        console.log(`[e2e] 의뢰 ${original.referralId}, 기존 예약 ${original.reservationId}`);
      });

      await test.step("① imaging_b: 장비 A 장애 등록 (예약 09:00~09:30을 덮는 08:00~10:00) → 장애 목록 반영", async () => {
        await loginUi(examinerPage, "imaging_b", password, "examining");
        await registerDowntimeViaUi(examinerPage, {
          equipmentName: data.equipmentName,
          date: data.slotDate,
          startTime: "08:00",
          endTime: "10:00",
          reason: `E2E-${data.runId} 장비 A 장애 (자동 테스트)`,
        });
      });

      await test.step("① 조회 API(조건 기반 대기): 기존 예약 BLOCKED · 의뢰 NEEDS_RESCHEDULE · 재조정 알림 1건", async () => {
        await expect
          .poll(
            async () => `${(await getReferral(original.referralId)).referralStatus}/${(await getReservation(original.reservationId)).reservationStatus}`,
            { timeout: ASYNC_TIMEOUT_MS, intervals: POLL_INTERVALS, message: "의뢰/기존 예약이 NEEDS_RESCHEDULE/BLOCKED가 되기를 기다린다" },
          )
          .toBe("NEEDS_RESCHEDULE/BLOCKED");
        const notifications = await requester.get<{ contents: { referralId: string; type: string }[] }>("/api/v1/notifications", {
          referralId: original.referralId,
          page: 0,
          size: 10,
        });
        expect(notifications.contents.filter((item) => item.referralId.toLowerCase() === original.referralId.toLowerCase()).map((item) => item.type)).toEqual([
          "RESCHEDULE_REQUIRED",
        ]);
      });

      await test.step("② imaging_b(API): 정상 장비 B + 같은 검사 유형 + 대체 슬롯 1개 (장애 처리 뒤에 만든다)", async () => {
        alternative = await prepareAlternativeSlot({ examiner }, data);
        expect(alternative.slotStartsAt.startsWith(`${data.slotDate}T11:00`), `대체 슬롯 시작 ${alternative.slotStartsAt}`).toBe(true);
        console.log(`[e2e] 장비 B "${alternative.equipmentName}", 대체 슬롯 ${data.slotDate} 11:00 (${alternative.slotId})`);
      });

      const searchDialog = requesterPage.getByRole("dialog", { name: "대체 검사 슬롯 검색" });
      await test.step("② clinic_a 재조정·알림: 이번 의뢰(고유 검사 항목) 카드 → [새 슬롯 검색] → 검사 유형·세부 항목 고정", async () => {
        const card = await findRescheduleCard(requesterPage, data.examTypeName);
        expect(card, "재조정 필요 목록에서 이번 의뢰를 찾지 못했습니다").not.toBeNull();
        await expect(card!).toHaveCount(1);
        await expect(card!).toContainText(PARTNER_EXAMINER);
        await expect(card!).toContainText("재조정 필요");
        await card!.getByRole("button", { name: /새 슬롯 검색$/ }).click();

        await expect(searchDialog).toBeVisible();
        const existing = searchDialog.getByRole("region", { name: "기존 예약" });
        await expect(existing).toContainText(PARTNER_EXAMINER);
        await expect(existing).toContainText(data.examTypeName);
        await expect(searchDialog.locator("#slot-exam-type")).toBeDisabled({ timeout: 30_000 });
        await expect(searchDialog.locator("#slot-exam-type")).toHaveValue("CT");
        const examItem = searchDialog.locator("#slot-exam-item");
        await expect(examItem).toBeDisabled();
        await expect(examItem).toHaveValue(data.examTypeId);
        await expect(examItem.locator("option:checked")).toHaveText(data.examTypeName);
      });

      const results = searchDialog.locator('section[aria-labelledby="slot-result-title"]');
      await test.step("② 대체 슬롯 검색: B영상의학과 → 장비 B 슬롯 1건 (장비 A 슬롯은 예약됨이라 나오지 않음)", async () => {
        await searchDialog.locator("#slot-organization").selectOption({ label: PARTNER_EXAMINER });
        const response = requesterPage.waitForResponse((res) => new URL(res.url()).pathname === "/referring/slots/search");
        await searchDialog.getByRole("button", { name: "슬롯 검색", exact: true }).click();
        const res = await response;
        expect(res.status()).toBe(200);
        expect(new URL(res.url()).searchParams.get("examTypeId")?.toLowerCase(), "검색은 기존 의뢰의 검사 유형으로 고정").toBe(data.examTypeId.toLowerCase());
        const body = (await res.json()) as { slots: { id: string; equipmentId: string }[] };
        expect(body.slots.map((slot) => slot.id.toLowerCase())).toEqual([alternative.slotId.toLowerCase()]);
        await expect(results.getByText("총 1건의 검색 결과가 있습니다.")).toBeVisible();
      });

      const confirmDialog = requesterPage.getByRole("dialog", { name: /^예약 (변경 확인|재조정 현황|재조정 완료)$/ });
      await test.step("② [대체 슬롯 선택] → 예약 변경 확인: 기존 예약(장비 A)과 변경할 예약(장비 B) 표시, 사전 확인 통과", async () => {
        const row = results.locator("tbody tr").filter({ hasText: data.examTypeName });
        await expect(row).toHaveCount(1);
        await row.getByRole("button", { name: "대체 슬롯 선택" }).click();
        await expect(confirmDialog).toBeVisible();
        await expect(confirmDialog).toHaveAccessibleName("예약 변경 확인");
        const before = confirmDialog.getByRole("region", { name: "기존 예약" });
        const next = confirmDialog.getByRole("region", { name: "변경할 예약" });
        await expect(before).toContainText(PARTNER_EXAMINER);
        await expect(before).toContainText(data.examTypeName);
        await expect(before).toContainText(data.equipmentName);
        await expect(before).toContainText("09:00");
        await expect(next).toContainText(PARTNER_EXAMINER);
        await expect(next).toContainText(data.examTypeName);
        await expect(next).toContainText(alternative.equipmentName);
        await expect(next).toContainText("11:00");
        await expect(confirmDialog.getByRole("status").filter({ hasText: "재조정 요청 전 확인을 통과했습니다." })).toBeVisible({ timeout: 20_000 });
      });

      await test.step("③ [이 슬롯으로 재조정 요청] (실제 Server Function·POST 1회) → 접수 (아직 확정 아님)", async () => {
        const request = confirmDialog.getByRole("button", { name: "이 슬롯으로 재조정 요청" });
        await expect(request).toBeEnabled();
        await request.click();
        await expect(confirmDialog).toHaveAccessibleName(/^예약 재조정 (현황|완료)$/, { timeout: 20_000 });
        // 접수 직후: 의뢰는 새 예약을 가리키고(덮어쓰기 아님) 기존 예약은 BLOCKED 그대로
        const referral = await getReferral(original.referralId);
        expect(referral.currentReservationId).toBeTruthy();
        expect(referral.currentReservationId!.toLowerCase()).not.toBe(original.reservationId.toLowerCase());
        expect(["PENDING", "CONFIRMED"]).toContain(referral.referralStatus);
        expect((await getReservation(original.reservationId)).reservationStatus).toBe("BLOCKED");
        // 접수 뒤에는 요청 버튼이 사라진다 (같은 요청을 다시 보낼 수 없다). 중복 POST 여부는 확정 뒤 이 의뢰의 예약 수(기존 1 + 새 1)로 확인한다
        await expect(confirmDialog.getByRole("button", { name: "이 슬롯으로 재조정 요청" })).toHaveCount(0);
      });

      await test.step("④ 재예약 확정까지 대기 (조건 기반: 화면 [상태 새로고침] = 조회만) → 예약 재조정 완료", async () => {
        await expect
          .poll(
            async () => {
              const title = (await confirmDialog.locator("h2").first().innerText()).trim();
              if (title === "예약 재조정 완료") return "완료";
              // 아직이면 [상태 새로고침](조회만)으로 다시 확인한다. 실패·경고 안내는 그대로 반환값에 담아 원인을 보이게 한다
              const refresh = confirmDialog.getByRole("button", { name: "상태 새로고침" });
              if ((await refresh.count()) > 0 && (await refresh.isEnabled())) await refresh.click();
              const alert = confirmDialog.getByRole("alert");
              return (await alert.count()) > 0 ? `${title} / ${(await alert.first().innerText()).trim()}` : title;
            },
            { timeout: ASYNC_TIMEOUT_MS, intervals: POLL_INTERVALS, message: "예약 재조정 완료 표시를 기다린다" },
          )
          .toBe("완료");
        await expect(confirmDialog.getByRole("status").filter({ hasText: "재예약이 확정되었습니다." })).toBeVisible();
        await expect(confirmDialog.getByRole("region", { name: "확정된 예약" })).toContainText(alternative.equipmentName);
      });

      await test.step("④ 조회 API: 의뢰 CONFIRMED · currentReservationId = 새 예약 · 새 예약 CONFIRMED·장비 B 슬롯 · 슬롯 BOOKED · 기존 예약 BLOCKED", async () => {
        const referral = await getReferral(original.referralId);
        expect(referral.referralStatus).toBe("CONFIRMED");
        const newReservationId = referral.currentReservationId!;
        expect(newReservationId.toLowerCase()).not.toBe(original.reservationId.toLowerCase());
        const newReservation = await getReservation(newReservationId);
        expect(newReservation.reservationStatus).toBe("CONFIRMED");
        expect(newReservation.referralId.toLowerCase()).toBe(original.referralId.toLowerCase());
        expect(newReservation.slotId?.toLowerCase()).toBe(alternative.slotId.toLowerCase());
        expect(newReservation.equipmentId?.toLowerCase()).toBe(alternative.equipmentId.toLowerCase());
        expect((await requester.get<{ status: string }>(`/api/v1/slots/${alternative.slotId}`)).status).toBe("BOOKED");

        // 중복 POST 없음: 이 의뢰의 예약은 기존(BLOCKED) 1 + 새(CONFIRMED) 1 = 2건뿐
        const reservations = await requester.get<{ contents: ReservationDto[] }>("/api/v1/referrals/reservations", { referralId: original.referralId, page: 0, size: 10 });
        expect(reservations.contents.map((item) => item.id.toLowerCase()).sort()).toEqual([original.reservationId, newReservationId].map((id) => id.toLowerCase()).sort());

        const oldReservation = await getReservation(original.reservationId);
        expect(oldReservation.reservationStatus).toBe("BLOCKED");
        expect(oldReservation.slotId?.toLowerCase()).toBe(data.slotId.toLowerCase());

        // 의뢰 이력 (발생순): 백엔드가 쓰는 재예약 접수(NEEDS_RESCHEDULE → PENDING)와 그 뒤 확정(PENDING → CONFIRMED)
        const histories = await requester.get<HistoryDto[]>(`/api/v1/referrals/${original.referralId}/histories`);
        const rescheduled = histories.findIndex((h) => h.reason === "RESCHEDULED" && h.fromStatus === "NEEDS_RESCHEDULE" && h.toStatus === "PENDING");
        expect(rescheduled, JSON.stringify(histories)).toBeGreaterThanOrEqual(0);
        expect(histories.slice(rescheduled + 1).some((h) => h.reason === "RESERVATION_CONFIRMED" && h.toStatus === "CONFIRMED"), JSON.stringify(histories)).toBe(true);
        // 장애 차단 이력(RESERVATION_BLOCKED)은 백엔드 코드상 저장되어야 하지만 이전 실행에서 남지 않은 것을 확인했다 → 결과만 기록 (보고 대상)
        const blockedHistory = histories.some((h) => h.reason === "RESERVATION_BLOCKED");
        test.info().annotations.push({ type: "backend-check", description: `RESERVATION_BLOCKED 이력 ${blockedHistory ? "있음" : "없음"}: ${histories.map((h) => h.reason).join(" → ")}` });
        console.log(`[e2e] 새 예약 ${newReservationId} · 이력 ${histories.map((h) => h.reason).join(" → ")}`);
      });

      await test.step("④ clinic_a 화면: 의뢰·예약 목록 '확정', 재조정 필요 목록에서 이번 의뢰가 사라짐", async () => {
        await requesterPage.goto(`/referring/referrals?patientName=${encodeURIComponent(data.patientName)}`);
        const row = requesterPage.getByRole("row").filter({ hasText: data.patientName });
        await expect(row).toHaveCount(1, { timeout: 20_000 });
        await expect(row).toContainText("확정");
        await expect(row).not.toContainText("재조정 필요");
        expect(await findRescheduleCard(requesterPage, data.examTypeName)).toBeNull();
      });
    } finally {
      await requesterContext.close();
      await examinerContext.close();
    }
  });
});
