import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * RTR STEP 2: `POST /auth/reissue` — HttpOnly Refresh 쿠키로 재발급받아 두 쿠키를 교체한다.
 * Gateway 요청(apiRequestData)·쿠키 저장소(next/headers)·출처 확인은 가짜. 실제 계정·백엔드 요청 없음.
 */

const OLD_ACCESS = "old.access.jwt";
const OLD_REFRESH = "old.refresh.jwt";
const NEW_ACCESS = "new.access.jwt";
const NEW_REFRESH = "new.refresh.jwt";

const tokenDto = (overrides: Record<string, unknown> = {}) => ({
  accessToken: NEW_ACCESS,
  tokenType: "Bearer",
  expiresIn: 1800,
  refreshToken: NEW_REFRESH,
  refreshExpiresIn: 604_800,
  ...overrides,
});

type CookieOptions = Record<string, unknown>;
type Call = { path: string; method: string; body?: unknown; headers?: HeadersInit };

const state = {
  sameOrigin: true,
  reissue: tokenDto() as unknown,
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; options: CookieOptions }[],
  deletes: [] as CookieOptions[],
  calls: [] as Call[],
};

function reset() {
  state.sameOrigin = true;
  state.reissue = tokenDto();
  state.jar = new Map([
    ["itda_access_token", OLD_ACCESS],
    ["itda_refresh_token", OLD_REFRESH],
  ]);
  state.sets = [];
  state.deletes = [];
  state.calls = [];
  process.env.NEXT_PUBLIC_API_MODE = "api";
}

const take = (value: unknown) => {
  if (value instanceof Error) throw value;
  return value;
};

let route: typeof import("@/app/auth/reissue/route");

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
      apiRequestData: async (path: string, options: { method?: string; body?: unknown; headers?: HeadersInit } = {}) => {
        state.calls.push({ path, method: options.method ?? "GET", body: options.body, headers: options.headers });
        if (path === "/api/v1/auth/reissue") return take(state.reissue);
        throw new Error(`unexpected request ${path}`);
      },
    },
  });
  route = await import("@/app/auth/reissue/route");
});

beforeEach(reset);

/** 브라우저가 본문에 다른 Refresh Token을 넣어 보내도 쓰지 않는지 함께 확인한다 */
const reissueRequest = () =>
  new Request("http://localhost/auth/reissue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "attacker.supplied.token" }),
  });

/** console.error를 모아 돌려준다 (토큰이 로그에 남지 않는지 확인용) */
async function call() {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const response = await route.POST(reissueRequest());
    const text = await response.text();
    return { response, text, body: JSON.parse(text), logged: JSON.stringify(logged) };
  } finally {
    console.error = original;
  }
}

const TOKEN_PATTERN = /old\.access|old\.refresh|new\.access|new\.refresh|attacker/;
const COOKIE = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
const expectCookiesKept = (label: string) => {
  assert.deepEqual(state.sets, [], `${label}: 쿠키를 새로 쓰지 않음`);
  assert.deepEqual(state.deletes, [], `${label}: 쿠키를 지우지 않음`);
  assert.equal(state.jar.get("itda_access_token"), OLD_ACCESS, label);
  assert.equal(state.jar.get("itda_refresh_token"), OLD_REFRESH, label);
};
const expectCookiesCleared = (label: string) => {
  assert.deepEqual(state.deletes, [{ name: "itda_access_token", ...COOKIE }, { name: "itda_refresh_token", ...COOKIE }, { name: "itda_login_session", ...COOKIE }], label);
  assert.deepEqual(state.sets, [], label);
  assert.equal(state.jar.size, 0, label);
};

describe("POST /auth/reissue: 성공", () => {
  it("HttpOnly Refresh 쿠키로만, Authorization 없이 백엔드 재발급을 부른다 (요청 본문 값은 쓰지 않음)", async () => {
    await call();
    assert.equal(state.calls.length, 1);
    const [request] = state.calls;
    assert.equal(request.path, "/api/v1/auth/reissue");
    assert.equal(request.method, "POST");
    assert.deepEqual(request.body, { refreshToken: OLD_REFRESH });
    assert.equal(request.headers, undefined, "Authorization 헤더 없음");
  });

  it("두 쿠키를 새 값·새 maxAge로 교체하고, 보안 속성은 그대로", async () => {
    const { response } = await call();
    assert.equal(response.status, 200);
    assert.deepEqual(state.sets, [
      { name: "itda_access_token", value: NEW_ACCESS, options: { ...COOKIE, maxAge: 1800 } },
      { name: "itda_refresh_token", value: NEW_REFRESH, options: { ...COOKIE, maxAge: 604_800 } },
    ]);
    assert.deepEqual(state.deletes, []);
  });

  it("재발급(회전)은 로그인 세션 식별 값을 바꾸지 않고 수명만 늘린다, 없으면 만들지 않는다 (STEP 3-2)", async () => {
    state.jar.set("itda_login_session", "login-session-1");
    await call();
    assert.equal(state.jar.get("itda_login_session"), "login-session-1");
    assert.deepEqual(state.sets.at(-1), { name: "itda_login_session", value: "login-session-1", options: { ...COOKIE, maxAge: 604_800 } });
    reset();
    await call();
    assert.equal(state.jar.has("itda_login_session"), false, "STEP 3-2 이전 세션은 그대로");
    assert.equal(state.sets.length, 2);
  });

  it("브라우저 응답(본문·헤더)에는 성공 여부만 있고 토큰은 없다, 캐시 금지", async () => {
    const { response, text, body } = await call();
    assert.deepEqual(body, { ok: true });
    assert.doesNotMatch(text, TOKEN_PATTERN);
    assert.doesNotMatch(JSON.stringify([...response.headers]), TOKEN_PATTERN);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });

  it("GET 재발급은 만들지 않는다 (POST만 내보낸다)", () => {
    assert.deepEqual(Object.keys(route).filter((key) => /^[A-Z]+$/.test(key)), ["POST"]);
  });
});

describe("POST /auth/reissue: 요청 전 거부", () => {
  it("Refresh 쿠키가 없으면 백엔드를 부르지 않고 재로그인 필요 (Access 쿠키만 있는 기존 세션 포함)", async () => {
    state.jar.delete("itda_refresh_token");
    const { response, body } = await call();
    assert.equal(response.status, 401);
    assert.equal(body.reason, "NO_REFRESH_TOKEN");
    assert.equal(body.reloginRequired, true);
    assert.equal(body.retryable, false);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.sets, []);
  });

  it("다른 출처는 403, 백엔드 호출·쿠키 변경 없음", async () => {
    state.sameOrigin = false;
    const { response, body } = await call();
    assert.equal(response.status, 403);
    assert.equal(body.reason, "FORBIDDEN_ORIGIN");
    assert.equal(state.calls.length, 0);
    expectCookiesKept("다른 출처");
  });

  it("Mock 모드는 백엔드를 부르지 않는다", async () => {
    process.env.NEXT_PUBLIC_API_MODE = "mock";
    const { body } = await call();
    assert.equal(body.reason, "MOCK_MODE");
    assert.equal(state.calls.length, 0);
    expectCookiesKept("Mock 모드");
  });
});

describe("POST /auth/reissue: 실패 유형별 쿠키 처리", () => {
  it("401 INVALID_REFRESH_TOKEN → 두 쿠키 삭제, 인증 만료 결과", async () => {
    state.reissue = new ApiError("HTTP", "x", { status: 401, code: "INVALID_REFRESH_TOKEN" });
    const { response, body } = await call();
    assert.equal(response.status, 401);
    assert.deepEqual(
      { reason: body.reason, retryable: body.retryable, reloginRequired: body.reloginRequired },
      { reason: "INVALID_REFRESH_TOKEN", retryable: false, reloginRequired: true },
    );
    expectCookiesCleared("INVALID_REFRESH_TOKEN");
  });

  it("401 REFRESH_TOKEN_REUSED → 두 쿠키 삭제, 재로그인 필요 결과", async () => {
    state.reissue = new ApiError("HTTP", "x", { status: 401, code: "REFRESH_TOKEN_REUSED" });
    const { response, body, logged } = await call();
    assert.equal(response.status, 401);
    assert.deepEqual(
      { reason: body.reason, retryable: body.retryable, reloginRequired: body.reloginRequired },
      { reason: "REFRESH_TOKEN_REUSED", retryable: false, reloginRequired: true },
    );
    expectCookiesCleared("REFRESH_TOKEN_REUSED");
    assert.doesNotMatch(logged, TOKEN_PATTERN);
  });

  it("코드 없는 401은 만료로 보고 두 쿠키 삭제", async () => {
    state.reissue = new ApiError("HTTP", "x", { status: 401 });
    const { body } = await call();
    assert.equal(body.reason, "INVALID_REFRESH_TOKEN");
    expectCookiesCleared("코드 없는 401");
  });

  it("네트워크·타임아웃·5xx·응답 형식 오류는 기존 쿠키 유지 + 다시 시도 가능 (Refresh Token을 지우지 않음)", async () => {
    const cases: [string, unknown, string, number][] = [
      ["네트워크", new ApiError("NETWORK", "x"), "NETWORK", 503],
      ["타임아웃", new ApiError("TIMEOUT", "x"), "TIMEOUT", 504],
      ["500", new ApiError("HTTP", "x", { status: 500 }), "SERVER_ERROR", 502],
      ["502", new ApiError("HTTP", "x", { status: 502 }), "SERVER_ERROR", 502],
      ["503", new ApiError("HTTP", "x", { status: 503, code: "SERVICE_UNAVAILABLE" }), "SERVER_ERROR", 502],
      ["예상하지 못한 오류", new Error("boom"), "SERVER_ERROR", 502],
    ];
    for (const [label, error, reason, status] of cases) {
      reset();
      state.reissue = error;
      const { response, body, logged } = await call();
      assert.equal(response.status, status, label);
      assert.deepEqual({ reason: body.reason, retryable: body.retryable, reloginRequired: body.reloginRequired }, { reason, retryable: true, reloginRequired: false }, label);
      expectCookiesKept(label);
      assert.doesNotMatch(logged, TOKEN_PATTERN, `${label}: 토큰을 로그에 남기지 않음`);
    }
  });

  it("잘못된 재발급 응답 형식은 거부하고 쿠키를 그대로 둔다", async () => {
    const invalid: [string, unknown][] = [
      ["refreshToken 없음", tokenDto({ refreshToken: undefined })],
      ["refreshToken 빈 값", tokenDto({ refreshToken: " " })],
      ["refreshExpiresIn 0", tokenDto({ refreshExpiresIn: 0 })],
      ["refreshExpiresIn 문자열", tokenDto({ refreshExpiresIn: "604800" })],
      ["accessToken 없음", tokenDto({ accessToken: null })],
      ["expiresIn 소수", tokenDto({ expiresIn: 1.5 })],
      ["Bearer 아님", tokenDto({ tokenType: "bearer" })],
      ["본문 없음", null],
    ];
    for (const [label, data] of invalid) {
      reset();
      state.reissue = data;
      const { response, body, text, logged } = await call();
      assert.equal(response.status, 502, label);
      assert.equal(body.reason, "INVALID_RESPONSE", label);
      assert.equal(body.retryable, true, label);
      expectCookiesKept(label);
      assert.doesNotMatch(text + logged, TOKEN_PATTERN, label);
    }
  });

  it("그 밖의 4xx는 쿠키 유지, 다시 시도 불가", async () => {
    state.reissue = new ApiError("HTTP", "x", { status: 400, code: "INVALID_INPUT" });
    const { response, body } = await call();
    assert.equal(response.status, 400);
    assert.equal(body.reason, "REJECTED");
    assert.equal(body.retryable, false);
    expectCookiesKept("400");
  });
});
