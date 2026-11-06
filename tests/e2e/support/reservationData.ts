import { getSeoulNow, addDays, type DateKey } from "../../../src/lib/date/seoulDate";

import type { GatewaySession } from "./gateway";

/**
 * 예약 E2E 테스트 데이터 준비 (E2E 전용 Gateway에 실제 API로 만든다. DB에 직접 넣지 않는다).
 *
 * 만드는 것 (실행 ID로 이름을 붙여 다른 실행과 구분한다)
 * 1) 검사 유형        POST /api/v1/exam-types                          (admin, ADMIN)
 * 2) 장비            POST /api/v1/institutions/{B}/equipments          (imaging_b, EXAMINER, 우리 기관 장비)
 * 3) 장비 지원 검사 유형 POST /api/v1/equipments/{id}/exam-types          (소요 30분)
 * 4) 운영시간          PUT  /api/v1/equipments/{id}/operating-hours     (모든 요일 09:00~09:30 → 하루 슬롯 1개)
 * 5) 슬롯            POST /api/v1/slots/generate                      (내일 하루 → AVAILABLE 1개)
 *
 * 정리: 백엔드에 검사 유형·장비·슬롯 삭제 API가 없어 지우지 않는다 (E2E 전용 DB에만 남는다).
 * 남는 영향을 줄이려고 슬롯은 1개만 만든다 (테스트가 예약하면 AVAILABLE 슬롯이 남지 않는다).
 */

export interface ReservationTestData {
  runId: string;
  examTypeId: string;
  examTypeName: string;
  equipmentId: string;
  equipmentName: string;
  slotId: string;
  slotDate: DateKey;
  slotStartsAt: string;
  patientName: string;
}

/** 실행 ID: 시각(36진수) + 임의 4자. 환자명 20자 제한 안에 들어간다 */
export function createRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function prepareReservationData(
  { admin, examiner }: { admin: GatewaySession; examiner: GatewaySession },
  runId: string = createRunId(),
): Promise<ReservationTestData> {
  if (admin.role !== "ADMIN") throw new Error(`검사 유형은 관리자만 만들 수 있습니다 (현재 ${admin.loginId}: ${admin.role})`);
  if (examiner.role !== "EXAMINER") throw new Error(`장비·슬롯은 검사기관 계정으로 만듭니다 (현재 ${examiner.loginId}: ${examiner.role})`);

  const examTypeName = `E2E-${runId} 흉부 CT`;
  const examType = await admin.send<{ id: string; name: string; modality: string }>("POST", "/api/v1/exam-types", { name: examTypeName, modality: "CT" });

  const equipmentName = `E2E-${runId} CT`;
  const equipment = await examiner.send<{ id: string; status: string; institutionId: string }>(
    "POST",
    `/api/v1/institutions/${examiner.institutionId}/equipments`,
    { name: equipmentName, modality: "CT" },
  );
  if (equipment.status !== "OPERATIONAL") throw new Error(`새 장비 상태가 OPERATIONAL이 아닙니다: ${equipment.status}`);

  await examiner.send("POST", `/api/v1/equipments/${equipment.id}/exam-types`, { examTypeId: examType.id, durationMinutes: 30 });
  await examiner.send("PUT", `/api/v1/equipments/${equipment.id}/operating-hours`, {
    operatingHours: [1, 2, 3, 4, 5, 6, 7].map((week) => ({ week, startTime: "09:00", endTime: "09:30" })),
  });

  const slotDate = addDays(getSeoulNow().dateKey, 1);
  const slots = await examiner.send<{ id: string; status: string; startsAt: string; examTypeId: string; equipmentId: string }[]>("POST", "/api/v1/slots/generate", {
    equipmentId: equipment.id,
    examTypeId: examType.id,
    date: slotDate,
  });
  if (slots.length !== 1 || slots[0].status !== "AVAILABLE") {
    throw new Error(`슬롯이 1개 AVAILABLE로 만들어지지 않았습니다: ${slots.map((slot) => slot.status).join(",") || "(없음)"}`);
  }

  return {
    runId,
    examTypeId: examType.id,
    examTypeName,
    equipmentId: equipment.id,
    equipmentName,
    slotId: slots[0].id,
    slotDate,
    slotStartsAt: slots[0].startsAt,
    patientName: `E2E-${runId}`,
  };
}
