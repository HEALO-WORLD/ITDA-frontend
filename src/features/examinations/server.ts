import "server-only";

import { isApiError } from "@/lib/api/errors";

import {
  fetchExaminationPage,
  getExaminationListErrorMessage,
  toExaminationProgressItem,
  type ExaminationProgressItem,
} from "./remote";

/**
 * 검사 목록 API 화면용 데이터 (서버 전용).
 * 인증 헤더는 호출한 쪽(서버 컴포넌트)이 넘긴다 (lib/auth/session의 getExaminationAuthorizationHeaders).
 * 실패해도 Mock으로 대체하지 않고 실패 결과를 돌려준다. JSX는 만들지 않는다 (화면은 결과를 보고 렌더링한다).
 */

/** 화면 페이지 크기 (백엔드 기본값과 같다) */
export const EXAMINATION_API_PAGE_SIZE = 10;

export type ExaminationPageLoadResult =
  | {
      ok: true;
      examinations: ExaminationProgressItem[];
      totalElements: number;
      totalPages: number;
      /** 0부터 */
      page: number;
    }
  | {
      ok: false;
      /**
       * - UNAUTHORIZED: 401 (토큰 없음·만료·위조) → 다시 로그인
       * - FORBIDDEN: 403 (EXAMINER가 아님: Gateway ACCESS_DENIED 또는 백엔드 EXAMINATION_ACCESS_DENIED)
       * - ERROR: 그 밖의 실패 (400·404·5xx·연결 실패·응답 형식 오류·설정 오류)
       */
      reason: "UNAUTHORIZED" | "FORBIDDEN" | "ERROR";
      message: string;
      /** Gateway·서비스 오류 코드 (화면에 원인을 덧붙일 때만 쓴다) */
      code: string | null;
    };

/** URL의 `?page=`(1부터) → API page(0부터). 숫자가 아니거나 1보다 작으면 첫 페이지 */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return 0;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
}

export async function loadExaminationPage(page: number, headers: HeadersInit): Promise<ExaminationPageLoadResult> {
  try {
    const data = await fetchExaminationPage({ page, size: EXAMINATION_API_PAGE_SIZE }, { headers });
    return {
      ok: true,
      examinations: data.contents.map(toExaminationProgressItem),
      totalElements: data.totalElements,
      totalPages: data.totalPages,
      page: data.number,
    };
  } catch (error) {
    const status = isApiError(error) && error.kind === "HTTP" ? error.status : null;
    const code = isApiError(error) ? error.code : null;
    if (status !== 401) console.error("[examinations] 검사 목록 조회 실패:", isApiError(error) ? `${error.kind} ${status ?? ""} ${code ?? ""}` : error);
    return {
      ok: false,
      reason: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "ERROR",
      message: getExaminationListErrorMessage(error),
      code,
    };
  }
}
