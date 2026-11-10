import type { ReissueFailureReason, ReissueResult } from "./types";

/**
 * 세션 자동 복구 (브라우저 전용 로직, 토큰은 다루지 않는다).
 *
 * Access Token이 만료돼 보호 화면이 복구 화면을 보여 주면, 브라우저가 `POST /auth/reissue`를 한 번 부른다.
 * Refresh Token은 HttpOnly 쿠키라 여기서 읽지 않는다. 결과(성공 여부·구분)만 받는다.
 *
 * 중복 재발급 방지 (백엔드는 같은 Refresh Token 재사용을 10초 유예 뒤 REFRESH_TOKEN_REUSED로 보고 family를 폐기한다)
 * - 같은 탭: 진행 중인 재발급 Promise를 공유한다 (Strict Mode의 effect 재실행·재마운트도 같은 요청을 기다린다)
 * - 여러 탭: Web Locks(같은 출처의 탭끼리만 공유)로 한 번에 한 탭만 재발급한다. 잠금을 기다리기 전과 얻은 뒤에
 *   `GET /auth/session`의 세션 태그(현재 Refresh 쿠키의 해시 일부, 토큰 아님)를 비교해, 그 사이 다른 탭이 회전시켰을 때만
 *   다시 부르지 않고 성공으로 본다 → 쿠키는 탭끼리 공유되므로 화면만 다시 확인하면 된다.
 *   브라우저 저장소에 성공 기록을 남기지 않는다: 이전 로그인 세션(다른 계정 포함)의 기록이 새 세션의 복구를 막지 않는다
 * - 세션 태그를 확인하지 못하면 건너뛰지 않고 재발급한다 (잠금 안이므로 다른 탭이 회전시킨 새 쿠키로 보내 재사용으로 걸리지 않는다)
 * - Web Locks가 없으면 탭 안 중복 방지만 한다 (탭 사이 동시 호출은 백엔드 유예 10초에 기댄다)
 * 자동 시도는 한 번만: 최근 자동 시도가 있으면 다시 자동으로 부르지 않는다 (복구 뒤에도 인증이 안 될 때의 루프 방지)
 */

export const REISSUE_LOCK_NAME = "itda:session-reissue";
/** 이 시간 안에 자동 시도가 또 필요하면 자동으로 부르지 않고 수동 재시도를 안내한다 */
export const AUTO_RESTORE_COOLDOWN_MS = 60_000;
/** 재발급 요청 제한 시간 (서버의 백엔드 요청 제한 10초보다 길게) */
const REISSUE_TIMEOUT_MS = 15_000;

/** 재발급 결과 + 다른 탭의 재발급을 그대로 쓴 경우 표시 */
export type SessionRestoreOutcome = ReissueResult | { ok: true; reusedFromOtherTab: true };
type Failure = Extract<ReissueResult, { ok: false }>;

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}
export interface SessionRestoreDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Web Locks (없으면 null) */
  locks: LockManagerLike | null;
  now: () => number;
}

const failure = (reason: ReissueFailureReason, message: string, retryable: boolean, reloginRequired = false): Failure => ({
  ok: false,
  reason,
  message,
  retryable,
  reloginRequired,
});

const NETWORK_FAILURE = failure("NETWORK", "서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.", true);
const BAD_RESPONSE_FAILURE = failure("SERVER_ERROR", "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", true);

const REASONS: readonly ReissueFailureReason[] = [
  "FORBIDDEN_ORIGIN",
  "MOCK_MODE",
  "CONFIG",
  "NO_REFRESH_TOKEN",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_TOKEN_REUSED",
  "NETWORK",
  "TIMEOUT",
  "SERVER_ERROR",
  "INVALID_RESPONSE",
  "REJECTED",
];

/** Route Handler 응답이 약속한 형식인지 (다르면 서버 오류로 본다) */
export function isReissueResult(value: unknown): value is ReissueResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (result.ok === true) return true;
  return (
    result.ok === false &&
    REASONS.includes(result.reason as ReissueFailureReason) &&
    typeof result.message === "string" &&
    typeof result.retryable === "boolean" &&
    typeof result.reloginRequired === "boolean"
  );
}

/** 현재 세션 쿠키 상태 (`GET /auth/session`). 확인하지 못하면 null */
async function readSession(deps: SessionRestoreDeps): Promise<{ status: string; tag: string | null } | null> {
  try {
    const response = await deps.fetch("/auth/session", { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { status, tag } = body as Record<string, unknown>;
    return typeof status === "string" && (typeof tag === "string" || tag === null) ? { status, tag } : null;
  } catch {
    return null;
  }
}

async function postReissue(deps: SessionRestoreDeps): Promise<ReissueResult> {
  let response: Response;
  try {
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(REISSUE_TIMEOUT_MS) : undefined;
    response = await deps.fetch("/auth/reissue", { method: "POST", headers: { Accept: "application/json" }, cache: "no-store", signal });
  } catch {
    // 서버에 닿았는지 알 수 없다 (이미 회전됐을 수 있음): 자동으로 다시 보내지 않고 수동 재시도를 안내한다
    return NETWORK_FAILURE;
  }
  const body: unknown = await response.json().catch(() => null);
  return isReissueResult(body) ? body : BAD_RESPONSE_FAILURE;
}

/** 탭 하나(브라우저 JS 실행 단위)의 복구 상태. 테스트에서는 탭마다 따로 만든다 */
export function createSessionRestorer(deps: SessionRestoreDeps) {
  let inFlight: Promise<SessionRestoreOutcome> | null = null;
  let lastAutoAt: number | null = null;

  const runExclusive = async (): Promise<SessionRestoreOutcome> => {
    // Web Locks가 없으면 다른 탭과 순서를 맞출 수 없어 확인 없이 바로 보낸다 (기존 동작)
    if (!deps.locks) return postReissue(deps);
    // 잠금을 기다리기 전의 세션: 이 시도가 복구하려는 세션
    const before = await readSession(deps);
    const task = async (): Promise<SessionRestoreOutcome> => {
      // 잠금을 기다리는 동안 다른 탭이 이 세션을 회전시켰으면(태그가 바뀌고 Access 쿠키가 생김) 다시 부르지 않는다.
      // 태그가 같거나 확인하지 못하면 이전 기록과 관계없이 재발급한다
      const current = before?.tag ? await readSession(deps) : null;
      if (current?.status === "active" && current.tag !== null && current.tag !== before?.tag) return { ok: true, reusedFromOtherTab: true };
      return postReissue(deps);
    };
    try {
      return await deps.locks.request(REISSUE_LOCK_NAME, task);
    } catch {
      return NETWORK_FAILURE;
    }
  };

  /** 재발급 (이미 진행 중이면 그 결과를 함께 기다린다) */
  const restore = (): Promise<SessionRestoreOutcome> => {
    inFlight ??= runExclusive().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    restore,
    /**
     * 자동 복구 시작. 진행 중이면 그 요청을 같이 기다리고(Strict Mode 재실행), 최근에 자동 시도를 했으면 null
     * (복구했는데도 인증되지 않아 복구 화면이 다시 나온 경우 → 자동으로 반복하지 않는다)
     */
    startAuto(): Promise<SessionRestoreOutcome> | null {
      if (inFlight) return inFlight;
      if (lastAutoAt !== null && deps.now() - lastAutoAt < AUTO_RESTORE_COOLDOWN_MS) return null;
      lastAutoAt = deps.now();
      return restore();
    },
  };
}

function browserDeps(): SessionRestoreDeps {
  const locks = typeof navigator !== "undefined" && "locks" in navigator ? (navigator.locks as unknown as LockManagerLike) : null;
  return { fetch: (input, init) => window.fetch(input, init), locks, now: () => Date.now() };
}

let browserRestorer: ReturnType<typeof createSessionRestorer> | null = null;

/** 이 탭의 복구 상태 (브라우저에서만 부른다) */
export function getSessionRestorer() {
  browserRestorer ??= createSessionRestorer(browserDeps());
  return browserRestorer;
}
