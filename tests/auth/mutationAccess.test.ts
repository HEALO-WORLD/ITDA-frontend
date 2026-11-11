import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * STEP 3-2-2A: 변경 요청용 접근 확인 requireRoleMutationAccess (실제 구현).
 * 쿠키 저장소(next/headers)·users/me·재발급(apiRequestData)은 가짜. 실제 백엔드 요청 없음.
 * P1(RTR-2a): 같은 화면에서 Access가 만료된 뒤의 변경 요청 → 같은 로그인 세션이면 기존 재발급 처리로 복구 후 역할 재확인
 * E2: 로그인 세션 비교를 역할 확인보다 먼저 → 다른 역할 계정으로 바뀌어도 SESSION_CHANGED (같은 세션의 권한 부족만 FORBIDDEN_ROLE)
 * Refresh 만료: 같은 세션에서 복구할 수 없으면 /login?reason=expired로 리다이렉트
 */

const USER = {
  userId: "33333333-3333-4333-8333-333333333333",
  loginId: "clinic_a",
  role: "REQUESTER",
  institutionId: "11111111-1111-4111-8111-111111111111",
  institutionName: "A의원",
  institutionType: "REQUESTER",
};

const state = {
  jar: new Map<string, string>(),
  me: USER as unknown,
  meCalls: 0,
  /** 로그인 세션 쿠키 읽기 실패 재현 */
  loginCookieThrows: false,
  /** users/me가 먼저 돌려줄 결과 (비면 me) */
  meQueue: [] as unknown[],
  /** 재발급 응답: 성공이면 새 토큰 번호, 실패면 던질 오류 */
  reissue: 2 as number | Error,
  reissueCalls: 0,
  /** users/me에 실린 Authorization (복구 뒤 새 토큰으로 확인했는지) */
  meAuth: [] as string[],
};

let session: typeof import("@/lib/auth/session");

before(async () => {
  mock.module("next/headers", {
    namedExports: {
      cookies: async () => ({
        get: (name: string) => {
          if (name === "itda_login_session" && state.loginCookieThrows) throw new Error("cookie store unavailable");
          return state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined;
        },
        set: (name: string, value: string) => void state.jar.set(name, value),
        delete: (cookie: { name: string } | string) => void state.jar.delete(typeof cookie === "string" ? cookie : cookie.name),
      }),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { headers?: Record<string, string>; body?: { refreshToken?: string } } = {}) => {
        if (path === "/api/v1/auth/reissue") {
          state.reissueCalls++;
          if (state.reissue instanceof Error) throw state.reissue;
          if (options.body?.refreshToken !== state.jar.get("itda_refresh_token")) throw new Error("reissue body must use the HttpOnly refresh cookie");
          const n = state.reissue;
          return { accessToken: `access-a${n}`, tokenType: "Bearer", expiresIn: 45, refreshToken: `refresh-a${n}`, refreshExpiresIn: 1209600 };
        }
        if (path !== "/api/v1/users/me") throw new Error(`unexpected request ${path}`);
        state.meCalls++;
        state.meAuth.push(options.headers?.Authorization ?? "");
        const result = state.meQueue.length > 0 ? state.meQueue.shift() : state.me;
        if (result instanceof Error) throw result;
        return result;
      },
    },
  });
  session = await import("@/lib/auth/session");
});

beforeEach(() => {
  state.jar = new Map([
    ["itda_access_token", "access-a1"],
    ["itda_refresh_token", "refresh-a1"],
    ["itda_login_session", "login-session-a-1"],
  ]);
  state.me = USER;
  state.meCalls = 0;
  state.loginCookieThrows = false;
  state.meQueue = [];
  state.reissue = 2;
  state.reissueCalls = 0;
  state.meAuth = [];
});

const tagOf = (value: string) => session.toSessionTag(value);
const rendered = () => tagOf("login-session-a-1");

describe("requireRoleMutationAccess", () => {
  it("렌더링 세션 = 현재 쿠키 세션이면 기존 접근 확인 결과(헤더·사용자) 그대로", async () => {
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(access.ok, true);
    assert.deepEqual(access.ok && access.headers, { Authorization: "Bearer access-a1" });
    assert.equal(state.meCalls, 1);
  });

  it("다른 탭에서 다른 계정(같은 기관 사용자 포함)으로 로그인 → SESSION_CHANGED (권한 부족과 구분)", async () => {
    state.jar.set("itda_login_session", "login-session-b-1");
    state.jar.set("itda_access_token", "access-b1");
    state.me = { ...USER, userId: "44444444-4444-4444-8444-444444444444", loginId: "clinic_a2" }; // 같은 기관 다른 사용자
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.deepEqual(access, { ok: false, reason: "SESSION_CHANGED", message: session.SESSION_CHANGED_MESSAGE });
    assert.equal(state.meCalls, 0, "세션이 다르면 새 계정으로 users/me도 부르지 않는다");
  });

  it("E2: 다른 역할 계정(REQUESTER 화면 → EXAMINER·ADMIN 로그인)으로 바뀌어도 FORBIDDEN이 아니라 SESSION_CHANGED", async () => {
    for (const role of ["EXAMINER", "ADMIN"]) {
      state.jar.set("itda_login_session", `login-session-${role}`);
      state.me = { ...USER, role };
      state.meCalls = 0;
      const access = await session.requireRoleMutationAccess("REFERRING", rendered());
      assert.equal(!access.ok && access.reason, "SESSION_CHANGED", role);
      assert.equal(state.meCalls, 0, role);
    }
  });

  it("다른 탭 로그아웃(토큰·구분 값 쿠키 모두 없음)은 계정 전환이 아니라 SIGNED_OUT", async () => {
    state.jar = new Map();
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(!access.ok && access.reason, "SIGNED_OUT");
    assert.equal(state.meCalls, 0);
  });

  it("같은 계정 재로그인(새 로그인 세션)도 거부", async () => {
    state.jar.set("itda_login_session", "login-session-a-2");
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(!access.ok && access.reason, "SESSION_CHANGED");
  });

  it("Refresh Token 회전(Access·Refresh 쿠키만 바뀜)은 허용", async () => {
    state.jar.set("itda_access_token", "access-a2");
    state.jar.set("itda_refresh_token", "refresh-a2");
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(access.ok, true);
  });

  it("렌더링 세션 인자 누락·형식 오류는 users/me도 부르지 않고 거부 (fail-closed)", async () => {
    for (const expected of [undefined, "", "short", 123, {}, "a".repeat(17), "정확히열여섯글자가아닌값입니다요"]) {
      state.meCalls = 0;
      const access = await session.requireRoleMutationAccess("REFERRING", expected);
      assert.equal(!access.ok && access.reason, "SESSION_CHANGED", String(expected));
      assert.equal(state.meCalls, 0, String(expected));
    }
  });

  it("기존 세션 호환: 명시적 null/null은 허용, null인데 지금 쿠키가 있으면(그 사이 로그인) 거부", async () => {
    state.jar.delete("itda_login_session");
    assert.equal((await session.requireRoleMutationAccess("REFERRING", null)).ok, true);
    state.jar.set("itda_login_session", "login-session-b-1");
    const changed = await session.requireRoleMutationAccess("REFERRING", null);
    assert.equal(!changed.ok && changed.reason, "SESSION_CHANGED");
  });

  it("렌더링 때는 있었는데 지금 쿠키가 없으면 거부", async () => {
    state.jar.delete("itda_login_session");
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(!access.ok && access.reason, "SESSION_CHANGED");
  });

  it("로그인 세션 쿠키 읽기 실패는 거부 (fail-closed)", async () => {
    state.loginCookieThrows = true;
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(!access.ok && access.reason, "SESSION_CHANGED");
  });

  it("기존 인증·인가 결과는 그대로 (로그아웃·만료·역할 불일치는 SESSION_CHANGED로 바꾸지 않음)", async () => {
    // 로그아웃(두 토큰 쿠키 없음): 복구할 Refresh가 없어 SIGNED_OUT. Refresh가 남은 만료는 아래 인증 복구 테스트
    state.jar.delete("itda_access_token");
    state.jar.delete("itda_refresh_token");
    assert.equal(((await session.requireRoleMutationAccess("REFERRING", rendered())) as { reason: string }).reason, "SIGNED_OUT");
    state.jar.set("itda_access_token", "access-a1");
    const { ApiError } = await import("@/lib/api/errors");
    state.me = new ApiError("HTTP", "x", { status: 401 });
    assert.equal(((await session.requireRoleMutationAccess("REFERRING", rendered())) as { reason: string }).reason, "UNAUTHORIZED");
    assert.equal(state.reissueCalls, 0, "Refresh 쿠키가 없으면 재발급하지 않는다");
    state.me = USER;
    assert.equal(((await session.requireRoleMutationAccess("EXAMINING", rendered())) as { reason: string }).reason, "FORBIDDEN_ROLE");
  });
});

describe("requireRoleMutationAccess: Access 만료 뒤 인증 복구 (RTR-2a)", () => {
  it("Access 쿠키 만료 + Refresh 있음 + 같은 로그인 세션 → 재발급 1회(두 쿠키 교체·로그인 세션 유지) 뒤 새 토큰으로 users/me·역할 확인, 허용", async () => {
    state.jar.delete("itda_access_token");
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(access.ok, true);
    assert.deepEqual(access.ok && access.headers, { Authorization: "Bearer access-a2" });
    assert.equal(state.reissueCalls, 1);
    assert.equal(state.jar.get("itda_access_token"), "access-a2");
    assert.equal(state.jar.get("itda_refresh_token"), "refresh-a2");
    assert.equal(state.jar.get("itda_login_session"), "login-session-a-1", "회전은 로그인 세션 값을 바꾸지 않는다");
    assert.deepEqual(state.meAuth, ["Bearer access-a2"]);
  });

  it("Access 쿠키는 있지만 users/me 401(만료) + Refresh 있음 → 같은 방식으로 복구", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    state.meQueue = [new ApiError("HTTP", "expired", { status: 401 })];
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(access.ok, true);
    assert.equal(state.reissueCalls, 1);
    assert.deepEqual(state.meAuth, ["Bearer access-a1", "Bearer access-a2"]);
  });

  it("다른 계정·같은 계정 재로그인(로그인 세션 다름)이면 재발급하지 않고 SESSION_CHANGED", async () => {
    for (const other of ["login-session-b-1", "login-session-a-2"]) {
      state.jar = new Map([
        ["itda_refresh_token", "refresh-b1"],
        ["itda_login_session", other],
      ]);
      state.reissueCalls = 0;
      const access = await session.requireRoleMutationAccess("REFERRING", rendered());
      assert.equal(!access.ok && access.reason, "SESSION_CHANGED", other);
      assert.equal(state.reissueCalls, 0, other);
      assert.equal(state.jar.get("itda_refresh_token"), "refresh-b1", "다른 세션의 토큰을 회전시키지 않는다");
    }
  });

  it("Refresh 만료·재사용(401) → 재발급 실패, 토큰 쿠키 삭제, /login?reason=expired로 리다이렉트 (users/me·변경 요청 0회)", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    for (const code of ["INVALID_REFRESH_TOKEN", "REFRESH_TOKEN_REUSED"]) {
      state.jar = new Map([
        ["itda_refresh_token", "refresh-a1"],
        ["itda_login_session", "login-session-a-1"],
      ]);
      state.meCalls = 0;
      state.reissue = new ApiError("HTTP", "x", { status: 401, code });
      await assert.rejects(session.requireRoleMutationAccess("REFERRING", rendered()), (error: { digest?: string }) => {
        assert.match(String(error.digest), /^NEXT_REDIRECT;[a-z]+;\/login\?reason=expired;/, code);
        return true;
      });
      assert.equal(state.jar.has("itda_refresh_token"), false, code);
      assert.equal(state.jar.has("itda_access_token"), false, code);
      assert.equal(state.meCalls, 0, code);
    }
  });

  it("재발급 일시 장애(네트워크) → 거부하되 Refresh 쿠키 유지(다시 시도 가능)", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    state.jar.delete("itda_access_token");
    state.reissue = new ApiError("NETWORK", "x");
    const access = await session.requireRoleMutationAccess("REFERRING", rendered());
    assert.equal(!access.ok && access.reason, "UNVERIFIED");
    assert.equal(state.jar.get("itda_refresh_token"), "refresh-a1");
  });

  it("복구해도 권한 확인은 그대로: 역할이 다르면 FORBIDDEN_ROLE", async () => {
    state.jar.delete("itda_access_token");
    const access = await session.requireRoleMutationAccess("EXAMINING", rendered());
    assert.equal(!access.ok && access.reason, "FORBIDDEN_ROLE");
    assert.equal(state.reissueCalls, 1);
  });

  it("401이 아닌 사용자 확인 실패(403·5xx)는 재발급하지 않는다", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    for (const status of [403, 500]) {
      state.me = new ApiError("HTTP", "x", { status });
      state.reissueCalls = 0;
      const access = await session.requireRoleMutationAccess("REFERRING", rendered());
      assert.equal(!access.ok && access.reason, "UNVERIFIED", String(status));
      assert.equal(state.reissueCalls, 0, String(status));
    }
  });

  it("렌더링 세션 인자 누락이면 재발급도 하지 않는다 (fail-closed)", async () => {
    state.jar.delete("itda_access_token");
    const access = await session.requireRoleMutationAccess("REFERRING", undefined);
    assert.equal(!access.ok && access.reason, "SESSION_CHANGED");
    assert.equal(state.reissueCalls, 0);
  });
});
