import { DEFAULT_API_TIMEOUT_MS, getApiBaseUrl } from "./config";
import { ApiError, getErrorCode, getHttpErrorMessage } from "./errors";
import type { ApiResponseDto } from "./types";

/**
 * Gateway HTTP 요청 (서버·브라우저 공통).
 *
 * - JSON 요청·응답, 제한 시간, 오류 정규화(ApiError)만 맡는다. 재시도·캐시 정책은 두지 않는다.
 * - 인증 정보를 직접 붙이지 않는다. 인증 방식(JWT 헤더·HttpOnly 쿠키)이 확정되면
 *   서버 전용 모듈(`import "server-only"`)에서 `headers`·`credentials`로 넘긴다. 이 파일에 토큰을 두지 않는다.
 * - 응답 타입은 검증하지 않는다. 기능별 매핑 함수에서 서버 DTO를 화면 타입으로 바꾸며 확인한다.
 */

type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 쿼리 파라미터. null·undefined·빈 문자열은 보내지 않는다 (배열 형식은 계약 확정 후 정한다) */
  query?: Record<string, QueryValue>;
  /** JSON으로 직렬화할 요청 본문 */
  body?: unknown;
  headers?: HeadersInit;
  /** 인증 방식 확정 후 쿠키 전송이 필요하면 사용한다 */
  credentials?: RequestCredentials;
  /** 제한 시간(ms). 기본 DEFAULT_API_TIMEOUT_MS */
  timeoutMs?: number;
  /** 호출한 쪽의 취소 신호 (화면 이동·조건 변경 시) */
  signal?: AbortSignal;
}

/** `path`는 `/`로 시작하는 경로 (기준 주소는 config의 getApiBaseUrl) */
export function buildApiUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!path.startsWith("/")) throw new ApiError("CONFIG", `API 경로는 /로 시작해야 합니다: "${path}"`);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    params.append(key, String(value));
  }
  const search = params.toString();
  return `${getApiBaseUrl()}${path}${search ? `?${search}` : ""}`;
}

/**
 * JSON API 요청. 성공 시 해석한 JSON(본문이 없으면 undefined), 실패 시 ApiError를 던진다.
 * TODO(api): 응답 공통 포맷(예: 감싼 data 필드)이 확정되면 여기서 벗기지 말고 기능별 매핑에서 처리할지 함께 정한다.
 */
export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, headers, credentials, timeoutMs = DEFAULT_API_TIMEOUT_MS, signal } = options;
  const url = buildApiUrl(path, query);

  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Accept")) requestHeaders.set("Accept", "application/json");
  const hasBody = body !== undefined;
  if (hasBody && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");

  // 제한 시간과 호출한 쪽의 취소를 한 신호로 합친다 (어느 쪽으로 끝났는지 구분해 오류를 만든다)
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: hasBody ? JSON.stringify(body) : undefined,
        credentials,
        signal: controller.signal,
        // 사용자·기관별 데이터라 공유 캐시에 두지 않는다 (캐시 정책은 기능별로 따로 정한다)
        cache: "no-store",
      });
      text = await response.text();
    } catch (error) {
      if (timedOut) throw new ApiError("TIMEOUT", "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", { cause: error });
      if (signal?.aborted) throw new ApiError("ABORTED", "요청이 취소되었습니다.", { cause: error });
      throw new ApiError("NETWORK", "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.", { cause: error });
    }

    const isJson = (response.headers.get("Content-Type") ?? "").toLowerCase().includes("json");
    if (!response.ok) {
      const errorBody = parseErrorBody(text, isJson);
      throw new ApiError("HTTP", getHttpErrorMessage(response.status), {
        status: response.status,
        code: getErrorCode(errorBody),
        body: errorBody,
      });
    }
    if (text.trim() === "") return undefined as T;
    if (!isJson) {
      throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { status: response.status, body: text });
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new ApiError("PARSE", "서버 응답을 처리하지 못했습니다.", { status: response.status, body: text, cause: error });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * 백엔드 공통 응답(`ApiResponse { success, message, data, timestamp }`)을 받아 `data`만 돌려준다.
 * 감싼 형태가 아니거나 success가 true가 아니면 응답 형식 오류로 본다 (실패는 보통 HTTP 오류로 먼저 걸러진다).
 */
export async function apiRequestData<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const body = await apiRequest<unknown>(path, options);
  if (typeof body !== "object" || body === null || !("data" in body) || (body as ApiResponseDto<unknown>).success !== true) {
    throw new ApiError("PARSE", "서버 응답 형식을 확인할 수 없습니다.", { body });
  }
  return (body as ApiResponseDto<T>).data;
}

/** 오류 응답 본문: JSON이면 해석하고, 아니거나 해석할 수 없으면 문자열 그대로 */
function parseErrorBody(text: string, isJson: boolean): unknown {
  if (text.trim() === "") return null;
  if (!isJson) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
