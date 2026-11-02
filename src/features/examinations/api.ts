import { getReceivedReservations } from "@/features/reservations/api";
import { mockOnly } from "@/lib/api/config";
import { MOCK_EXAMINATIONS } from "@/lib/dev/mockExaminations";

import type { Examination } from "./types";

/**
 * 검사 진행·결과 데이터 접근 함수 (검사기관).
 *
 * TODO(api): 검사 진행 조회·결과 등록 API가 확정되면 함수 시그니처는 유지하고 내부만 Gateway 호출로 교체한다.
 * 엔드포인트·요청/응답 필드는 백엔드 확인 전이라 임의로 호출하지 않는다.
 */

/** Mock 데이터 사용 여부. 화면에 '개발용 예시 데이터' 표시를 띄우는 데 쓰며, API 연동 시 제거한다 */
export const IS_MOCK_DATA = true;

/**
 * 현재 검사기관의 검사 목록.
 * 기관이 받은 예약(기관 ID로 필터)과 검사 기록을 의뢰 ID로 연결한다.
 * 검사 기록이 없거나 기관이 다른 예약은 포함하지 않는다.
 */
export async function getExaminations(organizationId: string): Promise<Examination[]> {
  mockOnly("examinations.getExaminations");
  const reservations = await getReceivedReservations(organizationId);
  const recordById = new Map(
    MOCK_EXAMINATIONS.filter((record) => record.organizationId === organizationId).map((record) => [
      record.referralId,
      record,
    ]),
  );

  return reservations.flatMap((reservation) => {
    const record = recordById.get(reservation.id);
    if (!record) return [];
    return [
      {
        id: reservation.id,
        referralNumber: reservation.referralNumber,
        virtualPatientId: reservation.virtualPatientId,
        referringOrganizationName: reservation.referringOrganizationName,
        organizationName: reservation.organizationName,
        equipmentName: reservation.equipmentName,
        examType: reservation.examType,
        scheduledAt: reservation.scheduledAt,
        reservationStatus: reservation.status,
        purpose: reservation.purpose,
        requestedAt: reservation.requestedAt,
        progressStatus: record.progressStatus,
        result: record.result,
      },
    ];
  });
}
