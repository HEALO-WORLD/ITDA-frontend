"use client";

import { CalendarClock, ClipboardList } from "lucide-react";
import Link from "next/link";

import Modal from "@/components/ui/Modal";
import { ROUTES } from "@/constants/navigation";
import { DetailLoading, Empty, FailureReasonNotice, Info } from "@/features/referrals/components/ReferralDetailParts";
import ReservationStatusBadge from "@/features/referrals/components/ReservationStatusBadge";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadAdminReservationDetailAction, type AdminReservationDetailResult } from "../detailActions";

import { AdminDetailButton, AdminDetailError, CloseButton, InfoCard, NETWORK_FAILURE, ShortId, shortIdText, TechInfo, useDetailResult, useUrlDetail } from "./AdminDetailParts";

const PARAM = "reservationId";

/** 목록 행의 '상세' 버튼 */
export function AdminReservationDetailButton({ reservationId }: { reservationId: string }) {
  return <AdminDetailButton param={PARAM} id={reservationId} label={`예약 ${shortIdText(reservationId)} 상세 보기`} />;
}

/**
 * 관리자 예약 상세 대화상자 (`?reservationId=`). 데스크톱 2단: 왼쪽 예약 기본 정보(의뢰·검사기관·검사 일시) / 오른쪽 처리 상태(실패 사유·확정·종료).
 * 실패(FAILED) 예약도 그대로 조회한다. 의뢰 상세·슬롯 상태 이력 이동 링크를 둔다. 내부 식별자 전체 값은 '기술 정보 보기'.
 * institutionNames: 목록을 그릴 때 받은 관리자 기관 목록의 ID(소문자) → 기관명 (추가 요청 없음)
 */
export default function AdminReservationDetailModal({ institutionNames }: { institutionNames: Record<string, string> }) {
  const { id, open, valid, close } = useUrlDetail(PARAM);
  const { value, retry } = useDetailResult<AdminReservationDetailResult>(valid ? id : null, () => loadAdminReservationDetailAction(id!), NETWORK_FAILURE);
  const result: AdminReservationDetailResult | null =
    open && !valid ? { ok: false, reason: "ERROR", message: "예약 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null } : value;
  const r = result?.ok ? result.reservation : null;
  const institution = r?.examInstitutionId ? institutionNames[r.examInstitutionId.toLowerCase()] : undefined;

  return (
    <Modal
      open={open}
      size="2xl"
      title="예약 상세"
      titleAddon={
        valid && id ? (
          <>
            {r && <ReservationStatusBadge status={r.reservationStatus} />}
            <div className="basis-full sm:basis-auto">
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
            <InfoCard icon={ClipboardList} title="예약 기본 정보">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Info label="검사기관" strong>{institution ?? (r!.examInstitutionId ? <ShortId id={r!.examInstitutionId} label="검사기관 ID" /> : <Empty reason="none" />)}</Info>
                <Info label="검사 일시" strong>
                  {r!.startTime ? `${formatDateTimeWithWeekday(r!.startTime)}${r!.endTime ? ` ~ ${formatDateTimeWithWeekday(r!.endTime).slice(-5)}` : ""}` : <Empty reason="none" />}
                </Info>
                <Info label="연결된 의뢰">
                  <span className="flex flex-col gap-1">
                    <ShortId id={r!.referralId} label="의뢰 ID" />
                    <Link href={`${ROUTES.admin.referrals}?referralId=${r!.referralId}`} className="text-sm font-semibold text-primary hover:underline">
                      의뢰 상세 보기
                    </Link>
                  </span>
                </Info>
                <Info label="검사 장비">
                  {r!.equipmentId ? (
                    <>
                      <ShortId id={r!.equipmentId} label="장비 ID" />
                      <span className="mt-1 block text-xs font-normal text-gray-500">장비 이름은 관리자 권한으로 조회할 수 없어 ID로 표시합니다.</span>
                    </>
                  ) : (
                    <Empty reason="none" />
                  )}
                </Info>
              </dl>
            </InfoCard>
            <InfoCard icon={CalendarClock} title="예약 처리 상태">
              <div className="flex flex-col gap-4">
                {r!.failureReason && <FailureReasonNotice reason={r!.failureReason} compact />}
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Info label="예약 상태"><ReservationStatusBadge status={r!.reservationStatus} /></Info>
                  <Info label="예약 시도 번호">{r!.attemptNo}번째 시도</Info>
                  <Info label="예약 확정 시각">{r!.confirmedAt ? formatDateTimeWithWeekday(r!.confirmedAt) : <Empty reason="none" />}</Info>
                  <Info label="예약 종료 시각">{r!.endedAt ? formatDateTimeWithWeekday(r!.endedAt) : <Empty reason="none" />}</Info>
                  <Info label="슬롯">
                    {r!.slotId ? (
                      <Link href={`${ROUTES.admin.slots}?slotId=${r!.slotId}`} className="text-sm font-semibold text-primary hover:underline">
                        슬롯 상태 이력 보기
                      </Link>
                    ) : (
                      <span className="text-sm text-gray-400">없음 (슬롯 미배정)</span>
                    )}
                  </Info>
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
