import { expect, type Page } from "@playwright/test";

import type { GatewaySession } from "./gateway";
import type { ReservationTestData } from "./reservationData";

/**
 * db-write E2E 공통 화면 흐름 (referral-reservation.db-write.spec.ts와 같은 셀렉터·문구·성공 조건).
 * 모두 실제 화면·실제 API를 쓴다 (응답을 가짜로 바꾸지 않는다).
 */

export const PARTNER_EXAMINER = "B영상의학과";
/** 비동기 처리(Kafka·스케줄러) 대기 상한 */
export const ASYNC_TIMEOUT_MS = 90_000;
export const POLL_INTERVALS = [2_000, 3_000, 5_000];

/** 화면 로그인 → 역할별 첫 화면 */
export async function loginUi(page: Page, loginId: string, password: string, home: "referring" | "examining") {
  await page.goto("/login");
  await page.getByLabel("로그인 ID").fill(loginId);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${home}(?:/|$)`), { timeout: 20_000 });
  const role = home === "referring" ? "의뢰기관 담당자" : "검사기관 담당자";
  await expect(page.locator("header").getByText(`${role} · ${loginId}`, { exact: true })).toBeVisible();
}

export interface ConfirmedReferral {
  referralId: string;
  reservationId: string;
}

/**
 * (clinic_a 로그인 상태) 슬롯 검색 → 이번 실행 슬롯 선택 → 의뢰·예약 요청 → 예약 확정(화면) → 조회 API로 의뢰·예약 CONFIRMED 확인.
 * 예약 E2E(referral-reservation.db-write.spec.ts)와 같은 성공 조건이다.
 */
export async function createConfirmedReferralViaUi(page: Page, data: ReservationTestData, requester: GatewaySession): Promise<ConfirmedReferral> {
  const results = page.locator('section[aria-labelledby="slot-result-title"]');
  await page.goto("/referring/slots");
  await page.locator("#slot-organization").selectOption({ label: PARTNER_EXAMINER });
  await page.locator("#slot-exam-type").selectOption("CT");
  await page.locator("#slot-exam-item").selectOption({ label: data.examTypeName });
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/referring/slots/search");
  await page.getByRole("button", { name: "슬롯 검색", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(results.getByText("총 1건의 검색 결과가 있습니다.")).toBeVisible();

  const row = results.getByRole("row").filter({ hasText: data.examTypeName });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "예약 요청" }).click();
  const dialog = page.getByRole("dialog", { name: "새 검사 의뢰" });
  await expect(dialog.getByRole("region", { name: "선택한 검사 슬롯" })).toContainText(data.equipmentName);

  await dialog.getByLabel("환자 이름").fill(data.patientName);
  await dialog.getByRole("button", { name: "의뢰·예약 요청" }).click();
  const title = dialog.locator("#referral-progress-title");
  await expect(title).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () => {
        const text = (await title.innerText()).trim();
        if (text === "예약 확정" || text === "예약 실패" || text === "상태 확인 필요") return text;
        const refresh = dialog.getByRole("button", { name: "상태 새로고침" });
        if (await refresh.isEnabled()) await refresh.click();
        return text;
      },
      { timeout: ASYNC_TIMEOUT_MS, intervals: POLL_INTERVALS },
    )
    .toBe("예약 확정");
  await expect(dialog.getByText("의뢰 상태 CONFIRMED · 예약 상태 CONFIRMED")).toBeVisible();

  const list = await requester.get<{ contents: { id: string; patientName: string; referralStatus: string; currentReservationId: string | null }[] }>(
    "/api/v1/referrals",
    { patientName: data.patientName, page: 0, size: 10 },
  );
  const referrals = list.contents.filter((item) => item.patientName === data.patientName);
  expect(referrals).toHaveLength(1);
  const [referral] = referrals;
  expect(referral.referralStatus).toBe("CONFIRMED");
  expect(referral.currentReservationId).toBeTruthy();
  const reservation = await requester.get<{ slotId: string | null; reservationStatus: string }>(`/api/v1/referrals/reservations/${referral.currentReservationId}`);
  expect(reservation.reservationStatus).toBe("CONFIRMED");
  expect(reservation.slotId?.toLowerCase()).toBe(data.slotId.toLowerCase());
  return { referralId: referral.id, reservationId: referral.currentReservationId as string };
}

/** DatePicker(버튼 + 달력 대화상자)에서 날짜를 고른다. 대상 날짜가 다음 달이면 [다음 달]로 넘긴다 */
export async function pickDate(page: Page, triggerId: string, label: string, date: string) {
  await page.locator(`#${triggerId}`).click();
  const calendar = page.getByRole("dialog", { name: `${label} 선택` });
  const day = calendar.locator(`button[data-date="${date}"]`);
  for (let i = 0; i < 2 && (await day.count()) === 0; i++) await calendar.getByRole("button", { name: "다음 달" }).click();
  await day.click();
  await expect(page.locator(`#${triggerId}`)).toContainText(date);
}

/**
 * (imaging_b 로그인 상태) 장비 장애 등록 화면에서 장애를 등록하고 성공 안내·장애 목록 반영까지 확인한다
 * (장애 E2E incident-reschedule.db-write.spec.ts와 같은 셀렉터·성공 조건). 예약 슬롯 1개가 후속 처리 대상이어야 한다
 */
export async function registerDowntimeViaUi(
  page: Page,
  input: { equipmentName: string; date: string; startTime: string; endTime: string; reason: string },
) {
  await page.goto("/examining/incidents");
  await page.getByRole("button", { name: "장비 장애 등록", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "장비 장애 등록" });
  await expect(dialog).toBeVisible();
  await dialog.locator("#downtime-equipment").selectOption({ label: `${input.equipmentName} (CT)` });
  await pickDate(page, "downtime-start-date", "장애 시작 날짜", input.date);
  await dialog.locator("#downtime-start-time").fill(input.startTime);
  await pickDate(page, "downtime-end-date", "장애 종료 예정 날짜", input.date);
  await dialog.locator("#downtime-end-time").fill(input.endTime);
  await dialog.locator("#downtime-reason").fill(input.reason);
  await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "장애 등록", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const notice = page.getByRole("status").filter({ hasText: "장비 장애가 등록되었습니다." });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("예약이 잡혀 있는 슬롯 1개는 그대로 두고, 관련 예약·의뢰는 후속 처리 대상으로 넘겼습니다.");
  await expect(notice).toContainText("장애 목록에 반영되었습니다.", { timeout: 40_000 });
  const incidentRow = page.locator('section[aria-labelledby="incident-api-list-title"] tbody tr').filter({ hasText: input.equipmentName });
  await expect(incidentRow).toHaveCount(1, { timeout: 20_000 });
}

/**
 * 재조정·알림 화면의 '예약 재조정 필요 목록'에서 검사 항목 이름(실행마다 고유)으로 카드를 찾는다.
 * 데이터가 쌓여도 첫 페이지라고 가정하지 않고 `?reschedulePage=`를 넘기며 찾는다. 없으면 null (모든 페이지 확인)
 */
export async function findRescheduleCard(page: Page, examTypeName: string, maxPages = 50) {
  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    await page.goto(`/referring/notifications?reschedulePage=${pageNo}`);
    await expect(page.getByRole("heading", { name: "예약 재조정 필요" })).toBeVisible({ timeout: 20_000 });
    const card = page.getByRole("list", { name: "예약 재조정 필요 목록" }).getByRole("listitem").filter({ hasText: examTypeName });
    if ((await card.count()) > 0) return card;
    const next = page.getByRole("navigation", { name: "재조정 필요 목록 페이지" }).getByRole("link", { name: "다음 페이지" });
    if ((await next.count()) === 0) return null;
  }
  throw new Error(`재조정 필요 목록 ${maxPages}페이지 안에서 끝을 확인하지 못했습니다.`);
}
