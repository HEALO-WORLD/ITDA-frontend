import { expect, test, type Page } from "@playwright/test";

/**
 * 읽기 전용 E2E: 의뢰기관 로그인 → 슬롯 검색 화면 → 검색 조건 → 검색 결과 (DB를 바꾸는 요청 없음).
 *
 * 대상: 격리된 E2E 환경 (playwright.config.ts가 E2E_BASE_URL 컨테이너를 docker로 확인한다)
 * 전제 데이터 (백엔드 시드 그대로, 이 테스트는 만들지 않는다)
 * - clinic_a(A의원) ↔ B영상의학과 협약 ACTIVE, clinic_d(D의원)는 협약 없음
 * - 검사 유형·장비·슬롯 0건 → 검색 결과는 빈 상태
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

async function openSlotSearch(page: Page) {
  await page.goto("/referring/slots");
  await expect(page.getByRole("heading", { name: "검사 슬롯 검색" })).toBeVisible();
  await expect(page.locator("#slot-organization")).toBeVisible({ timeout: 30_000 });
}

const resultSection = (page: Page) => page.locator('section[aria-labelledby="slot-result-title"]');
const optionTexts = (page: Page, selectId: string) => page.locator(`#${selectId} option`).allTextContents();

/** [슬롯 검색]을 누르고 실제 Route Handler 응답(200)을 기다린다 */
async function searchAndWait(page: Page) {
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/referring/slots/search" && res.request().method() === "GET");
  await page.getByRole("button", { name: "슬롯 검색", exact: true }).click();
  const res = await response;
  expect(new URL(res.url()).origin, "검색 요청은 E2E 대상 프론트로만 간다").toBe(new URL(page.url()).origin);
  expect(res.status()).toBe(200);
}

test.describe("의뢰기관 슬롯 검색 (읽기 전용)", () => {
  test("clinic_a: 로그인 → 슬롯 검색 화면 → 협약 검사기관 표시 → 검색 조건 변경 → 빈 결과 안내", async ({ page }) => {
    await test.step("의뢰기관 계정으로 로그인하고 의뢰기관 화면으로 이동", async () => {
      await loginAsRequester(page, REQUESTER_WITH_PARTNER);
    });

    await test.step("슬롯 검색 화면: 협력 검사기관은 협약 중인 B영상의학과만", async () => {
      await openSlotSearch(page);
      expect(await optionTexts(page, "slot-organization")).toEqual(["전체", PARTNER_EXAMINER]);
      expect(await optionTexts(page, "slot-exam-type")).toEqual(["전체", "CT", "MRI"]);
    });

    await test.step("검사 유형이 없으면 세부 검사 항목은 선택할 수 없다는 안내 (비활성)", async () => {
      const examItem = page.locator("#slot-exam-item");
      await expect(examItem).toBeDisabled();
      expect(await optionTexts(page, "slot-exam-item")).toEqual([NO_EXAM_ITEMS]);
    });

    await test.step("검색 전 안내", async () => {
      await expect(resultSection(page)).toContainText("검색 조건을 선택한 후 검색 버튼을 눌러 주세요.");
      await expect(resultSection(page)).toContainText("날짜를 선택하지 않으면 오늘부터 31일 동안의 슬롯을 검색합니다.");
    });

    await test.step("조건 없이 검색 → 0건 + 빈 결과 안내", async () => {
      await searchAndWait(page);
      await expect(resultSection(page).getByText("총 0건의 검색 결과가 있습니다.")).toBeVisible();
      await expect(resultSection(page).getByText(EMPTY_RESULT)).toBeVisible();
      await expect(resultSection(page).getByRole("row")).toHaveCount(0);
    });

    await test.step("검사기관·검사 유형을 바꿔 다시 검색 → 같은 빈 결과 안내 (오류 아님)", async () => {
      await page.locator("#slot-organization").selectOption({ label: PARTNER_EXAMINER });
      await page.locator("#slot-exam-type").selectOption("CT");
      await searchAndWait(page);
      await expect(resultSection(page).getByText("총 0건의 검색 결과가 있습니다.")).toBeVisible();
      await expect(resultSection(page).getByText(EMPTY_RESULT)).toBeVisible();
      await expect(resultSection(page).getByRole("alert")).toHaveCount(0);
    });
  });

  test("clinic_d: 협약 검사기관이 없으면 검사기관 선택지가 '전체'뿐이고 검색 결과도 비어 있다 (다른 기관 협약 미노출)", async ({ page }) => {
    await loginAsRequester(page, REQUESTER_WITHOUT_PARTNER);
    await openSlotSearch(page);
    expect(await optionTexts(page, "slot-organization")).toEqual(["전체"]);
    await searchAndWait(page);
    await expect(resultSection(page).getByText("총 0건의 검색 결과가 있습니다.")).toBeVisible();
    await expect(resultSection(page).getByText(EMPTY_RESULT)).toBeVisible();
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
    await openSlotSearch(page);
  });

  const cases = [
    { name: "서버 오류(500)", route: { status: 500, body: "Internal Server Error" }, message: "서버 오류로 검사 슬롯을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요." },
    { name: "로그인 만료(401)", route: { status: 401, body: "" }, message: "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.", loginLink: true },
    { name: "권한 없음(403)", route: { status: 403, body: "" }, message: "검사 슬롯을 검색할 권한이 없습니다. 의뢰기관 계정으로 로그인했는지 확인해 주세요." },
    { name: "연결 실패", route: null, message: "서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 검색해 주세요." },
  ] as const;

  for (const testCase of cases) {
    test(`${testCase.name} → 결과 대신 오류 안내`, async ({ page }) => {
      await page.route("**/referring/slots/search**", (route) =>
        testCase.route ? route.fulfill({ status: testCase.route.status, contentType: "text/plain", body: testCase.route.body }) : route.abort("connectionfailed"),
      );
      await page.getByRole("button", { name: "슬롯 검색", exact: true }).click();
      const alert = resultSection(page).getByRole("alert");
      await expect(alert).toContainText(testCase.message);
      await expect(resultSection(page).getByText(/총 \d+건의 검색 결과가 있습니다\./)).toHaveCount(0);
      if ("loginLink" in testCase) await expect(alert.getByRole("link", { name: "로그인 화면으로 이동" })).toBeVisible();
    });
  }
});
