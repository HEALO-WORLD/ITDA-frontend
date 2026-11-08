import { expect, test, type Page, type Response } from "@playwright/test";

import { getSeoulNow } from "../../src/lib/date/seoulDate";

import { loginGateway, resolveE2eGateway } from "./support/gateway";
import { readCalendarCounts, resultCalendar, selectResultDate, slotCards, visibleSlotIds } from "./support/slotResults";

/**
 * 읽기 전용 E2E: 의뢰기관 로그인 → 슬롯 검색 화면 → 검색 조건 → 검색 결과 (DB를 바꾸는 요청 없음).
 *
 * 대상: 격리된 E2E 환경 (playwright.config.ts가 E2E_BASE_URL 컨테이너를, support/gateway가 E2E_GATEWAY_URL 컨테이너를 docker로 확인한다)
 * 전제 데이터 (백엔드 시드, 이 테스트는 만들지 않는다)
 * - clinic_a(A의원) ↔ B영상의학과 협약 ACTIVE, clinic_d(D의원)는 협약 없음
 * - 검사 항목·슬롯은 다른 E2E(db-write)가 만들 수 있다 (삭제 API 없음). 그래서 개수를 고정하지 않고
 *   세부 검사 항목은 E2E Gateway 조회(GET) 결과와, 검색 결과는 화면이 받은 실제 검색 응답과 같은지 확인한다.
 *   0건이면 빈 상태 안내를 그대로 검증한다
 * 보내는 요청: 로그인(POST /auth/login → 백엔드 로그인, DB 쓰기 없음)과 조회(GET)뿐이다.
 * 비밀번호는 E2E_TEST_PASSWORD로만 받는다 (코드에 저장하지 않음).
 */

const password = process.env.E2E_TEST_PASSWORD ?? "";

const REQUESTER_WITH_PARTNER = { loginId: "clinic_a", institution: "A의원" };
const REQUESTER_WITHOUT_PARTNER = { loginId: "clinic_d", institution: "D의원" };
const PARTNER_EXAMINER = "B영상의학과";

const EMPTY_RESULT = "검색 기간에 선택한 조건으로 예약 가능한 검사 슬롯이 없습니다.";
const NO_EXAM_ITEMS = "선택 가능한 검사 항목이 없습니다";

test.beforeEach(() => {
  test.skip(!password, "E2E_TEST_PASSWORD 환경변수가 없어 로그인 테스트를 건너뜁니다 (비밀번호는 코드에 저장하지 않음).");
});

async function fillLogin(page: Page, loginId: string, secret: string) {
  await page.goto("/login");
  await page.getByLabel("로그인 ID").fill(loginId);
  await page.getByLabel("비밀번호").fill(secret);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}

async function loginAsRequester(page: Page, account: { loginId: string; institution: string }) {
  await fillLogin(page, account.loginId, password);
  await expect(page).toHaveURL(/\/referring(?:\/|$)/, { timeout: 20_000 });
  // 헤더: 서버(users/me)가 확인한 실제 기관명·역할
  const header = page.locator("header");
  await expect(header.getByText(account.institution, { exact: true })).toBeVisible();
  await expect(header.getByText(`의뢰기관 담당자 · ${account.loginId}`, { exact: true })).toBeVisible();
}

const isSearchResponse = (res: Response) => new URL(res.url()).pathname === "/referring/slots/search" && res.request().method() === "GET";

/**
 * 슬롯 검색 화면 열기. PC(1280px)는 접속하자마자 기본 조건으로 한 번 자동 검색한다: 그 응답을 기다려 돌려준다.
 * 검색 요청 수도 센다 (Strict Mode·재렌더링으로 중복 요청이 나가지 않는지)
 */
async function openSlotSearch(page: Page): Promise<{ response: Response; requestCount: () => number }> {
  let count = 0;
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/referring/slots/search") count++;
  });
  const response = page.waitForResponse(isSearchResponse, { timeout: 30_000 });
  await page.goto("/referring/slots");
  await expect(page.getByRole("heading", { name: "검사 슬롯 검색" })).toBeVisible();
  // PC: 처음부터 조건 칩 줄 (전체 폼은 숨김)
  await expect(page.locator("#slot-chip-organization")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#slot-organization")).toBeHidden();
  return { response: await response, requestCount: () => count };
}

const resultSection = (page: Page) => page.locator('section[aria-labelledby="slot-result-title"]');
const optionTexts = (page: Page, selectId: string) => page.locator(`#${selectId} option`).allTextContents();

type SearchedSlot = { id: string; startAt: string; organizationName: string; examType: string; isAvailable: boolean };

/** 검색 응답(200)을 확인하고 화면에 보일 슬롯(이미 시작한 슬롯 제외)을 돌려준다 */
async function readSearchResponse(page: Page, res: Response): Promise<SearchedSlot[]> {
  expect(new URL(res.url()).origin, "검색 요청은 E2E 대상 프론트로만 간다").toBe(new URL(page.url()).origin);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; slots: SearchedSlot[] };
  expect(body.ok).toBe(true);
  const now = getSeoulNow().dateTime;
  return body.slots.filter((slot) => slot.startAt > now);
}

/** [검색 적용](PC 조건 칩 줄)을 누르고 실제 Route Handler 응답을 기다린다 */
async function searchAndWait(page: Page): Promise<SearchedSlot[]> {
  const response = page.waitForResponse(isSearchResponse);
  await page.getByRole("button", { name: "검색 적용" }).click();
  return readSearchResponse(page, await response);
}

/** 응답 슬롯을 날짜(`YYYY-MM-DD`, 서울 기준 startAt)별로 나눈다 */
function groupByDate(slots: SearchedSlot[]): Map<string, SearchedSlot[]> {
  const groups = new Map<string, SearchedSlot[]>();
  for (const slot of slots) groups.set(slot.startAt.slice(0, 10), [...(groups.get(slot.startAt.slice(0, 10)) ?? []), slot]);
  return groups;
}

/**
 * 검색 결과 표시가 실제 검색 응답과 같은지 (PC 1280px: 결과 달력 + 시간 카드).
 * 0건이면 빈 상태 안내. 아니면 ① 달력의 날짜별 예약 가능 건수 = 응답의 날짜별 예약 가능 슬롯 수,
 * ② 날짜마다 보이는 시간 버튼의 slotId 집합 = 응답의 그날 슬롯 ID (빠지거나 지어낸 슬롯 없음). onEachDate로 카드 내용을 더 확인한다
 */
async function expectResultsMatch(page: Page, slots: SearchedSlot[], onEachDate?: (date: string) => Promise<void>) {
  const section = resultSection(page);
  await expect(section.getByText(`총 ${slots.length}건의 검색 결과가 있습니다.`)).toBeVisible();
  await expect(section.getByRole("alert")).toHaveCount(0);
  if (slots.length === 0) {
    await expect(section.getByText(EMPTY_RESULT)).toBeVisible();
    await expect(section.getByRole("row")).toHaveCount(0);
    await expect(section.locator("button[data-slot-id]:visible")).toHaveCount(0);
    return;
  }
  await expect(section.getByText(EMPTY_RESULT)).toHaveCount(0);
  await expect(resultCalendar(section)).toBeVisible();
  const byDate = groupByDate(slots);
  const expectedCounts = Object.fromEntries(
    [...byDate].map(([date, items]) => [date, items.filter((slot) => slot.isAvailable).length] as const).filter(([, count]) => count > 0),
  );
  // 새 검색: 처음 선택 날짜 = 예약 가능한 슬롯이 있는 첫 날짜
  const firstDate = Object.keys(expectedCounts).sort()[0];
  await expect(resultCalendar(section).locator('[aria-current="date"]')).toHaveAttribute("data-date", firstDate);
  expect(await readCalendarCounts(section)).toEqual(expectedCounts);
  for (const [date, items] of byDate) {
    await selectResultDate(section, date);
    expect((await visibleSlotIds(section)).sort()).toEqual(items.map((slot) => slot.id).sort());
    await onEachDate?.(date);
  }
}

/**
 * clinic_a 화면의 세부 검사 항목 기대값 (E2E Gateway 조회만): ACTIVE 협약 검사기관 → 운영 중(OPERATIONAL) 장비 →
 * 장비 지원 검사 유형(장비 종류와 같은 것) → 검사 유형 ID로 중복 제거. 화면 서버(slots/server.ts loadPartnerExamTypes)와 같은 기준
 */
async function expectedExamItemIds(): Promise<string[]> {
  const gateway = resolveE2eGateway();
  const session = await loginGateway(gateway, REQUESTER_WITH_PARTNER.loginId, password);
  type Page_<T> = { contents: T[]; totalPages: number };
  const all = async <T>(path: string) => {
    const items: T[] = [];
    for (let page = 0; ; page++) {
      const data = await session.get<Page_<T>>(path, { page, size: 100 });
      items.push(...data.contents);
      if (page + 1 >= data.totalPages) return items;
    }
  };
  const partners = await session.get<{ partnerInstitutionId: string; partnerInstitutionType: string; status: string }[]>("/api/v1/partnerships/me", { status: "ACTIVE" });
  const ids = new Set<string>();
  for (const partner of partners.filter((item) => item.status === "ACTIVE" && item.partnerInstitutionType === "EXAM")) {
    const equipments = await all<{ id: string; modality: string; status: string }>(`/api/v1/institutions/${partner.partnerInstitutionId}/equipments`);
    for (const equipment of equipments.filter((item) => item.status === "OPERATIONAL")) {
      const links = await all<{ examTypeId: string; modality: string }>(`/api/v1/equipments/${equipment.id}/exam-types`);
      for (const link of links.filter((item) => item.modality === equipment.modality)) ids.add(link.examTypeId.toLowerCase());
    }
  }
  return [...ids].sort();
}

test.describe("의뢰기관 슬롯 검색 (읽기 전용)", () => {
  test("clinic_a: 로그인 → 슬롯 검색 화면 → 협약 검사기관 표시 → 검색 조건 변경 → 빈 결과 안내", async ({ page }) => {
    await test.step("의뢰기관 계정으로 로그인하고 의뢰기관 화면으로 이동", async () => {
      await loginAsRequester(page, REQUESTER_WITH_PARTNER);
    });

    let opened: Awaited<ReturnType<typeof openSlotSearch>>;
    await test.step("슬롯 검색 화면: 협력 검사기관은 협약 중인 B영상의학과만", async () => {
      opened = await openSlotSearch(page);
      expect(await optionTexts(page, "slot-organization")).toEqual(["전체", PARTNER_EXAMINER]);
      expect(await optionTexts(page, "slot-exam-type")).toEqual(["전체", "CT", "MRI"]);
    });

    await test.step("세부 검사 항목 = E2E Gateway가 돌려준 협약 기관 지원 검사 유형 (없으면 선택할 수 없다는 안내·비활성)", async () => {
      const examItem = page.locator("#slot-exam-item");
      const expected = await expectedExamItemIds();
      if (expected.length === 0) {
        await expect(examItem).toBeDisabled();
        expect(await optionTexts(page, "slot-exam-item")).toEqual([NO_EXAM_ITEMS]);
      } else {
        await expect(examItem).toBeEnabled();
        const options = examItem.locator("option");
        await expect(options.first()).toHaveText("전체 검사 항목");
        await expect(options.first()).toHaveAttribute("value", "");
        const values = (await options.evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))).slice(1);
        expect(values.map((value) => value.toLowerCase()).sort()).toEqual(expected);
        expect(await optionTexts(page, "slot-exam-item")).not.toContain(NO_EXAM_ITEMS);
      }
    });

    let firstSlots: SearchedSlot[] = [];
    await test.step("최초 접속 → 기본 조건 자동 검색(요청 1번) → 실제 검색 응답과 같은 결과 (0건이면 빈 결과 안내)", async () => {
      // 기본 조건: 협력 검사기관·검사 유형·세부 검사 항목·시간대 전체, 날짜 없음(오늘부터 31일)
      const url = new URL(opened.response.url());
      expect(url.searchParams.get("institutionId")).toBeNull();
      expect(url.searchParams.get("modality")).toBeNull();
      expect(url.searchParams.get("examTypeId")).toBeNull();
      firstSlots = await readSearchResponse(page, opened.response);
      await expectResultsMatch(page, firstSlots);
      expect(opened.requestCount(), "최초 자동 검색 요청은 한 번").toBe(1);
    });

    await test.step("PC: 조건 칩 줄 (협력 검사기관부터, 결과 요약 = 실행한 조건)", async () => {
      await expect(page.locator("#slot-organization")).toBeHidden();
      await expect(page.locator("#slot-chip-organization")).toContainText("협력 검사기관전체");
      await expect(page.getByRole("button", { name: "검색 적용" })).toBeVisible();
      await expect(resultSection(page).getByRole("definition").filter({ hasText: "오늘부터 31일" })).toBeVisible();
    });

    await test.step("검사기관·검사 유형을 바꿔 다시 검색 → 응답과 같은 결과, 모두 B영상의학과·CT (0건이면 빈 결과 안내, 오류 아님)", async () => {
      // 조건 칩을 눌러 바로 고친다 (입력 상태만 바뀜)
      await page.locator("#slot-chip-organization").click();
      await page.getByRole("listbox", { name: "협력 검사기관 선택" }).getByRole("option", { name: PARTNER_EXAMINER }).click();
      await page.locator("#slot-chip-exam-type").click();
      await page.getByRole("listbox", { name: "검사 유형 선택" }).getByRole("option", { name: "CT", exact: true }).click();
      await expect(page.locator("#slot-chip-organization")).toContainText(PARTNER_EXAMINER);
      // 조건을 바꿔도 자동으로 다시 검색하지 않는다
      expect(opened.requestCount()).toBe(1);
      // [검색 적용] 전: 아직 적용되지 않았다는 안내, 결과·결과 요약은 이전 검색 그대로
      await expect(page.getByRole("status").filter({ hasText: "변경한 조건이 아직 검색 결과에 적용되지 않았습니다." })).toBeVisible();
      await expect(resultSection(page).getByText(`총 ${firstSlots.length}건의 검색 결과가 있습니다.`)).toBeVisible();
      const slots = await searchAndWait(page);
      await expect(page.getByText("변경한 조건이 아직 검색 결과에 적용되지 않았습니다.")).toHaveCount(0);
      expect(slots.every((slot) => slot.organizationName === PARTNER_EXAMINER && slot.examType === "CT")).toBe(true);
      await expectResultsMatch(page, slots, async () => {
        for (const card of await slotCards(resultSection(page)).all()) {
          await expect(card).toContainText(PARTNER_EXAMINER);
          await expect(card).toContainText("CT");
        }
      });
      expect(opened.requestCount()).toBe(2);
    });

    await test.step("[초기화] → 기본 조건으로 되돌리고 바로 다시 검색 (칩 줄 유지)", async () => {
      const response = page.waitForResponse(isSearchResponse);
      await page.locator("[data-criteria-chips]").getByRole("button", { name: "초기화" }).click();
      const slots = await readSearchResponse(page, await response);
      expect(new URL((await response).url()).searchParams.get("institutionId")).toBeNull();
      await expect(page.locator("#slot-chip-organization")).toContainText("전체");
      await expect(page.locator("#slot-organization")).toBeHidden();
      await expectResultsMatch(page, slots);
      expect(opened.requestCount()).toBe(3);
    });

    await test.step("새로고침: 다시 기본 조건 자동 검색 1번", async () => {
      const reopened = await openSlotSearch(page);
      await expectResultsMatch(page, await readSearchResponse(page, reopened.response));
      expect(reopened.requestCount()).toBe(1);
    });
  });

  test("clinic_d: 협약 검사기관이 없으면 검사기관 선택지가 '전체'뿐이고 검색 결과도 비어 있다 (다른 기관 협약 미노출)", async ({ page }) => {
    await loginAsRequester(page, REQUESTER_WITHOUT_PARTNER);
    const { response } = await openSlotSearch(page);
    expect(await optionTexts(page, "slot-organization")).toEqual(["전체"]);
    expect(await readSearchResponse(page, response)).toEqual([]);
    await expect(resultSection(page).getByText("총 0건의 검색 결과가 있습니다.")).toBeVisible();
    await expect(resultSection(page).getByText(EMPTY_RESULT)).toBeVisible();
    // 0건이어도 검색 조건 전체 폼이 펼쳐지지 않는다
    await expect(page.locator("#slot-chip-organization")).toBeVisible();
    await expect(page.locator("#slot-organization")).toBeHidden();
    await expect(page.getByText(PARTNER_EXAMINER)).toHaveCount(0);
  });

  test("잘못된 비밀번호: 오류 안내를 보이고 로그인 화면에 머문다 (비밀번호 칸은 비운다)", async ({ page }) => {
    await fillLogin(page, REQUESTER_WITH_PARTNER.loginId, `${password}-wrong`);
    // Next 경로 안내 영역(__next-route-announcer__)도 role=alert라서 문구로 좁힌다
    await expect(page.getByRole("alert").filter({ hasText: "로그인 ID 또는 비밀번호가 올바르지 않습니다." })).toBeVisible();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByLabel("비밀번호")).toHaveValue("");
  });

  test("로그인하지 않은 사용자는 의뢰기관 화면·슬롯 검색 화면에 들어갈 수 없다 (로그인 화면으로 이동)", async ({ page }) => {
    for (const path of ["/referring", "/referring/slots"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
      await expect(page.getByLabel("로그인 ID")).toBeVisible();
    }
    // 검색 Route Handler도 인증 없이 데이터를 주지 않는다
    const res = await page.request.get("/referring/slots/search");
    expect(res.status()).toBe(401);
  });
});

/**
 * 검색 실패 안내: 정상 흐름과 분리한다. 실제 로그인·화면은 그대로 쓰고,
 * 브라우저 → 프론트 검색 Route Handler(/referring/slots/search) 응답만 오류로 바꾼다 (정상 응답을 가짜로 대신하지 않는다).
 */
test.describe("슬롯 검색 오류 안내 (검색 응답만 오류로 대체)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRequester(page, REQUESTER_WITH_PARTNER);
  });

  const cases = [
    { name: "서버 오류(500)", route: { status: 500, body: "Internal Server Error" }, message: "서버 오류로 검사 슬롯을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요." },
    { name: "로그인 만료(401)", route: { status: 401, body: "" }, message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.", loginLink: true },
    { name: "권한 없음(403)", route: { status: 403, body: "" }, message: "검사 슬롯을 검색할 권한이 없습니다. 의뢰기관 계정으로 로그인했는지 확인해 주세요." },
    { name: "연결 실패", route: null, message: "서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 검색해 주세요." },
  ] as const;

  for (const testCase of cases) {
    test(`${testCase.name} → 결과 대신 오류 안내 (최초 자동 검색 실패에도 검색 조건 칩 줄 유지)`, async ({ page }) => {
      await page.route("**/referring/slots/search**", (route) =>
        testCase.route ? route.fulfill({ status: testCase.route.status, contentType: "text/plain", body: testCase.route.body }) : route.abort("connectionfailed"),
      );
      await page.goto("/referring/slots");
      const alert = resultSection(page).getByRole("alert");
      await expect(alert).toContainText(testCase.message, { timeout: 30_000 });
      await expect(resultSection(page).getByText(/총 \d+건의 검색 결과가 있습니다\./)).toHaveCount(0);
      if ("loginLink" in testCase) await expect(alert.getByRole("link", { name: "로그인 화면으로 이동" })).toBeVisible();
      await expect(page.locator("#slot-chip-organization")).toBeVisible();
      await expect(page.locator("#slot-organization")).toBeHidden();
      // [검색 적용]으로 다시 시도할 수 있다
      await expect(page.getByRole("button", { name: "검색 적용" })).toBeEnabled();
    });
  }
});
