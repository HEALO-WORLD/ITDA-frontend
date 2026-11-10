import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * STEP 3-2-2A: 변경 요청용 접근 확인 requireRoleMutationAccess (실제 구현).
 * 쿠키 저장소(next/headers)·users/me(apiRequestData)는 가짜. 실제 백엔드 요청 없음.
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
      }),
    },
  });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string) => {
        if (path !== "/api/v1/users/me") throw new Error(`unexpected request ${path}`);
        state.meCalls++;
        if (state.me instanceof Error) throw state.me;
        return state.me;
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
    state.jar.delete("itda_access_token");
    assert.equal(((await session.requireRoleMutationAccess("REFERRING", rendered())) as { reason: string }).reason, "SIGNED_OUT");
    state.jar.set("itda_access_token", "access-a1");
    const { ApiError } = await import("@/lib/api/errors");
    state.me = new ApiError("HTTP", "x", { status: 401 });
    assert.equal(((await session.requireRoleMutationAccess("REFERRING", rendered())) as { reason: string }).reason, "UNAUTHORIZED");
    state.me = USER;
    assert.equal(((await session.requireRoleMutationAccess("EXAMINING", rendered())) as { reason: string }).reason, "FORBIDDEN_ROLE");
  });
});
