import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * 로그인 버튼 로딩 상태 (cacheComponents: 떠난 화면을 언마운트하지 않고 Activity로 숨겨 상태를 보존한다).
 * 로그인 성공 뒤 이동했다가 클라이언트 이동으로 /login에 돌아와도 '로그인 중'이 남지 않아야 한다.
 * `POST /auth/login`은 page.route로 가짜 응답한다 (실제 인증 서버·계정·쿠키 없음, DB 변경 없음).
 * 이동 대상은 로그인 없이 열리는 /signup, 세션 만료 경로는 쿠키가 없을 때의 ApiRoleGate redirect("/login")을 쓴다.
 */

type LoginReply = { status?: number; body?: unknown; delayMs?: number; abort?: boolean };

/** 가짜 로그인 응답을 순서대로 돌려주고 호출 횟수를 센다 */
async function mockLogin(page: Page, replies: LoginReply[]) {
  const calls = { count: 0 };
  await page.route("**/auth/login", async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const reply = replies[Math.min(calls.count, replies.length - 1)];
    calls.count++;
    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    if (reply.abort) return route.abort("failed");
    await route.fulfill({ status: reply.status ?? 200, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  return calls;
}

const success = (redirectTo: string): LoginReply => ({ body: { ok: true, redirectTo, message: null } });
const invalid: LoginReply = { status: 401, body: { ok: false, reason: "INVALID_CREDENTIALS", message: "로그인 ID 또는 비밀번호가 올바르지 않습니다." } };

/** 로그인 폼 (회원가입 화면도 Activity로 숨겨진 채 DOM에 남을 수 있어 로그인 폼 안에서만 찾는다) */
const loginForm = (page: Page) => page.locator("form").filter({ has: page.locator("#loginId") });
const loginButton = (page: Page) => loginForm(page).getByRole("button", { name: /^로그인( 중)?$/ });
const formAlert = (page: Page) => loginForm(page).getByRole("alert");

async function fillLogin(page: Page) {
  await page.locator("#loginId").fill("e2e_mock_user");
  await page.locator("#password").fill("not-a-real-password");
}

/** 지금 보이는 로그인 폼 DOM에 표식을 단다 (돌아왔을 때 같은 DOM이 복원됐는지 = 다시 마운트·새로고침이 아닌지 확인) */
async function markLoginForm(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
    document.getElementById("loginId")?.closest("form")?.setAttribute("data-e2e-restored", "1");
  });
}

async function expectRestoredLoginReady(page: Page) {
  await expect(loginButton(page)).toHaveText("로그인");
  await expect(loginButton(page)).toBeEnabled();
  await expect(loginButton(page)).not.toHaveAttribute("aria-busy", "true");
  // 같은 폼 DOM이 Activity에서 복원됐고(재마운트 아님), 문서를 새로 불러오지 않았다
  await expect(page.locator('form[data-e2e-restored="1"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

test.describe("로그인 버튼 로딩 상태", () => {
  test("최초 접근 '로그인' → 요청 중 '로그인 중'·비활성, 중복 클릭·Enter는 1회만 → 실패하면 다시 활성", async ({ page }) => {
    const calls = await mockLogin(page, [{ ...invalid, delayMs: 1_500 }]);
    await page.goto("/login");
    await expect(loginButton(page)).toHaveText("로그인");
    await expect(loginButton(page)).toBeEnabled();

    await fillLogin(page);
    await loginButton(page).click();
    await expect(loginButton(page)).toHaveText("로그인 중");
    await expect(loginButton(page)).toBeDisabled();
    await loginButton(page).click({ force: true });
    await page.locator("#password").press("Enter");
    await page.locator("#password").press("Enter");

    await expect(formAlert(page)).toContainText("올바르지 않습니다");
    await expect(loginButton(page)).toHaveText("로그인");
    await expect(loginButton(page)).toBeEnabled();
    expect(calls.count).toBe(1);
  });

  test("네트워크 오류 뒤 다시 활성, 재시도 가능", async ({ page }) => {
    const calls = await mockLogin(page, [{ abort: true }, invalid]);
    await page.goto("/login");
    await fillLogin(page);
    await loginButton(page).click();
    await expect(formAlert(page)).toContainText("로그인 서버에 문제가 있습니다");
    await expect(loginButton(page)).toHaveText("로그인");
    await expect(loginButton(page)).toBeEnabled();

    await loginButton(page).click();
    await expect(formAlert(page)).toContainText("올바르지 않습니다");
    expect(calls.count).toBe(2);
  });

  test("성공 → redirectTo로 이동 → 링크로 /login 복귀: 복원된 폼이 '로그인'·활성, 재로그인 요청 가능", async ({ page }) => {
    const calls = await mockLogin(page, [success("/signup"), invalid]);
    await page.goto("/login");
    await markLoginForm(page);
    await fillLogin(page);
    await loginButton(page).click();
    await expect(page).toHaveURL(/\/signup$/);
    // 로그인 화면은 언마운트되지 않고 숨겨져 있다 (Activity 보존이 실제로 일어나는 조건인지 확인)
    await expect(page.locator('form[data-e2e-restored="1"]')).toHaveCount(1);
    await expect(page.locator('form[data-e2e-restored="1"]')).toBeHidden();

    await page.locator("main").getByRole("link", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expectRestoredLoginReady(page);
    await expect(page.locator("#loginId")).toHaveValue("");

    await fillLogin(page);
    await loginButton(page).click();
    await expect(formAlert(page)).toContainText("올바르지 않습니다");
    expect(calls.count).toBe(2);
  });

  test("성공 뒤 /login?reason=expired로 클라이언트 이동해도 버튼 정상", async ({ page }) => {
    await mockLogin(page, [success("/signup")]);
    await page.goto("/login");
    await markLoginForm(page);
    await fillLogin(page);
    await loginButton(page).click();
    await expect(page).toHaveURL(/\/signup$/);

    await page.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push("/login?reason=expired"));
    await expect(page).toHaveURL(/\/login\?reason=expired$/);
    await expect(page.getByText("로그인 정보가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.")).toBeVisible();
    await expectRestoredLoginReady(page);
  });

  test("세션 없음 경로: 성공 후 /referring → ApiRoleGate redirect('/login')로 돌아와도 버튼 정상", async ({ page }) => {
    // 가짜 응답이라 토큰 쿠키가 없다 → /referring 레이아웃이 signed-out으로 보고 /login으로 보낸다 (세션 만료로 쿠키가 사라진 경우와 같은 코드 경로)
    await mockLogin(page, [success("/referring")]);
    await page.goto("/login");
    await markLoginForm(page);
    await fillLogin(page);
    await loginButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expectRestoredLoginReady(page);
  });

  test("이동이 늦어지면 이동 중에는 '로그인 중'·비활성, 이동이 끝나면 해제", async ({ page }) => {
    const calls = await mockLogin(page, [success("/signup")]);
    // /signup 화면 요청(RSC 포함)을 늦춰 이동 중 상태를 관찰한다
    await page.route(/\/signup(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    await page.goto("/login");
    await markLoginForm(page);
    await fillLogin(page);
    await loginButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(loginButton(page)).toHaveText("로그인 중");
    await expect(loginButton(page)).toBeDisabled();
    await page.locator("#loginId").press("Enter");
    await expect(page).toHaveURL(/\/signup$/, { timeout: 15_000 });
    expect(calls.count).toBe(1);

    await page.locator("main").getByRole("link", { name: "로그인", exact: true }).click();
    await expectRestoredLoginReady(page);
  });

  test("성공 뒤 브라우저 뒤로 가기로 /login에 돌아와도 버튼 정상", async ({ page }) => {
    await mockLogin(page, [success("/signup")]);
    // 기록: /login → /signup(링크) → /login(링크) → 성공 시 replace(/signup)
    await page.goto("/login");
    await page.locator("main").getByRole("link", { name: "회원가입", exact: true }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await page.locator("main").getByRole("link", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await markLoginForm(page);
    await fillLogin(page);
    await loginButton(page).click();
    await expect(page).toHaveURL(/\/signup$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/signup$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expectRestoredLoginReady(page);
  });
});
