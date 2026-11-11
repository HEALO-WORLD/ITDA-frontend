import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { ApiError } from "@/lib/api/errors";

/**
 * STEP 3-2-2B-9: 알림 읽음 처리(의뢰기관·검사기관 공통 markNotificationAsReadAction)의 로그인 세션 정합성.
 * 실제 Server Action·remote.ts를 쓰고, Gateway 요청(apiRequestData)·세션 확인·같은 출처·refresh만 가짜.
 * 공통 함수 requireRoleMutationAccess의 실제 비교는 tests/auth/mutationAccess.test.ts. 실제 백엔드 요청 없음.
 */

const NOTIFICATION = "aaaaaaaa-1111-4111-8111-111111111111";
/** 화면이 렌더링된 로그인 세션 구분 값 */
const LOGIN = "loginSessionTagA";
const SESSION_CHANGED = { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." };

const state = {
  /** 지금 쿠키의 로그인 세션 구분 값 (계정 전환·재로그인이면 바뀌고, 토큰 회전이면 그대로) */
  loginSession: LOGIN as string | null,
  /** users/me로 확인된 화면 역할 (null이면 로그인 안 됨) */
  role: "REFERRING" as string | null,
  /** 지금 Access Token (회전하면 바뀐다) */
  token: "access-1",
  accessFailure: null as { ok: false; reason: string; message: string } | null,
  roles: [] as string[],
  calls: [] as { path: string; method?: string; headers?: HeadersInit }[],
  error: null as unknown,
  refreshCount: 0,
};

let actions: typeof import("@/features/notifications/actions");
const originalConsoleError = console.error;

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async () => ({ ok: false, reason: "FORBIDDEN_ROLE", message: "읽음 처리는 requireRoleMutationAccess를 써야 한다" }),
      // 실제 함수와 같은 순서: 형식 확인 → 역할 확인(기존 requireRoleAccess) → 쿠키의 로그인 세션 비교
      requireRoleMutationAccess: async (role: string, expected: unknown) => {
        state.roles.push(role);
        if (expected !== null && typeof expected !== "string") return SESSION_CHANGED;
        if (state.accessFailure) return state.accessFailure;
        if (state.role !== role) return { ok: false, reason: "FORBIDDEN_ROLE", message: "이 화면의 정보에 접근할 권한이 없는 계정입니다." };
        if (expected !== state.loginSession) return SESSION_CHANGED;
        return { ok: true, headers: { Authorization: `Bearer ${state.token}` }, user: { userId: "u", institutionId: "i" } };
      },
      toRoleAccessFailure: (access: { reason: string; message: string }) => ({
        reason: access.reason === "SIGNED_OUT" ? "SIGNED_OUT" : access.reason === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        message: access.message,
        code: null,
      }),
    },
  });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => true } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; headers?: HeadersInit } = {}) => {
        state.calls.push({ path, method: options.method, headers: options.headers });
        if (state.error) throw state.error;
        return { notificationId: NOTIFICATION, isRead: true, readAt: "2026-11-10T10:00:00" };
      },
    },
  });
  actions = await import("@/features/notifications/actions");
});

beforeEach(() => {
  state.loginSession = LOGIN;
  state.token = "access-1";
  state.accessFailure = null;
  state.roles = [];
  state.calls = [];
  state.error = null;
  state.refreshCount = 0;
  console.error = () => {};
});

afterEach(() => {
  console.error = originalConsoleError;
});

const READ = { path: `/api/v1/notifications/${NOTIFICATION}/read`, method: "PATCH" };
/** 기능 이름 → 기존 화면 역할 (단일 역할로 바꾸지 않고 기능별로 그대로) */
const FEATURES = [
  { feature: "notifications", role: "REFERRING", label: "의뢰기관 알림" },
  { feature: "examining-notifications", role: "EXAMINING", label: "검사기관 알림" },
] as const;

describe("알림 읽음 처리: 로그인 세션 정합성 (STEP 3-2-2B-9)", () => {
  for (const { feature, role, label } of FEATURES) {
    describe(`${label} (${feature} → ${role})`, () => {
      beforeEach(() => {
        state.role = role;
      });
      const read = (login?: unknown) => actions.markNotificationAsReadAction(feature, NOTIFICATION, login) as Promise<{ ok: boolean; reason?: string }>;

      it("1. 같은 세션: 기존 역할로 확인, PATCH 1회, 목록·읽지 않은 수 다시 그리기(refresh 1회)", async () => {
        assert.deepEqual(await read(LOGIN), { ok: true, notificationId: NOTIFICATION, readAt: "2026-11-10T10:00:00" });
        assert.deepEqual(state.roles, [role]);
        assert.deepEqual(state.calls.map(({ path, method }) => ({ path, method })), [READ]);
        assert.equal(state.refreshCount, 1);
      });

      for (const [name, tag] of [
        ["2. 다른 계정으로 전환", "loginSessionTagOtherAccount"],
        ["3. 같은 기관 다른 사용자로 전환", "loginSessionTagSameOrgOtherUser"],
        ["4. 같은 계정 재로그인", "loginSessionTagSameAccountAgain"],
      ] as const) {
        it(`${name}: SESSION_CHANGED, 읽음 요청 0회, refresh 0회 (읽음 표시·읽지 않은 수 그대로)`, async () => {
          state.loginSession = tag;
          state.token = "access-2";
          assert.deepEqual(await read(LOGIN), SESSION_CHANGED);
          assert.deepEqual(state.calls, []);
          assert.equal(state.refreshCount, 0);
        });
      }

      it("5. Refresh Token만 회전(로그인 세션 값 그대로, Access Token만 바뀜): 새 토큰으로 정상 처리", async () => {
        state.token = "access-rotated";
        assert.equal((await read(LOGIN)).ok, true);
        assert.deepEqual(state.calls.map((call) => call.headers), [{ Authorization: "Bearer access-rotated" }]);
        assert.equal(state.refreshCount, 1);
      });

      it("6. 렌더링 세션 인자를 빠뜨리면(undefined) 거부, 요청 0회", async () => {
        assert.equal((await read()).reason, "SESSION_CHANGED");
        assert.deepEqual(state.calls, []);
        assert.equal(state.refreshCount, 0);
      });

      it("7. 기존 오류 처리 유지: 400 ERROR·401 UNAUTHORIZED·403 FORBIDDEN·404 NOT_FOUND·500 ERROR·네트워크 NETWORK, 모두 refresh 0회", async () => {
        const cases: [unknown, string][] = [
          [new ApiError("HTTP", "x", { status: 400 }), "ERROR"],
          [new ApiError("HTTP", "x", { status: 401 }), "UNAUTHORIZED"],
          [new ApiError("HTTP", "x", { status: 403 }), "FORBIDDEN"],
          [new ApiError("HTTP", "x", { status: 404 }), "NOT_FOUND"],
          [new ApiError("HTTP", "x", { status: 500 }), "ERROR"],
          [new ApiError("NETWORK", "x"), "NETWORK"],
        ];
        for (const [error, reason] of cases) {
          state.error = error;
          state.refreshCount = 0;
          const result = await read(LOGIN);
          assert.equal(result.reason, reason);
          assert.equal(state.refreshCount, 0);
        }
      });

      it("기존 인증·인가 실패는 SESSION_CHANGED로 덮지 않는다 (만료·로그아웃·역할 불일치)", async () => {
        state.accessFailure = { ok: false, reason: "UNAUTHORIZED", message: "만료" };
        assert.equal((await read(LOGIN)).reason, "UNAUTHORIZED");
        state.accessFailure = { ok: false, reason: "SIGNED_OUT", message: "로그인" };
        assert.equal((await read(LOGIN)).reason, "SIGNED_OUT");
        state.accessFailure = null;
        state.role = role === "REFERRING" ? "EXAMINING" : "REFERRING";
        assert.equal((await read(LOGIN)).reason, "FORBIDDEN");
        assert.deepEqual(state.calls, []);
      });
    });
  }

  it("입력 검증은 그대로 (모르는 기능·형식이 다른 알림 ID는 세션 확인·요청 없이 거부)", async () => {
    const reasonOf = (result: unknown) => (result as { reason?: string }).reason;
    assert.equal(reasonOf(await actions.markNotificationAsReadAction("admin", NOTIFICATION, LOGIN)), "ERROR");
    assert.equal(reasonOf(await actions.markNotificationAsReadAction("notifications", "mock-1", LOGIN)), "ERROR");
    assert.deepEqual(state.roles, []);
    assert.deepEqual(state.calls, []);
  });

  it("화면: 두 알림 화면이 같은 hook으로 렌더링 세션을 보내고, SESSION_CHANGED면 잠가 재전송·읽음 표시 변경 없이 같은 안내만 보인다", () => {
    const hook = readFileSync("src/features/notifications/components/useApiNotificationRead.ts", "utf8").replace(/\r\n/g, "\n");
    assert.match(hook, /markNotificationAsReadAction\(feature, item\.id, renderedLoginSession\)/);
    assert.match(hook, /if \(pendingRef\.current\.has\(item\.id\)\) return false;\n    if \(sessionChangedMessage !== null\) \{\n      setErrorMessage\(sessionChangedMessage\);\n      return false;\n    \}/, "중복 클릭·잠금이면 요청하지 않는다");
    assert.match(hook, /if \(result\.reason === "SESSION_CHANGED"\) markNotificationSessionChanged\(result\.message\);/);
    // 성공했을 때만 읽음 안내를 하고, 화면에서 먼저 읽음으로 바꾸거나 수를 줄이지 않는다
    const code = hook.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /setReadIds|unreadCount|refresh\(/);
    const referring = readFileSync("src/features/notifications/components/ApiNotificationList.tsx", "utf8");
    const examining = readFileSync("src/features/examining-notifications/components/ExaminingApiNotificationBoard.tsx", "utf8");
    assert.match(referring, /useApiNotificationRead\("notifications"\)/);
    assert.match(examining, /useApiNotificationRead\("examining-notifications"\)/);
    assert.doesNotMatch(hook, /\/auth\/session/);
  });
});

/** STEP 3-2-2B-9-FIX: SESSION_CHANGED 뒤 읽음 버튼을 실제 disabled로 잠근다 (공용 행의 선택적 locked, Mock은 넘기지 않는다) */
describe("알림 행 locked: 읽음 버튼 잠금 (STEP 3-2-2B-9-FIX)", () => {
  const item = { id: NOTIFICATION, title: "검사 예약 재조정 필요", message: "m", occurredAt: "2026-11-09T19:45:00", isRead: false };
  const buttonsOf = (html: string) => html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
  const openTag = (button: string) => button.match(/^<button\b[^>]*>/)?.[0] ?? "";

  it("의뢰기관 행: locked면 내용 버튼·[읽음으로 표시] 모두 disabled, '처리 중'·aria-busy 없이 잠금 커서", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { NotificationRow, API_NOTIFICATION_META } = await import("@/features/notifications/components/NotificationList");
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(NotificationRow, { item, meta: API_NOTIFICATION_META, onMarkAsRead: () => {}, ...props }));
    const locked = buttonsOf(render({ pending: false, locked: true }));
    assert.equal(locked.length, 2);
    for (const button of locked) {
      assert.match(openTag(button), /disabled=""/);
      assert.doesNotMatch(openTag(button), /aria-busy="true"/);
    }
    assert.match(locked[0], /disabled:cursor-not-allowed/);
    assert.match(locked[1], /읽음으로 표시<\/button>$/, "잠금은 '처리 중'으로 보이지 않는다");
    // 정상 세션(잠금 없음)은 그대로 누를 수 있고, Mock처럼 locked를 넘기지 않으면 기존 마크업과 같다
    const normal = render({ pending: false, locked: false });
    assert.ok(buttonsOf(normal).every((button) => !/disabled=""/.test(openTag(button))));
    assert.equal(render({ pending: false }), normal, "locked 미지정과 false는 같은 화면");
    assert.match(render({}), /disabled:cursor-wait/, "Mock·처리 중 커서는 기존 그대로");
  });

  it("검사기관 행: locked면 [읽음 처리] disabled(회색 잠금 스타일), 정상·Mock은 기존 그대로", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { NotificationRow, API_NOTIFICATION_META } = await import("@/features/examining-notifications/components/ExaminingNotificationBoard");
    const render = (props: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(NotificationRow, { item, meta: API_NOTIFICATION_META, link: null, onMarkAsRead: () => {}, ...props }));
    const [locked = ""] = buttonsOf(render({ pending: false, locked: true }));
    assert.match(openTag(locked), /disabled=""/);
    assert.match(locked, /disabled:text-gray-400/);
    assert.match(locked, /읽음 처리<\/button>$/);
    const [normal = ""] = buttonsOf(render({ pending: false, locked: false }));
    assert.doesNotMatch(openTag(normal), /disabled=""/);
    const [mockButton = ""] = buttonsOf(render({}));
    assert.doesNotMatch(openTag(mockButton), /disabled=""/);
    assert.doesNotMatch(mockButton, /disabled:text-gray-400/, "Mock(pending 미지정)은 기존 스타일");
  });

  it("두 API 화면이 hook의 locked를 모든 알림 행에 넘기고, 잠긴 동안 계정 전환 안내를 우선 보인다", () => {
    const hook = readFileSync("src/features/notifications/components/useApiNotificationRead.ts", "utf8");
    assert.match(hook, /errorMessage: sessionChangedMessage \?\? errorMessage/);
    assert.match(hook, /locked: sessionChangedMessage !== null/);
    const referring = readFileSync("src/features/notifications/components/ApiNotificationList.tsx", "utf8").replace(/\r\n/g, "\n");
    const examining = readFileSync("src/features/examining-notifications/components/ExaminingApiNotificationBoard.tsx", "utf8").replace(/\r\n/g, "\n");
    assert.match(referring, /pending=\{pendingIds\.has\(item\.id\)\}\n\s*locked=\{locked\}/);
    assert.match(examining, /pending=\{pendingIds\.has\(item\.id\)\}\n\s*locked=\{locked\}/);
    // Mock 화면은 locked를 넘기지 않는다
    const mockReferring = readFileSync("src/features/notifications/components/NotificationList.tsx", "utf8");
    const mockExamining = readFileSync("src/features/examining-notifications/components/ExaminingNotificationBoard.tsx", "utf8");
    assert.doesNotMatch(mockReferring.slice(0, mockReferring.indexOf("export function NotificationRow")), /locked=/);
    assert.doesNotMatch(mockExamining.slice(0, mockExamining.indexOf("export function NotificationRow")), /locked=/);
  });
});
