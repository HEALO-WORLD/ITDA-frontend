import { expect, test, type Page } from "@playwright/test";

import { loginGateway, resolveE2eGateway, type GatewaySession } from "./support/gateway";
import { ASYNC_TIMEOUT_MS, createConfirmedReferralViaUi, loginUi, PARTNER_EXAMINER, POLL_INTERVALS, type ConfirmedReferral } from "./support/referralFlow";
import { prepareReservationData, type ReservationTestData } from "./support/reservationData";

/**
 * DB 변경 E2E: 예약 확정 → 장비 장애 등록 → 확정 예약 차단(BLOCKED) → 의뢰 재조정 필요(NEEDS_RESCHEDULE).
 *
 * 실행 조건: E2E_ALLOW_DB_WRITE=1 + E2E 전용 프론트(E2E_BASE_URL, config가 docker로 확인) + E2E 전용 Gateway(E2E_GATEWAY_URL, support/gateway가 확인)
 *   예: E2E_BASE_URL=http://127.0.0.1:3002 E2E_GATEWAY_URL=http://127.0.0.1:18080 E2E_ALLOW_DB_WRITE=1 E2E_TEST_PASSWORD=...
 *       npx playwright test incident-reschedule.db-write   (이 파일만 지정해서 실행한다)
 *
 * 백엔드 흐름 (코드 기준)
 * - slot-service POST /api/v1/equipment-downtimes 201: 중단 저장 + 구간의 AVAILABLE 슬롯 → UNAVAILABLE, HELD·BOOKED 슬롯은 그대로(충돌로 응답)
 *   + Outbox → Kafka equipment-events (EquipmentDowntimeStarted)
 * - referral-service 소비: 장애(incident) 등록 + 같은 장비·CONFIRMED·시간이 겹치는 예약마다 후속 작업(PENDING)
 * - 스케줄러(5초 주기, E2E 환경에서 켜짐): 예약 BLOCKED · 의뢰 NEEDS_RESCHEDULE · 이력 · 재조정 알림(같은 트랜잭션)
 * 201은 '중단 등록'까지라 후속 상태는 조회 API를 조건이 맞을 때까지 다시 확인한다 (고정 sleep 없음).
 *
 * 데이터: 실행마다 새 검사 유형·장비·슬롯 1개 (support/reservationData.ts). 장애 구간은 이 장비의 내일 슬롯(09:00~09:30)을 덮는 08:00~10:00.
 * 삭제 API가 없어 정리하지 않는다 (E2E 전용 DB에만 남는다).
 */

const password = process.env.E2E_TEST_PASSWORD ?? "";
const DOWNTIME_START_TIME = "08:00";
const DOWNTIME_END_TIME = "10:00";

test.describe.configure({ mode: "serial" });

/** DatePicker(버튼 + 달력 대화상자)에서 날짜를 고른다. 대상 날짜가 다음 달이면 [다음 달]로 넘긴다 */
async function pickDate(page: Page, triggerId: string, label: string, date: string) {
  await page.locator(`#${triggerId}`).click();
  const calendar = page.getByRole("dialog", { name: `${label} 선택` });
  const day = calendar.locator(`button[data-date="${date}"]`);
  for (let i = 0; i < 2 && (await day.count()) === 0; i++) await calendar.getByRole("button", { name: "다음 달" }).click();
  await day.click();
  await expect(page.locator(`#${triggerId}`)).toContainText(date);
}

test.describe("장비 장애 → 예약 차단 → 의뢰 재조정 필요 (DB 변경)", () => {
  let data: ReservationTestData;
  let requester: GatewaySession;
  let confirmed: ConfirmedReferral;
  const reason = () => `E2E-${data.runId} 장비 장애 (자동 테스트)`;

  test.beforeAll(async () => {
    if (process.env.E2E_ALLOW_DB_WRITE !== "1") throw new Error("E2E_ALLOW_DB_WRITE=1일 때만 실행합니다.");
    if (!password) throw new Error("E2E_TEST_PASSWORD가 없어 실행하지 않습니다 (건너뛰지 않고 실패로 둡니다).");
    const gateway = resolveE2eGateway();
    const [admin, examiner] = await Promise.all([loginGateway(gateway, "admin", password), loginGateway(gateway, "imaging_b", password)]);
    requester = await loginGateway(gateway, "clinic_a", password);
    data = await prepareReservationData({ admin, examiner });
    expect(data.slotStartsAt.startsWith(`${data.slotDate}T09:00`), `슬롯 시작 ${data.slotStartsAt}`).toBe(true);
    console.log(`[e2e] 실행 ID ${data.runId}: 장비 "${data.equipmentName}", 슬롯 ${data.slotDate} 09:00 (${data.slotId})`);
  });

  test("① 예약 확정 ② imaging_b 장애 등록 ③ 예약 BLOCKED · 의뢰 NEEDS_RESCHEDULE · clinic_a 화면 재조정 필요 · 재조정 알림", async ({ browser }) => {
    // 두 역할은 쿠키를 나눈다. 대상 주소는 config가 확인한 E2E 프론트(baseURL)
    const baseURL = test.info().project.use.baseURL;
    const requesterContext = await browser.newContext({ baseURL });
    const examinerContext = await browser.newContext({ baseURL });
    try {
      const requesterPage = await requesterContext.newPage();
      const examinerPage = await examinerContext.newPage();

      await test.step("① clinic_a: 의뢰 생성 → 예약 확정 (화면 + 조회 API: 의뢰·예약 CONFIRMED)", async () => {
        await loginUi(requesterPage, "clinic_a", password, "referring");
        confirmed = await createConfirmedReferralViaUi(requesterPage, data, requester);
      });

      await test.step("② imaging_b: 장비 장애 등록 화면에서 이번 장비·예약 시간과 겹치는 구간·사유 입력 → 등록", async () => {
        await loginUi(examinerPage, "imaging_b", password, "examining");
        await examinerPage.goto("/examining/incidents");
        await examinerPage.getByRole("button", { name: "장비 장애 등록", exact: true }).click();
        const dialog = examinerPage.getByRole("dialog", { name: "장비 장애 등록" });
        await expect(dialog).toBeVisible();

        await dialog.locator("#downtime-equipment").selectOption({ label: `${data.equipmentName} (CT)` });
        await pickDate(examinerPage, "downtime-start-date", "장애 시작 날짜", data.slotDate);
        await dialog.locator("#downtime-start-time").fill(DOWNTIME_START_TIME);
        await pickDate(examinerPage, "downtime-end-date", "장애 종료 예정 날짜", data.slotDate);
        await dialog.locator("#downtime-end-time").fill(DOWNTIME_END_TIME);
        await dialog.locator("#downtime-reason").fill(reason());
        await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);

        await dialog.getByRole("button", { name: "장애 등록", exact: true }).click();
        await expect(dialog).toBeHidden({ timeout: 20_000 });
      });

      await test.step("② 등록 성공 안내(예약 슬롯 1개는 후속 처리 대상) → 장애 목록 반영 확인", async () => {
        const notice = examinerPage.getByRole("status").filter({ hasText: "장비 장애가 등록되었습니다." });
        await expect(notice).toBeVisible();
        // 이 장비의 슬롯은 예약된 1개뿐: 사용 불가로 바꾼 예약 가능 슬롯은 없고, 예약 슬롯 1개는 후속 처리 대상
        await expect(notice).toContainText("예약이 잡혀 있는 슬롯 1개는 그대로 두고, 관련 예약·의뢰는 후속 처리 대상으로 넘겼습니다.");
        // 화면의 자동 확인(2초마다 최대 30초)이 장애 목록(referral-service) 반영을 확인하면 목록을 다시 받는다
        await expect(notice).toContainText("장애 목록에 반영되었습니다.", { timeout: 40_000 });
        const incidentRow = examinerPage.locator('section[aria-labelledby="incident-api-list-title"] tbody tr').filter({ hasText: data.equipmentName });
        await expect(incidentRow).toHaveCount(1, { timeout: 20_000 });
        await expect(incidentRow).toContainText("CT");
      });

      await test.step("③ 조회 API(조건 기반 대기): 이번 예약 BLOCKED · 의뢰 NEEDS_RESCHEDULE", async () => {
        await expect
          .poll(
            async () => {
              const referral = await requester.get<{ referralStatus: string; currentReservationId: string | null }>(`/api/v1/referrals/${confirmed.referralId}`);
              const reservation = await requester.get<{ reservationStatus: string }>(`/api/v1/referrals/reservations/${confirmed.reservationId}`);
              return `${referral.referralStatus}/${reservation.reservationStatus}`;
            },
            { timeout: ASYNC_TIMEOUT_MS, intervals: POLL_INTERVALS, message: "의뢰/예약 상태가 NEEDS_RESCHEDULE/BLOCKED가 되기를 기다린다" },
          )
          .toBe("NEEDS_RESCHEDULE/BLOCKED");
        // 의뢰의 현재 예약은 그대로 (재예약 전)
        const referral = await requester.get<{ currentReservationId: string | null }>(`/api/v1/referrals/${confirmed.referralId}`);
        expect(referral.currentReservationId?.toLowerCase()).toBe(confirmed.reservationId.toLowerCase());
      });

      await test.step("③ clinic_a 화면: 의뢰·예약 목록 '재조정 필요', 재조정·알림 화면의 재조정 필요 목록에 이번 검사 항목", async () => {
        await requesterPage.goto("/referring/referrals");
        const row = requesterPage.getByRole("row").filter({ hasText: data.patientName });
        await expect(row).toHaveCount(1, { timeout: 20_000 });
        await expect(row).toContainText("재조정 필요");

        await requesterPage.goto("/referring/notifications");
        const card = requesterPage.getByRole("list", { name: "예약 재조정 필요 목록" }).getByRole("listitem").filter({ hasText: data.examTypeName });
        await expect(card).toHaveCount(1, { timeout: 20_000 });
        await expect(card).toContainText(PARTNER_EXAMINER);
        await expect(card).toContainText("재조정 필요");
      });

      await test.step("③ 재조정 알림(조회 API, 읽음 처리하지 않음): 이번 의뢰의 RESCHEDULE_REQUIRED 알림 1건", async () => {
        const page0 = await requester.get<{ contents: { referralId: string; type: string; title: string; isRead: boolean }[] }>("/api/v1/notifications", {
          referralId: confirmed.referralId,
          page: 0,
          size: 10,
        });
        const notifications = page0.contents.filter((item) => item.referralId.toLowerCase() === confirmed.referralId.toLowerCase());
        expect(notifications.map(({ type, title, isRead }) => ({ type, title, isRead }))).toEqual([
          { type: "RESCHEDULE_REQUIRED", title: "검사 예약 재조정 필요", isRead: false },
        ]);
      });
    } finally {
      await requesterContext.close();
      await examinerContext.close();
    }
  });
});
