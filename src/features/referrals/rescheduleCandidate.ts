import type { EquipmentDetailDto } from "@/features/equipment/remote";
import { isEquipmentApiId } from "@/features/equipment/remote";
import type { SlotDetailDto } from "@/features/slots/remote";
import { isSlotApiId } from "@/features/slots/remote";

import { isReferralApiId, type ReferralResponseDto } from "./remote";

/**
 * 재예약 후보 사전 확인 (순수 함수: API 호출·POST 본문 생성 없음).
 *
 * 입력은 Server Action이 Gateway에서 다시 조회한 의뢰(ReferralResponse)·슬롯(SlotDetailResponse)·장비(EquipmentDetailResponse)여야 한다.
 * 브라우저가 보낸 slotId 외의 값(equipmentId·institutionId·시각 등)을 그대로 넣지 않는다: 슬롯 응답의 equipmentId로 장비를 조회하고,
 * 검사기관 ID는 그 장비 응답의 institutionId만 쓴다.
 *
 * 책임 범위
 * - 이 확인을 통과해도 재예약·슬롯 확보가 된 것이 아니다. 백엔드는 접수 후 HOLD를 비동기로 처리하고, 최종 검증과 동시성 제어(의뢰 비관적 락)는 백엔드가 한다
 * - 의뢰 작성자 본인인지는 판단하지 않는다 (ReferralResponse.referrerId와 비교할 사용자 ID가 프론트에 없다. 백엔드가 404로 거부한다)
 * - 조회 권한(장비 조회의 협약 검사, ADMIN 403 등)은 조회 단계에서 이미 결정된다. 여기서 우회하지 않는다
 * - 슬롯의 검사기관과 장비의 검사기관은 비교할 수 없다 (슬롯 응답에 기관 ID가 없다)
 *
 * 시각: 슬롯의 startsAt·endsAt은 오프셋이 있는 OffsetDateTime이라 같은 실제 시각(instant)으로 바꿔 비교한다.
 * 오프셋을 직접 계산하므로 서버 OS·브라우저 시간대는 쓰이지 않는다 (`Z`와 `+09:00`로 쓴 같은 시각은 같다).
 * 재예약 요청용 LocalDateTime(Asia/Seoul 벽시계) 문자열은 여기서 만들지 않는다.
 */

export type RescheduleCandidateFailure =
  /** 의뢰 DTO 형식 오류 (ID·검사 유형 UUID, 상태값) */
  | "INVALID_REFERRAL"
  /** 슬롯 DTO 형식 오류 (ID UUID, 시각 형식, 상태값) */
  | "INVALID_SLOT"
  /** 장비 DTO 형식 오류 (ID·기관 UUID, 상태값) */
  | "INVALID_EQUIPMENT"
  /** 기준 시각(now)이 올바르지 않음 */
  | "INVALID_NOW"
  /** 의뢰가 NEEDS_RESCHEDULE가 아님 (백엔드도 409 INVALID_REFERRAL_STATUS로 거부한다) */
  | "REFERRAL_NOT_RESCHEDULABLE"
  /** 슬롯이 AVAILABLE이 아님 (HELD·BOOKED·UNAVAILABLE) */
  | "SLOT_NOT_AVAILABLE"
  /** 장비가 OPERATIONAL이 아님 (MAINTENANCE·FAILED) */
  | "EQUIPMENT_NOT_OPERATIONAL"
  /** 조회한 장비가 슬롯의 장비가 아님 */
  | "EQUIPMENT_MISMATCH"
  /** 슬롯 검사 유형이 의뢰 검사 유형과 다름 */
  | "EXAM_TYPE_MISMATCH"
  /** 슬롯 시작이 종료보다 앞이 아님 */
  | "INVALID_TIME_RANGE"
  /** 슬롯 시작이 기준 시각보다 미래가 아님 */
  | "START_NOT_IN_FUTURE";

export type RescheduleCandidateCheckResult =
  | {
      ok: true;
      /** 사전 확인을 통과한 값 (서버 조회 결과에서만 가져온다). 재예약 접수·슬롯 확보를 뜻하지 않는다 */
      candidate: {
        referralId: string;
        slotId: string;
        equipmentId: string;
        /** 장비 응답의 institutionId (슬롯 응답에는 기관 ID가 없다) */
        examInstitutionId: string;
        examTypeId: string;
        /** 슬롯 응답 원본 (OffsetDateTime 문자열, 변환하지 않음) */
        startsAt: string;
        endsAt: string;
      };
    }
  | {
      ok: false;
      /** 실패한 조건 전체. 형식 오류가 있으면 형식 오류만 돌려준다 (값을 믿을 수 없어 나머지 비교를 하지 않는다) */
      failures: RescheduleCandidateFailure[];
    };

export function checkRescheduleCandidate(input: {
  referral: ReferralResponseDto;
  slot: SlotDetailDto;
  equipment: EquipmentDetailDto;
  /** 기준 시각 (테스트에서 고정값을 넣는다). Date 또는 epoch ms */
  now: Date | number;
}): RescheduleCandidateCheckResult {
  const { referral, slot, equipment } = input;
  const nowMs = input.now instanceof Date ? input.now.getTime() : input.now;
  const startMs = parseOffsetDateTime(slot?.startsAt);
  const endMs = parseOffsetDateTime(slot?.endsAt);

  const formatFailures: RescheduleCandidateFailure[] = [];
  if (!isRecord(referral) || !isReferralApiId(referral.id) || !isReferralApiId(referral.examTypeId) || typeof referral.referralStatus !== "string") {
    formatFailures.push("INVALID_REFERRAL");
  }
  if (!isRecord(slot) || !isSlotApiId(slot.id) || !isSlotApiId(slot.equipmentId) || !isSlotApiId(slot.examTypeId) || startMs === null || endMs === null || typeof slot.status !== "string") {
    formatFailures.push("INVALID_SLOT");
  }
  if (!isRecord(equipment) || !isEquipmentApiId(equipment.id) || !isEquipmentApiId(equipment.institutionId) || typeof equipment.status !== "string") {
    formatFailures.push("INVALID_EQUIPMENT");
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) formatFailures.push("INVALID_NOW");
  if (formatFailures.length > 0) return { ok: false, failures: formatFailures };

  const failures: RescheduleCandidateFailure[] = [];
  if (referral.referralStatus !== "NEEDS_RESCHEDULE") failures.push("REFERRAL_NOT_RESCHEDULABLE");
  if (slot.status !== "AVAILABLE") failures.push("SLOT_NOT_AVAILABLE");
  if (equipment.status !== "OPERATIONAL") failures.push("EQUIPMENT_NOT_OPERATIONAL");
  if (!sameId(slot.equipmentId, equipment.id)) failures.push("EQUIPMENT_MISMATCH");
  if (!sameId(slot.examTypeId, referral.examTypeId)) failures.push("EXAM_TYPE_MISMATCH");
  if (!(startMs! < endMs!)) failures.push("INVALID_TIME_RANGE");
  if (!(startMs! > nowMs)) failures.push("START_NOT_IN_FUTURE");
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    candidate: {
      referralId: referral.id,
      slotId: slot.id,
      equipmentId: equipment.id,
      examInstitutionId: equipment.institutionId,
      examTypeId: referral.examTypeId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** OffsetDateTime(`YYYY-MM-DDTHH:mm[:ss[.fffffffff]](Z|±HH:mm)`) → epoch ms. 오프셋이 없거나 없는 날짜·시각이면 null */
const OFFSET_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseOffsetDateTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = OFFSET_DATE_TIME.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const millis = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3));
  const offsetHours = m[8] === "Z" ? 0 : Number(m[10]);
  const offsetMinutes = m[8] === "Z" ? 0 : Number(m[11]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  if (offsetHours > 18 || offsetMinutes > 59 || (offsetHours === 18 && offsetMinutes > 0)) return null;
  const sign = m[9] === "-" ? -1 : 1;
  // 벽시계 값을 UTC로 계산한 뒤 오프셋을 빼 실제 시각을 얻는다 (로컬 시간대를 쓰는 Date 생성자·Date.parse를 쓰지 않는다)
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}
