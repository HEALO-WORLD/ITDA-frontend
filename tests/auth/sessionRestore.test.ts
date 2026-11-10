import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * RTR STEP 3·3-1: Access Token 만료 시 자동 세션 복구.
 * - 브라우저 복구 로직(createSessionRestorer): 같은 탭 중복 방지·Strict Mode 재실행·여러 탭(Web Locks + 잠금 전후 세션 태그 비교)·
 *   로그인 세션 사이 간섭 없음·자동 반복 방지·결과 분류
 * - ApiRoleGate 분기: 만료 + Refresh 쿠키 → 복구 화면 / Refresh 없음 → 로그인 / 403·네트워크 → 복구하지 않음
 * fetch(/auth/session·/auth/reissue)·쿠키·Web Locks·세션은 가짜. 실제 백엔드 요청 없음.
 */

let restoreModule: typeof import("@/features/auth/sessionRestore");

type Reply = { status: number; body: unknown } | "network-error" | "not-json";

/**
 * 탭끼리 공유하는 가짜 브라우저: 쿠키 저장소(Access 있음 여부·Refresh 값), /auth/session·/auth/reissue, Web Locks.
 * /auth/session의 tag는 Refresh 값에서 만든다 (실제 서버는 해시 앞부분). 재발급 성공이면 Refresh가 바뀐다.
 */
function createBrowser(options: { locks?: boolean } = {}) {
  let clock = 1_000_000;
  let seq = 0;
  const shared = {
    replies: [] as Reply[],
    /** POST /auth/reissue 횟수 */
    calls: 0,
    sessionReads: 0,
    /** 재발급 응답을 이 Promise가 풀릴 때까지 붙잡는다 (동시 호출 재현) */
    gate: null as Promise<void> | null,
    /** /auth/session 확인 실패 재현 */
    sessionDown: false,
    cookies: { access: true, refresh: "r0" as string | null },
    now: () => clock,
    advance: (ms: number) => void (clock += ms),
    /** 새 로그인 (다른 계정 포함): 새 Refresh·Access */
    login: () => {
      shared.cookies = { access: true, refresh: `login${++seq}` };
    },
    logout: () => {
      shared.cookies = { access: false, refresh: null };
    },
  };
  let chain: Promise<unknown> = Promise.resolve();
  const locks = {
    request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const run = chain.then(() => callback());
      chain = run.catch(() => undefined);
      return run;
    },
  };
  const fetch = async (input: string, init: RequestInit) => {
    if (input === "/auth/session") {
      assert.equal(init.method, "GET");
      shared.sessionReads++;
      if (shared.sessionDown) throw new TypeError("Failed to fetch");
      const { access, refresh } = shared.cookies;
      return Response.json({ status: access ? "active" : refresh ? "restorable" : "signed-out", tag: refresh ? `tag-${refresh}` : null });
    }
    assert.equal(input, "/auth/reissue");
    assert.equal(init.method, "POST");
    assert.equal(init.body, undefined, "본문에 토큰을 넣지 않는다");
    shared.calls++;
    if (shared.gate) await shared.gate;
    const reply = shared.replies.shift() ?? { status: 200, body: { ok: true } };
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    if (reply === "not-json") return new Response("<html>", { status: 502 });
    if (reply.status === 200 && (reply.body as { ok?: boolean }).ok) shared.cookies = { access: true, refresh: `r${++seq}` };
    return Response.json(reply.body, { status: reply.status });
  };
  const openTab = () => restoreModule.createSessionRestorer({ fetch, locks: options.locks === false ? null : locks, now: shared.now });
  return { shared, openTab };
}

const failureBody = (reason: string, retryable: boolean, reloginRequired: boolean) => ({ ok: false, reason, message: `${reason} 안내`, retryable, reloginRequired });

before(async () => {
  restoreModule = await import("@/features/auth/sessionRestore");
});

describe("같은 탭 중복 재발급 방지", () => {
  it("동시에 여러 번 불러도 /auth/reissue는 한 번만, 결과를 함께 받는다", async () => {
    const { shared, openTab } = createBrowser();
    shared.cookies.access = false;
    let release!: () => void;
    shared.gate = new Promise((resolve) => (release = resolve));
    const tab = openTab();
    const results = [tab.startAuto(), tab.restore(), tab.restore()];
    release();
    const settled = await Promise.all(results);
    assert.equal(shared.calls, 1);
    for (const result of settled) assert.deepEqual(result, { ok: true });
  });

  it("Strict Mode effect 재실행·재마운트: 진행 중이면 같은 요청을 기다리고 새로 보내지 않는다", async () => {
    const { shared, openTab } = createBrowser();
    let release!: () => void;
    shared.gate = new Promise((resolve) => (release = resolve));
    const tab = openTab();
    const first = tab.startAuto();
    const second = tab.startAuto(); // 정리 후 다시 실행된 effect
    assert.equal(first, second);
    release();
    await first;
    assert.equal(shared.calls, 1);
  });

  it("자동 복구는 한 번만: 복구 뒤에도 다시 필요하면(재확인 실패) 60초 동안 자동으로 부르지 않는다, 수동 재시도는 가능", async () => {
    const { shared, openTab } = createBrowser();
    const tab = openTab();
    assert.deepEqual(await tab.startAuto(), { ok: true });
    assert.equal(tab.startAuto(), null, "루프 방지");
    shared.advance(restoreModule.AUTO_RESTORE_COOLDOWN_MS - 1);
    assert.equal(tab.startAuto(), null);
    assert.deepEqual(await tab.restore(), { ok: true });
    assert.equal(shared.calls, 2, "수동 재시도는 다시 부른다");
    shared.advance(restoreModule.AUTO_RESTORE_COOLDOWN_MS);
    assert.notEqual(tab.startAuto(), null, "쿨다운이 지나면 다시 자동 복구 가능");
  });
});

describe("로그인 세션 사이 간섭 없음 (STEP 3-1: 이전 성공 기록 문제)", () => {
  it("A 재발급 → 로그아웃 → B 로그인 → 10초 안에 B 복구: B도 재발급한다 (A의 기록으로 건너뛰지 않음)", async () => {
    const { shared, openTab } = createBrowser();
    shared.cookies.access = false;
    assert.deepEqual(await openTab().startAuto(), { ok: true }, "A 재발급");
    shared.logout();
    shared.login(); // B
    shared.advance(450); // A 재발급 0.45초 뒤 (검증에서 재현한 간격)
    // B의 Access가 무효(쿠키는 있음, users/me 401) → 로그아웃은 문서 전체 이동이므로 새 탭 JS에서 자동 복구
    assert.deepEqual(await openTab().startAuto(), { ok: true });
    assert.equal(shared.calls, 2, "B도 재발급 1회");
  });

  it("A 성공 10초 이후 B 복구도 재발급한다", async () => {
    const { shared, openTab } = createBrowser();
    shared.cookies.access = false;
    await openTab().startAuto();
    shared.logout();
    shared.login();
    shared.advance(11_000);
    shared.cookies.access = false; // B의 Access 쿠키 만료
    assert.deepEqual(await openTab().startAuto(), { ok: true });
    assert.equal(shared.calls, 2);
  });

  it("같은 탭(JS 유지)에서도 A의 결과가 B에 섞이지 않는다: 쿨다운 뒤 B 자동 복구는 재발급한다", async () => {
    const { shared, openTab } = createBrowser();
    const tab = openTab();
    shared.cookies.access = false;
    await tab.startAuto();
    shared.logout();
    shared.login();
    shared.advance(restoreModule.AUTO_RESTORE_COOLDOWN_MS);
    assert.deepEqual(await tab.startAuto(), { ok: true });
    assert.equal(shared.calls, 2);
  });

  it("브라우저 저장소(localStorage)를 쓰지 않는다", async () => {
    const touched: string[] = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        touched.push("localStorage");
        return undefined;
      },
    });
    try {
      const { openTab } = createBrowser();
      await openTab().startAuto();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
    assert.deepEqual(touched, []);
  });
});

describe("여러 탭 동시 복구 (Web Locks + 잠금 전후 세션 태그 비교)", () => {
  it("같은 계정 두 탭이 동시에 자동 복구해도 재발급은 한 번, 나중 탭은 회전된 세션을 확인하고 건너뛴다", async () => {
    const { shared, openTab } = createBrowser();
    shared.cookies.access = false;
    let release!: () => void;
    shared.gate = new Promise((resolve) => (release = resolve));
    const a = openTab().startAuto();
    const b = openTab().startAuto();
    // 두 탭 모두 잠금 전 세션을 읽을 때까지 기다린 뒤 재발급 응답을 푼다
    for (let i = 0; i < 20 && shared.sessionReads < 2; i++) await new Promise((r) => setImmediate(r));
    release();
    assert.deepEqual(await a, { ok: true });
    assert.deepEqual(await b, { ok: true, reusedFromOtherTab: true });
    assert.equal(shared.calls, 1);
  });

  it("잠금 전후 세션이 같으면(다른 탭이 회전시키지 않음) 시간과 관계없이 재발급한다", async () => {
    const { shared, openTab } = createBrowser();
    shared.cookies.access = false;
    await openTab().startAuto();
    shared.cookies.access = false; // 같은 세션에서 다시 만료
    assert.deepEqual(await openTab().startAuto(), { ok: true });
    assert.equal(shared.calls, 2);
  });

  it("세션 확인(/auth/session)에 실패하면 건너뛰지 않고 재발급한다", async () => {
    const { shared, openTab } = createBrowser();
    shared.sessionDown = true;
    assert.deepEqual(await openTab().startAuto(), { ok: true });
    assert.equal(shared.calls, 1);
  });

  it("앞 탭이 실패하면 뒤 탭은 건너뛰지 않고 직접 시도한다 (세션이 바뀌지 않음)", async () => {
    const { shared, openTab } = createBrowser();
    shared.replies = [{ status: 502, body: failureBody("SERVER_ERROR", true, false) }, { status: 200, body: { ok: true } }];
    const a = openTab().startAuto();
    const b = openTab().startAuto();
    assert.equal(((await a) as { reason?: string }).reason, "SERVER_ERROR");
    assert.deepEqual(await b, { ok: true });
    assert.equal(shared.calls, 2);
  });

  it("Web Locks가 없으면 세션 확인 없이 탭 안 중복 방지만 한다 (기존 동작, 탭 사이 동시 호출은 남는 위험)", async () => {
    const { shared, openTab } = createBrowser({ locks: false });
    let release!: () => void;
    shared.gate = new Promise((resolve) => (release = resolve));
    const a = openTab().startAuto();
    const b = openTab().startAuto();
    release();
    await Promise.all([a, b]);
    assert.equal(shared.calls, 2);
    assert.equal(shared.sessionReads, 0);
  });
});

describe("재발급 결과 분류 (자동 재시도 없음)", () => {
  it("재로그인 필요(INVALID_REFRESH_TOKEN·REFRESH_TOKEN_REUSED·NO_REFRESH_TOKEN)는 그대로 전달, 한 번만 호출", async () => {
    for (const reason of ["INVALID_REFRESH_TOKEN", "REFRESH_TOKEN_REUSED", "NO_REFRESH_TOKEN"]) {
      const { shared, openTab } = createBrowser();
      shared.replies = [{ status: 401, body: failureBody(reason, false, true) }];
      const result = await openTab().startAuto();
      assert.deepEqual(result, failureBody(reason, false, true), reason);
      assert.equal(shared.calls, 1, reason);
    }
  });

  it("네트워크 오류·HTML 응답·5xx는 다시 시도 가능한 실패로, 자동으로 다시 보내지 않는다", async () => {
    const cases: [Reply, string][] = [
      ["network-error", "NETWORK"],
      ["not-json", "SERVER_ERROR"],
      [{ status: 502, body: failureBody("SERVER_ERROR", true, false) }, "SERVER_ERROR"],
      [{ status: 504, body: failureBody("TIMEOUT", true, false) }, "TIMEOUT"],
      [{ status: 200, body: { ok: false, reason: "UNKNOWN" } }, "SERVER_ERROR"],
    ];
    for (const [reply, reason] of cases) {
      const { shared, openTab } = createBrowser();
      shared.replies = [reply];
      const tab = openTab();
      const result = (await tab.startAuto()) as { ok: boolean; reason: string; retryable: boolean; reloginRequired: boolean };
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason);
      assert.equal(result.retryable, true);
      assert.equal(result.reloginRequired, false, "일시 장애를 Refresh Token 오류로 분류하지 않음");
      assert.equal(tab.startAuto(), null, "실패 뒤 자동으로 다시 부르지 않음");
      assert.equal(shared.calls, 1);
    }
  });
});

describe("ApiRoleGate: 복구 화면·로그인 이동·문제 안내 분기", () => {
  const auth = {
    state: { status: "signed-out" } as unknown,
    refresh: null as string | null,
  };
  let ApiRoleGate: typeof import("@/components/auth/ApiRoleGate").default;
  class RedirectSignal extends Error {
    readonly to: string;
    constructor(to: string) {
      super(`redirect ${to}`);
      this.to = to;
    }
  }

  before(async () => {
    mock.module("@/lib/auth/session", {
      namedExports: { getAuthState: async () => auth.state, readRefreshToken: async () => auth.refresh, readLoginSessionTag: async () => "login-tag" },
    });
    mock.module("next/navigation", {
      namedExports: {
        redirect: (to: string) => {
          throw new RedirectSignal(to);
        },
        useRouter: () => ({ refresh() {}, replace() {}, push() {} }),
        usePathname: () => "/referring/referrals",
      },
    });
    // 헤더 로고(next/image)·링크(next/link)는 이 분기와 무관해 단순한 요소로 바꾼다 (Node에서 CJS 기본 내보내기 해석 차이)
    mock.module("next/link", { defaultExport: ({ children }: { children: unknown }) => createElement("a", null, children as never) });
    mock.module("next/image", { defaultExport: ({ alt }: { alt: string }) => createElement("img", { alt }) });
    ApiRoleGate = (await import("@/components/auth/ApiRoleGate")).default;
  });
  beforeEach(() => {
    auth.state = { status: "signed-out" };
    auth.refresh = null;
  });

  const run = async () => {
    try {
      const element = await ApiRoleGate({ role: "REFERRING", children: createElement("p", null, "보호 화면") });
      return { html: renderToStaticMarkup(element), redirect: null as string | null };
    } catch (error) {
      if (error instanceof RedirectSignal) return { html: "", redirect: error.to };
      throw error;
    }
  };

  it("Access 없음 + Refresh 쿠키 → 주소 그대로 복구 화면 (보호 화면은 그리지 않음)", async () => {
    auth.refresh = "refresh-cookie";
    const { html, redirect } = await run();
    assert.equal(redirect, null);
    assert.match(html, /로그인 상태를 확인하고 있습니다/);
    assert.doesNotMatch(html, /보호 화면/);
  });

  it("Access 401(만료) + Refresh 쿠키 → 복구 화면", async () => {
    auth.state = { status: "unverified", reason: "UNAUTHORIZED", message: "만료" };
    auth.refresh = "refresh-cookie";
    const { html, redirect } = await run();
    assert.equal(redirect, null);
    assert.match(html, /로그인 상태를 확인하고 있습니다/);
  });

  it("Refresh 쿠키가 없으면 기존처럼 로그인 화면 (미로그인 /login, 401 /login?reason=expired)", async () => {
    assert.equal((await run()).redirect, "/login");
    auth.state = { status: "unverified", reason: "UNAUTHORIZED", message: "만료" };
    assert.equal((await run()).redirect, "/login?reason=expired");
  });

  it("403·404·네트워크·5xx는 Refresh 쿠키가 있어도 복구하지 않고 기존 문제 안내", async () => {
    auth.refresh = "refresh-cookie";
    for (const reason of ["FORBIDDEN", "NOT_FOUND", "NETWORK", "ERROR"]) {
      auth.state = { status: "unverified", reason, message: `${reason} 안내` };
      const { html, redirect } = await run();
      assert.equal(redirect, null, reason);
      assert.doesNotMatch(html, /로그인 상태를 확인하고 있습니다/, reason);
      assert.match(html, new RegExp(`${reason} 안내`), reason);
    }
  });
});
