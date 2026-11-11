import { createRequire } from "node:module";

import type { E2eTarget } from "./environment";

// playwright.config.ts가 먼저 CommonJS로 불러온 environment.ts를 같은 모듈로 쓴다
// (ESM import로 다시 불러오면 Playwright 변환 결과의 이름 있는 내보내기를 찾지 못한다)
const { assertIsolatedE2eTarget } = createRequire(import.meta.url)("./environment.ts") as typeof import("./environment");

/**
 * E2E 전용 Gateway 클라이언트 (db-write 테스트의 데이터 준비·결과 조회용).
 * - E2E_GATEWAY_URL 필수 (기본값 없음). 쓰기 전에 대상 포트의 컨테이너가 격리된 E2E Compose 프로젝트인지 확인한다
 * - 토큰은 메모리에만 두고 출력하지 않는다. 비밀번호는 E2E_TEST_PASSWORD로만 받는다
 * - 응답은 백엔드 공통 형식 { success, message, data }의 data만 돌려준다
 */

export interface GatewaySession {
  loginId: string;
  userId: string;
  institutionId: string;
  role: string;
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  send<T>(method: "POST" | "PUT" | "PATCH", path: string, body: unknown): Promise<T>;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export function resolveE2eGateway(raw: string | undefined = process.env.E2E_GATEWAY_URL): E2eTarget {
  const value = raw?.trim();
  if (!value) throw new Error("E2E_GATEWAY_URL 환경변수를 지정해 주세요 (E2E 전용 Gateway, 예: http://127.0.0.1:18080). 기본값은 없습니다.");
  const url = new URL(value);
  const target: E2eTarget = { baseURL: url.origin, host: url.hostname, port: url.port || (url.protocol === "https:" ? "443" : "80") };
  assertIsolatedE2eTarget(target);
  return target;
}

async function request<T>(gateway: E2eTarget, method: string, path: string, init: { token?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const url = new URL(path, gateway.baseURL);
  for (const [key, value] of Object.entries(init.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let json: { success?: boolean; data?: T; code?: string; message?: string } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok || json?.success !== true) {
    // 응답 본문 전체·토큰은 남기지 않는다 (코드·메시지만)
    throw new GatewayError(`${method} ${url.pathname} → ${response.status} ${json?.code ?? ""} ${json?.message ?? ""}`.trim(), response.status, json?.code ?? null);
  }
  return json.data as T;
}

export async function loginGateway(gateway: E2eTarget, loginId: string, password: string): Promise<GatewaySession> {
  if (!password) throw new Error("E2E_TEST_PASSWORD 환경변수가 없습니다 (비밀번호는 코드에 저장하지 않음).");
  const token = await request<{ accessToken: string }>(gateway, "POST", "/api/v1/auth/login", { body: { loginId, password } });
  const me = await request<{ userId: string; institutionId: string; role: string }>(gateway, "GET", "/api/v1/users/me", { token: token.accessToken });
  return {
    loginId,
    userId: me.userId,
    institutionId: me.institutionId,
    role: me.role,
    get: (path, query) => request(gateway, "GET", path, { token: token.accessToken, query }),
    send: (method, path, body) => request(gateway, method, path, { token: token.accessToken, body }),
  };
}
