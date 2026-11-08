import { expect, test, type Page } from "@playwright/test";

import { applySlotSearch, chooseCriteriaChip, openSlotSearchAndWaitAutoSearch, slotCards } from "./support/slotResults";

// A의원(clinic_a)의 시연용 협약은 건드리지 않는다.
const REQUESTER = "clinic_d"; // D의원
const EXAMINER = "imaging_b"; // B영상의학과
const REQUESTER_NAME = "D의원";
const EXAMINER_NAME = "B영상의학과";
type Phase = "untouched" | "pending" | "active" | "terminated" | "rejected";

const password = process.env.E2E_TEST_PASSWORD;
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

async function login(page: Page, loginId: string, expectedPath: RegExp) {
  if (!password) {
    throw new Error("E2E_TEST_PASSWORD 환경변수를 설정해 주세요. (테스트 비밀번호를 코드에 저장하지 않음)");
  }

  await page.goto("/login");
  await page.getByLabel("로그인 ID").fill(loginId);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(expectedPath, { timeout: 20_000 });
}

async function endPartnership(requesterPage: Page) {
  await requesterPage.goto("/referring/partnerships");
  const row = requesterPage.getByRole("row").filter({ hasText: EXAMINER_NAME });
  await row.getByRole("button", { name: `${EXAMINER_NAME} 협약 종료` }).click();
  await requesterPage.getByRole("dialog", { name: "협약 종료" })
    .getByRole("button", { name: "종료", exact: true }).click();
  await expect(row).toContainText("종료");
}

test("D의원 ↔ B영상의학과: 협약 승인 시 슬롯 표시, 종료 시 미표시", async ({ browser }) => {
  // 두 역할은 서로 다른 쿠키/로그인 상태로 유지한다.
  const requesterContext = await browser.newContext({ baseURL });
  const examinerContext = await browser.newContext({ baseURL });
  const requesterPage = await requesterContext.newPage();
  const examinerPage = await examinerContext.newPage();
  const state: { phase: Phase } = { phase: "untouched" };

  try {
    await test.step("두 테스트 계정 로그인", async () => {
      await login(requesterPage, REQUESTER, /\/referring(?:\/|$)/);
      await login(examinerPage, EXAMINER, /\/examining(?:\/|$)/);
    });

    await test.step("D의원에서 협약 요청 → PENDING", async () => {
      await requesterPage.goto("/referring/partnerships");
      const row = requesterPage.getByRole("row").filter({ hasText: EXAMINER_NAME });

      // 기존 팀원의 ACTIVE/PENDING 협약은 절대 변경하지 않는다.
      if (await row.count()) {
        const currentStatus = await row.innerText();
        if (/협약 중|승인 대기/.test(currentStatus)) {
          throw new Error("D의원-B영상의학과 협약이 이미 진행 중입니다. 기존 협약을 건드리지 않도록 테스트를 중단합니다.");
        }
      }

      await requesterPage.getByRole("button", { name: "새 협약 요청" }).click();
      const dialog = requesterPage.getByRole("dialog", { name: "새 협약 요청" });
      await dialog.getByRole("searchbox", { name: "검사기관명 검색" }).fill(EXAMINER_NAME);
      await dialog.getByRole("radio", { name: new RegExp(EXAMINER_NAME) }).check();
      await dialog.getByRole("button", { name: /^(협약 요청|다시 요청)$/ }).click();
      state.phase = "pending";
      await expect(row).toContainText("승인 대기");
    });

    await test.step("B영상의학과에서 협약 승인 → ACTIVE", async () => {
      await examinerPage.goto("/examining/partnerships");
      const row = examinerPage.getByRole("row").filter({ hasText: REQUESTER_NAME });
      await row.getByRole("button", { name: `${REQUESTER_NAME} 승인` }).click();
      await examinerPage.getByRole("dialog", { name: "협약 승인" })
        .getByRole("button", { name: "승인", exact: true }).click();
      state.phase = "active";
      await expect(row).toContainText("협약 중");
    });

    await test.step("ACTIVE 협약일 때 B영상의학과 슬롯 표시 확인", async () => {
      // PC: 접속하면 기본 조건으로 자동 검색 → 협력 검사기관 칩으로 B영상의학과를 고르고 [검색 적용]
      await openSlotSearchAndWaitAutoSearch(requesterPage);
      await expect(requesterPage.locator("#slot-organization option", { hasText: EXAMINER_NAME })).toHaveCount(1);
      await chooseCriteriaChip(requesterPage, "slot-chip-organization", "협력 검사기관 선택", EXAMINER_NAME);
      await applySlotSearch(requesterPage);

      const resultSection = requesterPage.locator('section[aria-labelledby="slot-result-title"]');
      await expect(resultSection.getByText(/총 \d+건의 검색 결과가 있습니다\./)).toBeVisible({ timeout: 30_000 });
      // PC(1280px) 결과: 새 검색은 예약 가능한 첫 날짜를 고르므로, 슬롯이 있으면 그날의 B영상의학과 카드가 보인다
      const slotCardsOfExaminer = slotCards(resultSection).filter({ hasText: EXAMINER_NAME });
      if ((await slotCardsOfExaminer.count()) === 0) {
        throw new Error("사전 조건 실패: B영상의학과에 향후 31일 내 AVAILABLE 슬롯이 없습니다. 슬롯을 먼저 준비해 주세요.");
      }
      await expect(slotCardsOfExaminer.first()).toBeVisible();
      await expect(slotCardsOfExaminer.first().locator("button[data-slot-id]").first()).toBeEnabled();
    });

    await test.step("D의원에서 협약 종료 → TERMINATED", async () => {
      await endPartnership(requesterPage);
      state.phase = "terminated";
    });

    await test.step("🚨 종료 후 B영상의학과 슬롯 미표시 확인", async () => {
      // 접속 시 기본 조건(전체) 자동 검색이 끝날 때까지 기다린다
      await openSlotSearchAndWaitAutoSearch(requesterPage);
      await expect(requesterPage.locator("#slot-organization option", { hasText: EXAMINER_NAME })).toHaveCount(0);
      const resultSection = requesterPage.locator('section[aria-labelledby="slot-result-title"]');
      // 검색 완료를 기다린 뒤 확인해야 빈 초기 화면을 성공으로 오인하지 않는다.
      await expect(resultSection.getByText(/총 \d+건의 검색 결과가 있습니다\./)).toBeVisible({ timeout: 30_000 });
      // 달력의 어느 날짜에도 B영상의학과 슬롯이 없어야 한다: 검색 결과(전체 기간)에 B영상의학과가 없는지 확인
      await expect(slotCards(resultSection).filter({ hasText: EXAMINER_NAME })).toHaveCount(0);
      await expect(resultSection.getByText(EXAMINER_NAME)).toHaveCount(0);
    });
  } finally {
    // 슬롯이 없어 테스트가 실패하더라도 ACTIVE 협약을 남기지 않는다.
    if (state.phase === "active") {
      try {
        await endPartnership(requesterPage);
        state.phase = "terminated";
      } catch (error) {
        console.error("테스트 정리 실패: D의원-B영상의학과 ACTIVE 협약을 수동 종료해 주세요.", error);
      }
    } else if (state.phase === "pending") {
      try {
        await examinerPage.goto("/examining/partnerships");
        const row = examinerPage.getByRole("row").filter({ hasText: REQUESTER_NAME });
        await row.getByRole("button", { name: `${REQUESTER_NAME} 거절` }).click();
        await examinerPage.getByRole("dialog", { name: "협약 거절" })
          .getByRole("button", { name: "거절", exact: true }).click();
        state.phase = "rejected";
      } catch (error) {
        console.error("테스트 정리 실패: D의원-B영상의학과 PENDING 협약을 확인해 주세요.", error);
      }
    }
    await requesterContext.close();
    await examinerContext.close();
  }
});
