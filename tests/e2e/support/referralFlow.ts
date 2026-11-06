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
