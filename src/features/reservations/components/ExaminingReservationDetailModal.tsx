"use client";

import { CalendarClock, ClipboardList } from "lucide-react";

import Modal from "@/components/ui/Modal";
import {
  AdminDetailButton,
  AdminDetailError,
  CloseButton,
  InfoCard,
  NETWORK_FAILURE,
  ShortId,
  shortIdText,
  TechInfo,
  useDetailResult,
  useUrlDetail,
} from "@/features/admin/components/AdminDetailParts";
import { DetailLoading, Empty, FailureReasonNotice, Info } from "@/features/referrals/components/ReferralDetailParts";
import ReservationStatusBadge from "@/features/referrals/components/ReservationStatusBadge";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadExaminingReservationDetailAction, type ExaminingReservationDetailResult } from "../actions";

const PARAM = "reservationId";

/** 목록 행의 '상세' 버튼 (주소에 ?reservationId=를 붙여 대화상자를 연다) */
export function ExaminingReservationDetailButton({ reservationId }: { reservationId: string }) {
  return <AdminDetailButton param={PARAM} id={reservationId} label={`예약 ${shortIdText(reservationId)} 상세 보기`} />;
}

/**
 * 검사기관 예약 상세 대화상자 (`?reservationId=`). 관리자 상세 모달과 같은 모양(공통 Modal·정보 카드·기술 정보 접기).
 * 데스크톱 2단: 왼쪽 검사 정보(장비·검사 일시·연결된 의뢰) / 오른쪽 예약 처리 상태(실패 사유·시도·확정·종료).
 * 예약 응답에 없는 환자명·의뢰기관·검사 유형은 보이지 않는다 (검사기관은 의뢰 단건 API 권한이 없다).
 * equipmentNames: 목록을 그릴 때 받은 우리 기관 장비 목록의 ID(소문자) → 장비 이름 (추가 요청 없음)
 */
export default function ExaminingReservationDetailModal({ equipmentNames }: { equipmentNames: Record<string, string> }) {
  const { id, open, valid, close } = useUrlDetail(PARAM);
  const { value, retry } = useDetailResult<ExaminingReservationDetailResult>(valid ? id : null, () => loadExaminingReservationDetailAction(id!), NETWORK_FAILURE);
  const result: ExaminingReservationDetailResult | null =
    open && !valid ? { ok: false, reason: "ERROR", message: "예약 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null } : value;
  const r = result?.ok ? result.reservation : null;
  const equipmentName = r?.equipmentId ? equipmentNames[r.equipmentId.toLowerCase()] : undefined;

  return (
    <Modal
      open={open}
      size="2xl"
      title="예약 상세"
      titleAddon={
        valid && id ? (
          <>
            {r && <ReservationStatusBadge status={r.reservationStatus} />}
            <div className="min-w-0 basis-full sm:basis-auto">
              <ShortId id={id} label="예약 ID" />
            </div>
          </>
        ) : null
      }
      onClose={close}
      footer={<CloseButton onClose={close} />}
    >
      {!result ? (
        <DetailLoading />
      ) : !result.ok ? (
        <AdminDetailError failure={result} onRetry={retry} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InfoCard icon={ClipboardList} title="검사 정보">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Info label="검사 장비" strong>
                  {equipmentName ?? (r!.equipmentId ? <ShortId id={r!.equipmentId} label="장비 ID" /> : <Empty reason="none" />)}
                </Info>
                <Info label="검사 일시" strong>
                  {r!.startTime ? `${formatDateTimeWithWeekday(r!.startTime)}${r!.endTime ? ` ~ ${formatDateTimeWithWeekday(r!.endTime).slice(-5)}` : ""}` : <Empty reason="none" />}
                </Info>
                <Info label="연결된 의뢰">
                  <ShortId id={r!.referralId} label="의뢰 ID" />
                </Info>
                <Info label="예약 번호">
                  <ShortId id={r!.id} label="예약 ID" />
                </Info>
              </dl>
            </InfoCard>
            <InfoCard icon={CalendarClock} title="예약 처리 상태">
              <div className="flex flex-col gap-4">
                {r!.failureReason && <FailureReasonNotice reason={r!.failureReason} compact />}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Info label="예약 상태"><ReservationStatusBadge status={r!.reservationStatus} /></Info>
                  <Info label="예약 시도 횟수">{r!.attemptNo}번째 시도</Info>
                  <Info label="예약 확정 시각">{r!.confirmedAt ? formatDateTimeWithWeekday(r!.confirmedAt) : <Empty reason="none" />}</Info>
                  <Info label="종료 시각">{r!.endedAt ? formatDateTimeWithWeekday(r!.endedAt) : <Empty reason="none" />}</Info>
                </dl>
              </div>
            </InfoCard>
          </div>
          <TechInfo
            items={[
              ["예약 ID", r!.id],
              ["의뢰 ID", r!.referralId],
              ["슬롯 ID", r!.slotId],
              ["검사기관 ID", r!.examInstitutionId],
              ["장비 ID", r!.equipmentId],
              ["실패 사유 코드", r!.failureReason],
            ]}
          />
        </div>
      )}
    </Modal>
  );
}
