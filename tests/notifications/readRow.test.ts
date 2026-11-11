import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiError } from "@/lib/api/errors";

/**
 * 의뢰기관 알림 읽음 처리 (공용 NotificationRow + 기존 Server Function markNotificationAsReadAction).
 * 실제 네트워크·DB 요청 없음: Gateway 요청(apiRequestData)·users/me·같은 출처 확인·next/headers·next/cache만 가짜로 바꾼다.
 * 클릭·키보드·중복 클릭·실패 후 재시도 흐름은 DOM 테스트 도구가 없어 브라우저에서 실제 컴포넌트로 확인했다 (작업 보고 참고).
 */

const NOTIFICATION = "aaaaaaaa-1111-4111-8111-111111111111";
const TOKEN_HEADERS = { Authorization: "Bearer test" };
/** 화면이 렌더링된 로그인 세션 구분 값 (세션 정합성 경우는 tests/notifications/mutationSession.test.ts) */
const LOGIN = "loginSessionTagA";

const state = {
  calls: [] as { path: string; method?: string; headers?: HeadersInit }[],
  response: null as unknown,
  error: null as unknown,
  refreshCount: 0,
  role: "REFERRING" as string,
};

let NotificationRow: typeof import("@/features/notifications/components/NotificationList").NotificationRow;
let API_META: typeof import("@/features/notifications/components/NotificationList").API_NOTIFICATION_META;
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
      toRoleAccessFailure: () => ({ reason: "FORBIDDEN", message: "x", code: null }),
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
        return state.response;
      },
    },
  });
  ({ NotificationRow, API_NOTIFICATION_META: API_META } = await import("@/features/notifications/components/NotificationList"));
  actions = await import("@/features/notifications/actions");
});

beforeEach(() => {
  state.calls = [];
  state.response = { notificationId: NOTIFICATION, isRead: true, readAt: "2026-11-09T21:00:00" };
  state.error = null;
  state.refreshCount = 0;
  state.role = "REFERRING";
  process.env.NEXT_PUBLIC_API_MODE = "api";
  process.env.NEXT_PUBLIC_API_FEATURES = "notifications,examining-notifications";
  console.error = () => {};
});

afterEach(() => {
  console.error = originalConsoleError;
});

const item = (isRead: boolean) => ({ title: "검사 예약 재조정 필요", message: "장비 장애로 기존 검사 예약을 진행할 수 없습니다.", occurredAt: "2026-11-09T19:45:00", isRead });
const render = (isRead: boolean, pending?: boolean) =>
  renderToStaticMarkup(createElement(NotificationRow, { item: item(isRead), meta: API_META, onMarkAsRead: () => {}, pending }));
/** 버튼 요소들의 여는 태그~닫는 태그 */
const buttonsOf = (html: string) => html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];

describe("NotificationRow: 읽지 않은 알림", () => {
  it("NEW 배지, 내용 영역 버튼(클릭·키보드로 읽음 처리), 오른쪽 위 [읽음으로 표시] Ghost 버튼을 그린다", () => {
    const html = render(false);
    assert.match(html, /aria-label="읽지 않음"[^>]*><span aria-hidden="true">NEW<\/span>/);
    const buttons = buttonsOf(html);
    assert.equal(buttons.length, 2, "내용 버튼 + 읽음으로 표시 버튼");
    // 내용 버튼: 알림 제목·내용을 담고, 스크린리더에 읽음 처리임을 알린다
    assert.match(buttons[0], /^<button type="button"/);
    assert.match(buttons[0], /검사 예약 재조정 필요/);
    assert.match(buttons[0], /\(선택하면 읽음 처리\)/);
    // 읽음으로 표시: 내용 버튼 뒤(오른쪽)에 오는 형제 버튼, 알림을 특정하는 접근성 이름
    assert.match(buttons[1], /aria-label="&#x27;검사 예약 재조정 필요&#x27; 알림 읽음으로 표시"/);
    assert.match(buttons[1], /읽음으로 표시<\/button>$/);
  });

  it("[읽음으로 표시]는 테두리 없는 Ghost 스타일(hover 배경·밑줄, 포커스 표시)이고 행 높이를 늘리지 않는다(위아래 음수 여백)", () => {
    const readButton = buttonsOf(render(false))[1] ?? "";
    const className = readButton.match(/class="([^"]*)"/)?.[1] ?? "";
    assert.doesNotMatch(className, /(^|\s)border(\s|-)/, "테두리 없음");
    for (const token of ["hover:bg-primary-soft", "hover:underline", "focus-visible:outline-2", "h-8", "-my-1.5", "shrink-0", "whitespace-nowrap"]) {
      assert.ok(className.split(/\s+/).includes(token), token);
    }
    // 날짜·NEW와 같은 줄(메타 영역)의 마지막 요소. 모바일은 오른쪽 끝(ml-auto), 넓은 화면은 내용 오른쪽 열
    assert.match(render(false), /<time [^>]*>[^<]*<\/time><span[^>]*aria-label="읽지 않음"[\s\S]*?<\/span><button[^>]*aria-label="[^"]*읽음으로 표시"[\s\S]*<\/button><\/div><\/div><\/li>$/);
    assert.ok(className.split(/\s+/).includes("ml-auto"));
    // 날짜·NEW는 내용 버튼 밖에 있어도 화면에서 읽힌다 (내용 버튼은 제목·본문만)
    const [contentButton = ""] = buttonsOf(render(false));
    assert.doesNotMatch(contentButton, /<time|NEW/);
  });

  it("버튼 안에 버튼을 넣지 않고, 내용 버튼 안에는 문단(p·div) 대신 span만 쓴다", () => {
    const [contentButton = ""] = buttonsOf(render(false));
    assert.ok(contentButton);
    assert.equal((contentButton.match(/<button\b/g) ?? []).length, 1);
    assert.doesNotMatch(contentButton, /<(p|div)\b/);
  });

  it("처리 중이면 두 버튼 모두 잠그고 '처리 중'으로 보인다 (중복 요청 방지)", () => {
    const buttons = buttonsOf(render(false, true));
    assert.ok(buttons.every((button) => /disabled=""/.test(button)));
    assert.match(buttons[1], /처리 중<\/button>$/);
  });
});

describe("NotificationRow: 이미 읽은 알림", () => {
  it("NEW 배지·버튼이 없고 내용은 일반 텍스트다 (클릭해도 요청하지 않는다)", () => {
    const html = render(true);
    assert.equal(buttonsOf(html).length, 0);
    assert.doesNotMatch(html, /읽지 않음|NEW/);
    assert.match(html, /검사 예약 재조정 필요/);
    assert.match(html, /opacity-60/, "읽은 알림은 아이콘을 흐리게");
  });
});

describe("기존 Server Function 재사용 (markNotificationAsReadAction)", () => {
  it("PATCH /api/v1/notifications/{id}/read를 1회 보내고 성공하면 refresh로 목록·미읽음 수를 서버 값으로 다시 그린다", async () => {
    const result = await actions.markNotificationAsReadAction("notifications", NOTIFICATION, LOGIN);
    assert.deepEqual(result, { ok: true, notificationId: NOTIFICATION, readAt: "2026-11-09T21:00:00" });
    assert.deepEqual(state.calls, [{ path: `/api/v1/notifications/${NOTIFICATION}/read`, method: "PATCH", headers: TOKEN_HEADERS }]);
    assert.equal(state.refreshCount, 1);
  });

  it("실패하면 실패 결과를 돌려주고 refresh하지 않는다 (화면의 읽음 상태 그대로)", async () => {
    for (const error of [new ApiError("HTTP", "x", { status: 500 }), new ApiError("NETWORK", "x"), new ApiError("HTTP", "x", { status: 404 })]) {
      state.error = error;
      state.refreshCount = 0;
      const result = await actions.markNotificationAsReadAction("notifications", NOTIFICATION, LOGIN);
      assert.equal(result.ok, false);
      assert.equal(state.refreshCount, 0);
    }
  });

  it("의뢰기관 알림 기능으로 검사기관 계정이 요청하면 서버에 보내지 않는다 (역할 구분 유지)", async () => {
    state.role = "EXAMINING";
    const result = await actions.markNotificationAsReadAction("notifications", NOTIFICATION, LOGIN);
    assert.equal(result.ok, false);
    assert.equal(state.calls.length, 0);
  });
});

describe("읽지 않은 알림 수: 목록과 같은 시점의 조회 결과", () => {
  it("의뢰기관 알림 화면은 목록과 함께 unread-count를 조회해 목록 요약에 넘긴다 (현재 페이지 항목으로 세지 않는다)", () => {
    const section = readFileSync(new URL("../../src/features/notifications/components/ApiNotificationSection.tsx", import.meta.url), "utf8");
    assert.match(section, /Promise\.all\(\[\s*loadNotificationPage\([\s\S]*?\),\s*variant === "referring" \? loadUnreadNotificationCount\("notifications"\) : null,\s*\]\)/);
    assert.match(section, /<ApiNotificationList [^>]*unreadCount=\{unreadCount \?\? undefined\}/);
  });

  it("목록 요약은 넘겨받은 수를 그대로 보이고(0건·실패 구분), 없을 때만 레이아웃 값을 쓴다", async () => {
    const { default: ApiNotificationList } = await import("@/features/notifications/components/ApiNotificationList");
    const notifications = [{ id: NOTIFICATION, referralId: NOTIFICATION, type: "RESCHEDULE_REQUIRED", title: "새 알림", message: "m", isRead: false, occurredAt: "2026-11-09T19:45:00", readAt: null }];
    const html = (unreadCount: unknown) => renderToStaticMarkup(createElement(ApiNotificationList, { notifications, page: 0, totalPages: 1, unreadCount } as never));
    assert.match(html({ ok: true, unreadCount: 3 }), /읽지 않은 알림 3건/, "현재 페이지 항목 수(1)가 아니라 조회 값");
    assert.match(html({ ok: true, unreadCount: 0 }), /읽지 않은 알림이 없습니다\./);
    assert.match(html({ ok: false, reason: "NETWORK", message: "x" }), /읽지 않은 알림 수를 확인할 수 없습니다\./);
  });
});

describe("연결·회귀", () => {
  it("API 목록은 내용 버튼과 [읽음으로 표시] 버튼 모두 같은 처리(useApiNotificationRead의 markAsRead)를 쓴다", () => {
    const list = readFileSync(new URL("../../src/features/notifications/components/ApiNotificationList.tsx", import.meta.url), "utf8");
    assert.match(list, /onMarkAsRead=\{\(\) => void markAsRead\(item\)\}/);
    const row = readFileSync(new URL("../../src/features/notifications/components/NotificationList.tsx", import.meta.url), "utf8");
    assert.equal((row.match(/onClick=\{onMarkAsRead\}/g) ?? []).length, 2);
    const hook = readFileSync(new URL("../../src/features/notifications/components/useApiNotificationRead.ts", import.meta.url), "utf8");
    assert.match(hook, /if \(pendingRef\.current\.has\(item\.id\)\) return false;/, "처리 중 같은 알림 재요청 방지");
  });

  it("Mock 알림 목록은 그대로 Mock 읽음 처리(모두 읽음 포함)를 쓰고 Server Function을 부르지 않는다", () => {
    const list = readFileSync(new URL("../../src/features/notifications/components/NotificationList.tsx", import.meta.url), "utf8");
    const mockList = list.slice(list.indexOf("export default function NotificationList"), list.indexOf("export function NotificationRow"));
    assert.match(mockList, /onMarkAsRead=\{\(\) => markAsRead\(item\.id\)\}/);
    assert.match(mockList, /모두 읽음 처리/);
    assert.equal(list.includes("markNotificationAsReadAction"), false);
  });
});
