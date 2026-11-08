import { expect, type Locator, type Page, type Response } from "@playwright/test";

/**
 * 슬롯 검색 화면 PC 결과(Desktop Chrome 1280px = xl): 왼쪽 결과 달력 + 오른쪽 선택한 날짜의 시간 카드.
 * - 달력 날짜 버튼: data-date(`YYYY-MM-DD`), 검색 기간 안이면 data-available-count(그날 예약 가능 슬롯 수)
 * - 시간 버튼: data-slot-id = 원본 슬롯 ID (누르면 그 슬롯으로 예약 요청·대체 슬롯 선택)
 * xl 미만 표·모바일 카드는 CSS로 숨겨져 있어 화면(접근성 트리)에는 PC 결과만 보인다.
 */

export const slotResultSection = (page: Page) => page.locator('section[aria-labelledby="slot-result-title"]');

const isSlotSearchResponse = (res: Response) => new URL(res.url()).pathname === "/referring/slots/search" && res.request().method() === "GET";

/** 슬롯 검색 화면 열기: PC(1280px)는 접속하자마자 기본 조건으로 자동 검색한다. 그 응답(200)까지 기다린다 */
export async function openSlotSearchAndWaitAutoSearch(page: Page): Promise<Response> {
  const response = page.waitForResponse(isSlotSearchResponse, { timeout: 30_000 });
  await page.goto("/referring/slots");
  const res = await response;
  expect(res.status()).toBe(200);
  await expect(page.locator("#slot-chip-organization")).toBeVisible();
  return res;
}

/** PC 조건 칩에서 값 고르기 (입력 상태만 바뀜, 검색은 applySlotSearch) */
export async function chooseCriteriaChip(page: Page, chipId: string, listboxName: string, option: string) {
  await page.locator(`#${chipId}`).click();
  await page.getByRole("listbox", { name: listboxName }).getByRole("option", { name: option, exact: true }).click();
  await expect(page.locator(`#${chipId}`)).toContainText(option);
}

/** [검색 적용]을 누르고 검색 응답(200)을 기다린다 */
export async function applySlotSearch(page: Page): Promise<Response> {
  const response = page.waitForResponse(isSlotSearchResponse);
  await page.getByRole("button", { name: "검색 적용" }).click();
  const res = await response;
  expect(res.status()).toBe(200);
  return res;
}

export const resultCalendar = (section: Locator) => section.getByRole("grid", { name: /^검색 결과 날짜 선택/ });

/** 선택한 날짜의 카드 (카드 1장 = 같은 검사기관·장비·세부 검사 항목) */
export const slotCards = (section: Locator) =>
  section.getByRole("list", { name: "선택한 날짜의 검사 슬롯" }).locator(":scope > li");

/** 지금 보이는 시간 버튼의 슬롯 ID */
export async function visibleSlotIds(section: Locator): Promise<string[]> {
  return section
    .locator("button[data-slot-id]:visible")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-slot-id") ?? ""));
}

/** 달력에서 그 날짜가 보이는 달로 옮긴다 (검색 기간 안에서만: 첫 달로 돌아간 뒤 다음 달로 넘긴다) */
async function showMonthOf(section: Locator, date: string) {
  const calendar = resultCalendar(section);
  if ((await calendar.locator(`button[data-date="${date}"]`).count()) > 0) return;
  const prev = section.getByRole("button", { name: "이전 달" });
  while (await prev.isEnabled()) await prev.click();
  for (let i = 0; i < 13; i++) {
    if ((await calendar.locator(`button[data-date="${date}"]`).count()) > 0) return;
    await section.getByRole("button", { name: "다음 달" }).click();
  }
  throw new Error(`결과 달력에서 ${date}을 찾지 못했습니다.`);
}

/** 결과 달력에서 날짜를 고르고 오른쪽 머리글이 그 날짜로 바뀔 때까지 기다린다 (요청 없음) */
export async function selectResultDate(section: Locator, date: string) {
  await showMonthOf(section, date);
  const day = resultCalendar(section).locator(`button[data-date="${date}"]`);
  await day.click();
  await expect(day).toHaveAttribute("aria-current", "date");
}

/** 결과 달력을 처음 달부터 끝 달까지 넘기며 날짜별 예약 가능 건수(data-available-count)를 모은다 (0건 제외) */
export async function readCalendarCounts(section: Locator): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const prev = section.getByRole("button", { name: "이전 달" });
  while (await prev.isEnabled()) await prev.click();
  const next = section.getByRole("button", { name: "다음 달" });
  for (let i = 0; i < 13; i++) {
    const pairs = await resultCalendar(section)
      .locator("button[data-available-count]")
      .evaluateAll((buttons) => buttons.map((button) => [button.getAttribute("data-date") ?? "", Number(button.getAttribute("data-available-count"))] as const));
    for (const [date, count] of pairs) if (count > 0) counts[date] = count;
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  return counts;
}
