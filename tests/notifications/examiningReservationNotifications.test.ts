import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 검사기관 공통 예약 알림 (RESERVATION_CONFIRMED·CANCELED·RESCHEDULED·REASSIGNED) 화면 연동.
 * 실제 네트워크·DB 요청 없음: Gateway 요청(apiRequestData)·users/me(requireRoleAccess)·같은 출처 확인·next/headers·next/cache만 가짜로 바꾼다.
 * 응답 예시는 백엔드 feat/exam-institution-notifications(4bff9e4) NotificationResponse 필드를 따른다 (실제 백엔드 응답 검증 아님).
 */

const EXAM_NOTIFICATION = "bbbbbbbb-2222-4222-8222-222222222222";
const REFERRAL = "cccccccc-3333-4333-8333-333333333333";
const RESERVATION = "dddddddd-4444-4444-8444-444444444444";
const OLD_RESERVATION = "eeeeeeee-5555-4555-8555-555555555555";
const TOKEN_HEADERS = { Authorization: "Bearer test" };
/** 화면이 렌더링된 로그인 세션 구분 값 (RTR 세션 정합성: 변경 요청은 requireRoleMutationAccess로 확인) */
const LOGIN = "loginSessionTagA";
/**
 * 읽음 처리 호출 (렌더링 세션 인자 포함). RTR 브랜치(feat/refresh-token-rotation-fe)는 세 번째 인자 expectedLoginSession을 받고,
 * 그 전 dev 기준 Action은 받지 않는다: 두 기준 모두에서 같은 테스트가 돌도록 선택 인자로 맞춰 부른다
 */
const readAction = (feature: string, id: string, expectedLoginSession: unknown) =>
  (actions.markNotificationAsReadAction as (feature: string, id: string, expectedLoginSession?: unknown) => ReturnType<typeof actions.markNotificationAsReadAction>)(feature, id, expectedLoginSession);

const state = {
  calls: [] as { path: string; method?: string; headers?: HeadersInit; query?: unknown }[],
  response: null as unknown,
  refreshCount: 0,
  role: "EXAMINING" as string,
};

let board: typeof import("@/features/examining-notifications/components/ExaminingNotificationBoard");
let server: typeof import("@/features/notifications/server");
let actions: typeof import("@/features/notifications/actions");
const originalConsoleError = console.error;

before(async () => {
  mock.module("@/lib/auth/session", {
    namedExports: {
      requireRoleAccess: async (role: string) =>
        role === state.role
          ? { ok: true, headers: TOKEN_HEADERS, user: { userId: "u", institutionId: "i" } }
          : { ok: false, reason: "FORBIDDEN_ROLE", message: "이 화면의 정보에 접근할 권한이 없는 계정입니다." },
      requireRoleMutationAccess: async (role: string, expected: unknown) =>
        expected !== LOGIN
          ? { ok: false, reason: "SESSION_CHANGED", message: "다른 탭에서 로그인 계정이 변경되었습니다. 화면을 새로고침한 후 다시 시도해 주세요." }
          : role === state.role
            ? { ok: true, headers: TOKEN_HEADERS, user: { userId: "u", institutionId: "i" } }
            : { ok: false, reason: "FORBIDDEN_ROLE", message: "이 화면의 정보에 접근할 권한이 없는 계정입니다." },
      toRoleAccessFailure: () => ({ reason: "FORBIDDEN", message: "이 화면의 정보에 접근할 권한이 없는 계정입니다.", code: null }),
    },
  });
  mock.module("@/lib/auth/csrf", { namedExports: { isSameOriginHeaders: () => true } });
  mock.module("next/headers", { namedExports: { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) } });
  mock.module("next/cache", { namedExports: { refresh: () => void state.refreshCount++ } });
  mock.module("@/lib/api/client", {
    namedExports: {
      apiRequestData: async (path: string, options: { method?: string; headers?: HeadersInit; query?: unknown } = {}) => {
        state.calls.push({ path, method: options.method, headers: options.headers, query: options.query });
        return state.response;
      },
    },
  });
  board = await import("@/features/examining-notifications/components/ExaminingNotificationBoard");
  server = await import("@/features/notifications/server");
  actions = await import("@/features/notifications/actions");
});

beforeEach(() => {
  state.calls = [];
  state.response = null;
  state.refreshCount = 0;
  state.role = "EXAMINING";
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "notifications,examining-notifications,reservations";
  console.error = () => {};
});

afterEach(() => {
  console.error = originalConsoleError;
});

const dto = (overrides: Record<string, unknown> = {}) => ({
  notificationId: EXAM_NOTIFICATION,
  referralId: REFERRAL,
  type: "RESERVATION_CONFIRMED",
  title: "새 검사 예약이 확정되었습니다",
  message: "2026-11-12 10:00 CT 검사 예약이 확정되었습니다.",
  isRead: false,
  createdAt: "2026-11-11T09:00:00",
  readAt: null,
  reservationId: RESERVATION,
  ...overrides,
});
const page = (contents: unknown[]) => ({ contents, totalElements: contents.length, totalPages: 1, size: 10, number: 0 });

const renderRow = (item: ReturnType<typeof dto>, reservationDetailAvailable = true) =>
  renderToStaticMarkup(
    createElement(board.NotificationRow, {
      item: { id: item.notificationId, title: item.title, message: item.message, occurredAt: item.createdAt, isRead: item.isRead },
      meta: board.getApiNotificationMeta(item.type),
      link: board.getApiNotificationLink({ reservationId: item.reservationId as string | null }, reservationDetailAvailable),
      onMarkAsRead: () => {},
    }),
  );

describe("A~D: 검사기관 예약 알림 유형 표시 (제목·본문은 백엔드 값 그대로)", () => {
  const cases = [
    ["A", "RESERVATION_CONFIRMED", "예약 확정", "새 검사 예약이 확정되었습니다", "CT 검사 예약이 확정되었습니다."],
    ["B", "RESERVATION_CANCELED", "예약 취소", "검사 예약이 취소되었습니다", "의뢰기관이 예약을 취소했습니다."],
    ["C", "RESERVATION_RESCHEDULED", "일정 변경", "검사 예약 일정이 변경되었습니다", "11-13 14:00로 변경되었습니다."],
    ["D", "RESERVATION_REASSIGNED", "기관 변경", "검사 예약이 다른 기관으로 변경되었습니다", "다른 검사기관으로 재예약되었습니다."],
  ] as const;
  for (const [scenario, type, label, title, message] of cases) {
    it(`${scenario}: ${type} → '${label}' 배지 + 백엔드 title·message`, () => {
      const html = renderRow(dto({ type, title, message }));
      assert.match(html, new RegExp(`>${label}</span>`));
      assert.match(html, new RegExp(title));
      assert.match(html, new RegExp(message.replace(/\./g, "\\.")));
      assert.match(html, /aria-label="읽지 않음"/, "읽지 않은 알림 표시");
    });
  }

  it("모르는 유형은 이름을 추측하지 않고 기본 '알림' 배지를 쓴다 (기존 표시 유지)", () => {
    assert.equal(board.getApiNotificationMeta("SOMETHING_NEW"), board.API_NOTIFICATION_META);
    assert.equal(board.getApiNotificationMeta("toString"), board.API_NOTIFICATION_META, "프로토타입 이름에 반응하지 않는다");
  });

  it("읽은 알림은 읽지 않음 표시·읽음 처리 버튼이 없다", () => {
    const html = renderRow(dto({ isRead: true, readAt: "2026-11-11T10:00:00" }));
    assert.doesNotMatch(html, /읽지 않음|읽음 처리/);
  });
});

describe("E: 알림 클릭 이동 (reservationId 우선, referralId로는 이동하지 않음)", () => {
  it("reservationId가 있으면 확정 예약 관리의 예약 상세(?reservationId=)로 이동한다", () => {
    assert.deepEqual(board.getApiNotificationLink({ reservationId: RESERVATION }, true), {
      href: `/examining/reservations?reservationId=${RESERVATION}`,
      label: "예약 상세 보기",
    });
    assert.match(renderRow(dto()), new RegExp(`href="/examining/reservations\\?reservationId=${RESERVATION}"`));
  });

  it("REASSIGNED는 백엔드가 준 (이전) 예약 ID 그대로 이동한다", () => {
    const html = renderRow(dto({ type: "RESERVATION_REASSIGNED", reservationId: OLD_RESERVATION }));
    assert.match(html, new RegExp(`reservationId=${OLD_RESERVATION}`));
  });

  it("reservationId가 없거나 형식이 다르면, 또는 예약 화면이 API 모드가 아니면 이동 버튼을 두지 않는다", () => {
    assert.equal(board.getApiNotificationLink({ reservationId: null }, true), null);
    assert.equal(board.getApiNotificationLink({ reservationId: "../admin" }, true), null);
    assert.equal(board.getApiNotificationLink({ reservationId: RESERVATION }, false), null);
    const html = renderRow(dto({ reservationId: null }));
    assert.doesNotMatch(html, /<a\b/);
    assert.doesNotMatch(html, new RegExp(REFERRAL), "referralId(검사기관 404)로 이동하지 않는다");
  });
});

describe("응답 계약: reservationId (선택·null 허용)", () => {
  it("검사기관 목록: reservationId를 화면 값으로 옮기고 사용자·기관·역할 헤더를 보내지 않는다", async () => {
    state.response = page([dto(), dto({ notificationId: "ffffffff-6666-4666-8666-666666666666", type: "RESERVATION_CANCELED", reservationId: null })]);
    const result = await server.loadNotificationPage("examining-notifications", { page: 0, unreadOnly: true });
    assert.ok(result.ok);
    assert.deepEqual(result.notifications.map((n) => [n.type, n.reservationId]), [["RESERVATION_CONFIRMED", RESERVATION], ["RESERVATION_CANCELED", null]]);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].path, "/api/v1/notifications");
    assert.deepEqual(state.calls[0].headers, TOKEN_HEADERS, "Authorization만 (X-User-Id·X-Institution-Id·X-Role은 Gateway가 채운다)");
    assert.deepEqual(state.calls[0].query, { page: 0, size: 10, isRead: false, referralId: undefined }, "isRead 필터·페이지 크기 유지");
  });

  it("H: 의뢰기관 알림에 reservationId 필드가 없어도 깨지지 않고 null로 맞춘다", async () => {
    state.role = "REFERRING";
    const { reservationId: _omit, ...legacy } = dto({ type: "RESCHEDULE_REQUIRED" });
    void _omit;
    state.response = page([legacy]);
    const result = await server.loadNotificationPage("notifications", { page: 0 });
    assert.ok(result.ok);
    assert.equal(result.notifications[0].reservationId, null);
    assert.equal(result.notifications[0].referralId, REFERRAL, "의뢰기관 referralId 유지");
  });

  it("reservationId 값이 UUID가 아니면 응답 형식 오류로 안내한다 (주소에 쓰지 않는다)", async () => {
    state.response = page([dto({ reservationId: "not-a-uuid" })]);
    const result = await server.loadNotificationPage("examining-notifications", { page: 0 });
    assert.equal(result.ok, false);
  });
});

describe("F~H: 읽음 처리 (기존 Server Function 재사용, 사용자별 읽음은 백엔드 기준)", () => {
  it("F: 검사기관 사용자 A가 읽으면 PATCH 1회 후 refresh로 목록·미읽음 배지를 서버 값으로 다시 그린다", async () => {
    state.response = { notificationId: EXAM_NOTIFICATION, isRead: true, readAt: "2026-11-11T10:00:00" };
    const result = await readAction("examining-notifications", EXAM_NOTIFICATION, LOGIN);
    assert.deepEqual(result, { ok: true, notificationId: EXAM_NOTIFICATION, readAt: "2026-11-11T10:00:00" });
    assert.deepEqual(state.calls, [{ path: `/api/v1/notifications/${EXAM_NOTIFICATION}/read`, method: "PATCH", headers: TOKEN_HEADERS, query: undefined }]);
    assert.equal(state.refreshCount, 1);
  });

  it("G: 같은 기관 사용자 B의 목록은 B 기준 isRead를 그대로 보인다 (프론트는 다른 사용자 상태를 바꾸지 않는다)", async () => {
    state.response = page([dto({ isRead: false, readAt: null })]);
    const result = await server.loadNotificationPage("examining-notifications", { page: 0 });
    assert.ok(result.ok);
    assert.equal(result.notifications[0].isRead, false);
  });

  it("H: 의뢰기관 계정은 검사기관 알림 읽음 처리를 요청하지 않는다 (역할 확인 후에만 요청)", async () => {
    state.role = "REFERRING";
    const result = await readAction("examining-notifications", EXAM_NOTIFICATION, LOGIN);
    assert.equal(result.ok, false);
    assert.equal(state.calls.length, 0);
    assert.equal(state.refreshCount, 0);
  });
});
