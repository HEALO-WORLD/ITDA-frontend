"use server";

import { headers } from "next/headers";

import { isSameOriginHeaders } from "@/lib/auth/csrf";

import { loadExaminingReservation } from "./server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExaminingReservationDetailResult = Awaited<ReturnType<typeof loadExaminingReservation>>;

/**
 * 검사기관 예약 상세 Server Function (확정 예약 화면의 상세 대화상자). 조회만 한다.
 * - 대화상자를 열 때만 부른다 (목록을 그릴 때는 단건 요청이 없다)
 * - 같은 출처·예약 ID 형식을 확인하고, 검사기관 역할 확인은 loadExaminingReservation이 요청 전에 한다
 * - 다른 기관 예약은 백엔드가 404로 막는다 (X-Institution-Id 기준)
 */
export async function loadExaminingReservationDetailAction(reservationId: unknown): Promise<ExaminingReservationDetailResult> {
  if (!isSameOriginHeaders(await headers())) {
    return { ok: false, reason: "FORBIDDEN", message: "허용되지 않은 요청입니다. 화면을 새로고침해 주세요.", code: null };
  }
  if (typeof reservationId !== "string" || !UUID_PATTERN.test(reservationId)) {
    return { ok: false, reason: "ERROR", message: "예약 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null };
  }
  return loadExaminingReservation(reservationId);
}
