/**
 * 관리자 변경 Server Function 결과 (브라우저로 넘어간다: 토큰·서버 오류 본문을 담지 않는다).
 * - INVALID: 입력값 오류(요청하지 않음) 또는 400 · CONFLICT: 409 (이미 승인됨·중복 요양기관기호·삭제할 수 없음)
 * - NOT_FOUND: 404 · FORBIDDEN: 다른 출처·ADMIN 아님·403 · UNAUTHORIZED: 401 · SIGNED_OUT · NETWORK · ERROR
 */
export type AdminActionResult =
  | { ok: true; message: string }
  | {
      ok: false;
      reason: "INVALID" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "SIGNED_OUT" | "NETWORK" | "ERROR";
      message: string;
      /** 입력 칸별 오류 문구 (기관 등록·수정, 검사 유형 등록·수정) */
      fieldErrors?: Partial<Record<"name" | "type" | "address" | "careInstitutionCode" | "modality", string | null>>;
    };
