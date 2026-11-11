import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * RTR STEP 1: 로그인 시 Access·Refresh 토큰 쿠키 저장, 로그아웃 시 백엔드 Refresh Token 폐기 + 두 쿠키 삭제.
 * Gateway 요청(apiRequestData)·쿠키 저장소(next/headers)·출처 확인은 가짜. 실제 계정·백엔드 요청 없음.
 */

const ACCESS = "access.jwt.value";
const REFRESH = "refresh.jwt.value";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "11111111-1111-4111-8111-111111111111";

const tokenDto = (overrides: Record<string, unknown> = {}) => ({
  accessToken: ACCESS,
  tokenType: "Bearer",
  expiresIn: 3600,
  refreshToken: REFRESH,
  refreshExpiresIn: 1_209_600,
  ...overrides,
});
const myInfo = (role: string) => ({
  userId: USER_ID,
  loginId: "clinic_a",
  role,
  institutionId: ORG_ID,
  institutionName: "A의원",
  institutionType: role === "EXAMINER" ? "EXAM" : role === "ADMIN" ? "PLATFORM" : "REQUESTER",
});

type CookieOptions = Record<string, unknown>;
type Call = { path: string; method: string; body?: unknown; headers?: HeadersInit; timeoutMs?: number };

const state = {
  sameOrigin: true,
  login: tokenDto() as unknown,
  me: myInfo("REQUESTER") as unknown,
  logout: null as unknown,
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; options: CookieOptions }[],
  deletes: [] as CookieOptions[],
  calls: [] as Call[],
};

function reset() {
  state.sameOrigin = true;
  state.login = tokenDto();
  state.me = myInfo("REQUESTER");
  state.logout = null;
  state.jar = new Map();
  state.sets = [];
  state.deletes = [];
  state.calls = [];
  process.env.NEXT_PUBLIC_API_MODE = "api";
}

const take = (value: unknown) => {
  if (value instanceof Error) throw value;
  return value;
};
const quiet = async <T>(fn: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

let loginRoute: typeof import("@/app/auth/login/route");
let logoutRoute: typeof import("@/app/auth/logout/route");
let navigation: typeof import("@/constants/navigation");

before(async () => {
  reset();
  mock.module("next/headers", {
    namedExports: {
      cookies: async () => ({
        get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
        set: (name: string, value: string, options: CookieOptions) => {
          state.sets.push({ name, value, options });
          state.jar.set(name, value);
        },
        delete: (options: CookieOptions) => {
          state.deletes.push(options);
          state.jar.delete(options.name as string);
        },
      }),
    },
  });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginRequest: () => state.sameOrigin } });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; body?: unknown; headers?: HeadersInit; timeoutMs?: number } = {}) => {
        state.calls.push({ path, method: options.method ?? "GET", body: options.body, headers: options.headers, timeoutMs: options.timeoutMs });
        if (path === "/api/v1/auth/login") return take(state.login);
        if (path === "/api/v1/users/me") return take(state.me);
        if (path === "/api/v1/auth/logout") return take(state.logout);
        throw new Error(`unexpected request ${path}`);
      },
    },
  });
  loginRoute = await import("@/app/auth/login/route");
  logoutRoute = await import("@/app/auth/logout/route");
  navigation = await import("@/constants/navigation");
});

beforeEach(reset);

const loginRequest = (body: unknown = { loginId: "clinic_a", password: "pw" }) =>
  new Request("http://localhost/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const logoutRequest = () => new Request("http://localhost/auth/logout", { method: "POST" });
const cookieNames = () => state.sets.map((cookie) => cookie.name);

describe("로그인: Access·Refresh 토큰 쿠키 저장", () => {
  it("users/me 확인 뒤 두 토큰을 각각 HttpOnly·Secure·SameSite=Lax·path=/ 쿠키에, 만료 시간을 maxAge로 저장", async () => {
    const response = await loginRoute.POST(loginRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(
      state.calls.map((call) => call.path),
      ["/api/v1/auth/login", "/api/v1/users/me"],
    );
    const [access, refresh, loginSession] = state.sets;
    assert.deepEqual([access, refresh], [
      { name: "itda_access_token", value: ACCESS, options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 } },
      { name: "itda_refresh_token", value: REFRESH, options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 1_209_600 } },
    ]);
    // 로그인 세션 식별 쿠키 (STEP 3-2): 무작위 값(토큰 아님), 같은 보안 속성, 수명은 Refresh Token과 같게
    assert.equal(loginSession.name, "itda_login_session");
    assert.match(loginSession.value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(loginSession.value, ACCESS);
    assert.notEqual(loginSession.value, REFRESH);
    assert.deepEqual(loginSession.options, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 1_209_600 });
    assert.equal(state.sets.length, 3);
  });

  it("같은 계정으로 다시 로그인해도 로그인 세션 식별 값은 새로 바뀐다 (다른 탭이 재로그인을 알아챈다)", async () => {
    await loginRoute.POST(loginRequest());
    const first = state.jar.get("itda_login_session");
    await loginRoute.POST(loginRequest());
    const second = state.jar.get("itda_login_session");
    assert.ok(first && second);
    assert.notEqual(first, second);
  });

  it("브라우저 응답(본문·헤더)에는 토큰이 없다", async () => {
    const response = await loginRoute.POST(loginRequest());
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { ok: true, redirectTo: navigation.getHomeRouteForUserRole("REQUESTER"), message: null });
    const headers = JSON.stringify([...response.headers]);
    for (const secret of [ACCESS, REFRESH, "refreshToken", "accessToken"]) {
      assert.doesNotMatch(text, new RegExp(secret.replace(/\./g, "\\.")), secret);
      assert.doesNotMatch(headers, new RegExp(secret.replace(/\./g, "\\.")), secret);
    }
  });

  it("역할별 이동 경로는 그대로 (REQUESTER·EXAMINER·ADMIN)", async () => {
    for (const role of ["REQUESTER", "EXAMINER", "ADMIN"]) {
      reset();
      state.me = myInfo(role);
      const body = await (await loginRoute.POST(loginRequest())).json();
      assert.equal(body.ok, true, role);
      assert.equal(body.redirectTo, navigation.getHomeRouteForUserRole(role as "REQUESTER"), role);
      assert.deepEqual(cookieNames(), ["itda_access_token", "itda_refresh_token", "itda_login_session"], role);
    }
  });

  it("Refresh Token 계약에 맞지 않는 로그인 응답은 거부하고 쿠키를 저장하지 않는다 (users/me도 부르지 않음)", async () => {
    const invalid: [string, Record<string, unknown>][] = [
      ["refreshToken 없음", { refreshToken: undefined }],
      ["refreshToken null (개발용 토큰 응답)", { refreshToken: null, refreshExpiresIn: null }],
      ["refreshToken 빈 문자열", { refreshToken: "  " }],
      ["refreshExpiresIn 없음", { refreshExpiresIn: undefined }],
      ["refreshExpiresIn 0", { refreshExpiresIn: 0 }],
      ["refreshExpiresIn 음수", { refreshExpiresIn: -1 }],
      ["refreshExpiresIn 소수", { refreshExpiresIn: 1.5 }],
      ["refreshExpiresIn 문자열", { refreshExpiresIn: "1209600" }],
      ["accessToken 없음", { accessToken: undefined }],
      ["Bearer 아님", { tokenType: "Basic" }],
      ["expiresIn 0", { expiresIn: 0 }],
    ];
    for (const [name, overrides] of invalid) {
      reset();
      state.login = tokenDto(overrides);
      const response = await quiet(() => loginRoute.POST(loginRequest()));
      const body = await response.json();
      assert.equal(response.status, 502, name);
      assert.equal(body.reason, "SERVER_ERROR", name);
      assert.deepEqual(state.sets, [], name);
      assert.deepEqual(
        state.calls.map((call) => call.path),
        ["/api/v1/auth/login"],
        name,
      );
    }
  });

  it("기존 실패 분기 유지: 401·403 미승인·users/me 실패·다른 출처·잘못된 입력은 쿠키를 저장하지 않는다", async () => {
    const cases: [string, () => void, number, string][] = [
      ["401", () => (state.login = new ApiError("HTTP", "x", { status: 401, code: "INVALID_CREDENTIALS" })), 401, "INVALID_CREDENTIALS"],
      ["403 미승인", () => (state.login = new ApiError("HTTP", "x", { status: 403, code: "USER_NOT_APPROVED" })), 403, "NOT_APPROVED"],
      ["5xx", () => (state.login = new ApiError("HTTP", "x", { status: 500 })), 502, "SERVER_ERROR"],
      ["users/me 401", () => (state.me = new ApiError("HTTP", "x", { status: 401 })), 502, "USER_INFO_FAILED"],
      ["다른 출처", () => (state.sameOrigin = false), 403, "FORBIDDEN_ORIGIN"],
    ];
    for (const [name, arrange, status, reason] of cases) {
      reset();
      arrange();
      const response = await quiet(() => loginRoute.POST(loginRequest()));
      assert.equal(response.status, status, name);
      assert.equal((await response.json()).reason, reason, name);
      assert.deepEqual(state.sets, [], name);
    }
    reset();
    const response = await loginRoute.POST(loginRequest({ loginId: "", password: "pw" }));
    assert.equal((await response.json()).reason, "INVALID_INPUT");
    assert.equal(state.calls.length, 0);
  });

  it("Mock 모드에서는 백엔드를 부르지 않는다", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const response = await loginRoute.POST(loginRequest());
    assert.equal((await response.json()).reason, "MOCK_MODE");
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.sets, []);
  });
});

describe("로그아웃: 백엔드 Refresh Token 폐기 + 두 쿠키 삭제", () => {
  const expectCleared = (label: string) => {
    assert.deepEqual(
      state.deletes,
      [
        { name: "itda_access_token", httpOnly: true, secure: true, sameSite: "lax", path: "/" },
        { name: "itda_refresh_token", httpOnly: true, secure: true, sameSite: "lax", path: "/" },
        { name: "itda_login_session", httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      ],
      label,
    );
    assert.equal(state.jar.size, 0, label);
  };
  const expectRedirect = (response: Response, label: string) => {
    assert.equal(response.status, 303, label);
    assert.equal(response.headers.get("Location"), "/login", label);
    assert.equal(response.headers.get("Cache-Control"), "no-store", label);
  };

  it("Refresh Token이 있으면 Authorization 없이 본문으로 백엔드 로그아웃을 부르고 두 쿠키를 지운다", async () => {
    state.jar.set("itda_access_token", ACCESS);
    state.jar.set("itda_refresh_token", REFRESH);
    const response = await logoutRoute.POST(logoutRequest());
    expectRedirect(response, "성공");
    assert.equal(state.calls.length, 1);
    const [call] = state.calls;
    assert.equal(call.path, "/api/v1/auth/logout");
    assert.equal(call.method, "POST");
    assert.deepEqual(call.body, { refreshToken: REFRESH });
    assert.equal(call.headers, undefined, "Authorization 헤더 없음");
    assert.equal(typeof call.timeoutMs, "number");
    expectCleared("성공");
  });

  it("백엔드 로그아웃이 실패해도(5xx·네트워크·시간 초과·형식 오류) 두 쿠키를 지우고 로그인 화면으로 보낸다", async () => {
    const failures = [
      new ApiError("HTTP", "x", { status: 500 }),
      new ApiError("HTTP", "x", { status: 401, code: "INVALID_REFRESH_TOKEN" }),
      new ApiError("NETWORK", "x"),
      new ApiError("TIMEOUT", "x"),
      new ApiError("PARSE", "x"),
      new Error("unexpected"),
    ];
    for (const failure of failures) {
      reset();
      state.jar.set("itda_access_token", ACCESS);
      state.jar.set("itda_refresh_token", REFRESH);
      state.logout = failure;
      const label = failure instanceof ApiError ? `${failure.kind} ${failure.status ?? ""}` : "Error";
      const logged: unknown[][] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void logged.push(args);
      let response: Response;
      try {
        response = await logoutRoute.POST(logoutRequest());
      } finally {
        console.error = original;
      }
      expectRedirect(response, label);
      expectCleared(label);
      assert.doesNotMatch(JSON.stringify(logged), /refresh\.jwt|access\.jwt/, `${label}: 토큰을 로그에 남기지 않음`);
    }
  });

  it("Refresh Token이 없는 기존 세션은 백엔드를 부르지 않고 두 쿠키를 지운다", async () => {
    state.jar.set("itda_access_token", ACCESS);
    const response = await logoutRoute.POST(logoutRequest());
    expectRedirect(response, "기존 세션");
    assert.equal(state.calls.length, 0);
    expectCleared("기존 세션");
  });

  it("다른 출처는 403: 백엔드 호출·쿠키 삭제 없음", async () => {
    state.sameOrigin = false;
    state.jar.set("itda_refresh_token", REFRESH);
    const response = await logoutRoute.POST(logoutRequest());
    assert.equal(response.status, 403);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.deletes, []);
  });
});
