import { getEquipments } from "@/features/equipment/api";
import { getReceivedReservations } from "@/features/reservations/api";
import { mockOnly } from "@/lib/api/config";
import { MOCK_INCIDENTS } from "@/lib/dev/mockIncidents";

import type { EquipmentIncident, IncidentRecord } from "./types";

/**
 * 장비 장애 데이터 접근 함수 (검사기관).
 *
 * TODO(api): 장비 장애 조회 API가 확정되면 함수 시그니처는 유지하고 내부만 Gateway 호출로 교체한다.
 * - 기관 권한 필터링은 서버가 한다 (지금은 기관 ID로 거른다)
 * - 여기서는 원본 Mock 장애만 본다. 화면에서 등록·복구한 장애와 현재 장비 상태는
 *   IncidentBoard가 개발용 Mock 저장소(mockIncidentStore.ts)를 합쳐 계산한다.
 * - 영향 예약은 장애 데이터에 명시된 예약 ID만 사용한다 (장비명·검사 유형으로 추정하지 않는다)
 */

/** Mock 데이터 사용 여부. 화면에 '개발용 예시 데이터' 표시를 띄우는 데 쓰며, API 연동 시 제거한다 */
export const IS_MOCK_DATA = true;

/** 현재 검사기관의 장애 이력 (기관 ID 기준) */
export async function getIncidents(organizationId: string): Promise<EquipmentIncident[]> {
  mockOnly("incidents.getIncidents");
  return MOCK_INCIDENTS.filter((incident) => incident.organizationId === organizationId);
}

/**
 * 화면 표시용 장애 목록. 장비는 장비 ID로, 영향 예약은 연결된 예약 ID로만 찾는다.
 * 다른 기관 장비·예약은 조회 대상이 아니므로 섞이지 않는다.
 */
export async function getIncidentRecords(organizationId: string): Promise<IncidentRecord[]> {
  mockOnly("incidents.getIncidentRecords");
  const [incidents, equipments, reservations] = await Promise.all([
    getIncidents(organizationId),
    getEquipments(organizationId),
    getReceivedReservations(organizationId),
  ]);
  const equipmentById = new Map(equipments.map((equipment) => [equipment.id, equipment]));
  const reservationById = new Map(reservations.map((reservation) => [reservation.id, reservation]));

  return incidents.map((incident) => {
    const equipment = equipmentById.get(incident.equipmentId);
    return {
      ...incident,
      equipment: {
        name: equipment?.name ?? null,
        examType: equipment?.examType ?? null,
        currentStatus: equipment?.status ?? null,
      },
      affectedReservations: incident.affectedReservationIds.flatMap((id) => {
        const reservation = reservationById.get(id);
        return reservation
          ? [
              {
                id: reservation.id,
                referralNumber: reservation.referralNumber,
                scheduledAt: reservation.scheduledAt,
                status: reservation.status,
              },
            ]
          : [];
      }),
    };
  });
}
