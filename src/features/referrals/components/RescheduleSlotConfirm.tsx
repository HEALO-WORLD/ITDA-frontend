import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { useState } from "react";

import { getSlotById } from "@/features/slots/api";
import type { ExamSlot } from "@/features/slots/types";
import { getSeoulNow } from "@/lib/date/seoulDate";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import type { ReferralSummary } from "../types";
import { validateSelectedSlot } from "../validation";

import DetailList from "./DetailList";
import ReferralStatusBadge from "./ReferralStatusBadge";
import ReservationCard from "./ReservationCompareCard";

interface RescheduleSlotConfirmProps {
  /** 재조정 대상 기존 예약 */
  referral: ReferralSummary;
  /** 대체로 선택한 슬롯 */
  slot: ExamSlot;
  /** 대체 후보에서 제외한 장애 장비 ID */
  excludedEquipmentIds: readonly string[];
  onCancel: () => void;
  /** PC 재조정 모달 3단계: 기존 예약 → 변경할 예약 비교 카드로 보인다 (검증·Mock 안내·버튼은 같다) */
  inline?: boolean;
}

const MOCK_NOTICE =
  "선택 정보가 확인되었습니다. 현재는 개발용 Mock 화면으로, 실제 예약 변경 요청은 처리되지 않으며 기존 예약도 그대로 유지됩니다.";

/**
 * 재조정 대체 슬롯 확인 (슬롯 검색의 재조정 모드 모달 내용).
 * 기존 예약과 선택한 슬롯을 나란히 보여 주고, 슬롯 예약 가능 여부·검사 유형 일치만 검증한다.
 *
 * TODO(api): 예약 변경 API 확인 후 연동한다. 그 전까지 기존 예약 삭제·상태 변경을 하지 않는다.
 * 여기의 검증은 화면용 1차 확인이며, 서버가 요청 시점에 슬롯 예약 가능 여부·장비 상태를 재검증해야 한다.
 */
export default function RescheduleSlotConfirm({
  referral,
  slot,
  excludedEquipmentIds,
  onCancel,
  inline = false,
}: RescheduleSlotConfirmProps) {
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showMockNotice, setShowMockNotice] = useState(false);

  const handleConfirm = async () => {
    setIsChecking(true);
    // 표시 중인 값이 아니라 슬롯 데이터에서 다시 조회한 값으로 검증한다
    const latestSlot = await getSlotById(slot.id);
    const slotError =
      validateSelectedSlot(latestSlot, slot.id, getSeoulNow().dateTime) ??
      (latestSlot?.examType !== referral.examType
        ? "기존 예약과 검사 유형이 다른 슬롯입니다. 검사 슬롯을 다시 선택해 주세요."
        : latestSlot && excludedEquipmentIds.includes(latestSlot.equipmentId)
          ? "장애가 발생한 장비의 슬롯은 대체 슬롯으로 선택할 수 없습니다."
          : undefined);
    setIsChecking(false);
    setError(slotError ?? null);
    setShowMockNotice(!slotError);
  };

  return (
    <div>
      {inline ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3">
          <ReservationCard
            label="기존 예약"
            tone="neutral"
            dateTime={formatDateTimeWithWeekday(referral.scheduledAt)}
            institution={referral.organizationName}
            examItem={referral.examType}
            equipment={referral.equipmentName}
          />
          <span aria-hidden="true" className="flex items-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-navy text-white">
              <ArrowRight className="size-4" />
            </span>
          </span>
          <ReservationCard
            label="변경할 예약"
            tone="highlight"
            dateTime={formatDateTimeWithWeekday(slot.startAt)}
            institution={slot.organizationName}
            examItem={slot.examType}
            equipment={slot.equipmentName}
            sameInstitution={referral.organizationName === slot.organizationName}
            sameExamItem={referral.examType === slot.examType}
            changes={{
              dateTime: referral.scheduledAt.slice(0, 16) !== slot.startAt,
              institution: referral.organizationName !== slot.organizationName,
              equipment: referral.equipmentName !== slot.equipmentName,
            }}
          />
        </div>
      ) : (
        <>
      <h3 className="mb-2 text-[15px] font-bold text-gray-800">기존 예약</h3>
      <section aria-label="기존 예약" className="rounded-lg border border-line px-4 py-4">
        <DetailList
          items={[
            ["예약번호", referral.referralNumber],
            ["상태", <ReferralStatusBadge key="status" status={referral.status} />],
            ["검사기관", referral.organizationName],
            ["검사 장비", referral.equipmentName],
            ["검사 유형", referral.examType],
            ["기존 예약일시", formatDateTimeWithWeekday(referral.scheduledAt)],
          ]}
        />
      </section>

      <h3 className="mb-2 mt-5 text-[15px] font-bold text-gray-800">선택한 새 슬롯</h3>
      <section aria-label="선택한 새 슬롯" className="rounded-lg bg-surface-muted px-4 py-4">
        <DetailList
          items={[
            ["검사기관", slot.organizationName],
            ["검사 장비", slot.equipmentName],
            ["검사 유형", slot.examType],
            ["검사 일시", formatDateTimeWithWeekday(slot.startAt)],
          ]}
        />
      </section>
        </>
      )}
      <p className="mt-2 text-sm text-gray-500">
        예약 변경이 완료되기 전까지 기존 예약은 삭제되거나 변경되지 않습니다.
      </p>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {showMockNotice && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-[15px] text-amber-900"
        >
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            <strong className="mr-1.5 font-semibold">[API 미연동]</strong>
            {MOCK_NOTICE}
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          취소
        </button>
        <button
          type="button"
          data-autofocus
          onClick={handleConfirm}
          disabled={isChecking || Boolean(error)}
          className="h-12 rounded-lg bg-primary px-6 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {isChecking ? "확인 중" : "예약 변경 요청"}
        </button>
      </div>
    </div>
  );
}
