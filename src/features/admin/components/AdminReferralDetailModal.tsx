"use client";

import { CalendarClock, FileText, History, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { ROUTES } from "@/constants/navigation";
import { toBadgeStatus } from "@/features/referrals/components/ReferralApiTable";
import { DetailLoading, Empty, FailureReasonNotice, HistoryTimeline, Info, SectionNote } from "@/features/referrals/components/ReferralDetailParts";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import ReservationStatusBadge from "@/features/referrals/components/ReservationStatusBadge";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadAdminReferralDetailAction, type AdminReferralDetailResult } from "../detailActions";

import { AdminDetailButton, AdminDetailError, CloseButton, NETWORK_FAILURE, ShortId, shortIdText, TechInfo, useDetailResult, useUrlDetail } from "./AdminDetailParts";

const PARAM = "referralId";

/** 목록 행의 '상세' 버튼 */
export function AdminReferralDetailButton({ referralId }: { referralId: string }) {
  return <AdminDetailButton param={PARAM} id={referralId} label={`의뢰 ${shortIdText(referralId)} 상세 보기`} />;
}

type Detail = Extract<AdminReferralDetailResult, { ok: true }>["detail"];

/**
 * 관리자 의뢰 상세 대화상자 (`?referralId=`). 너비 약 1160px.
 * 데스크톱 2단: 왼쪽 40% 의뢰 기본 정보 / 오른쪽 60% 현재 예약 정보(위) + 상태 변경 이력(아래). 좁은 화면은 1단(기본 정보 → 예약 → 이력).
 * 흰 배경에 연한 구분선으로 영역을 나누고, 본문 스크롤은 공통 Modal의 하나만 쓴다 (안쪽에 별도 스크롤을 만들지 않는다).
 * 업무에 필요한 ID는 축약 + 복사로, 내부 식별자 전체 값은 '기술 정보 보기'로 보인다 (데이터는 빠뜨리지 않는다).
 * institutionNames: 목록을 그릴 때 이미 받은 관리자 기관 목록의 ID(소문자) → 기관명 (추가 요청 없음)
 */
export default function AdminReferralDetailModal({ institutionNames }: { institutionNames: Record<string, string> }) {
  const { id, open, valid, close } = useUrlDetail(PARAM);
  const { value, retry } = useDetailResult<AdminReferralDetailResult>(valid ? id : null, () => loadAdminReferralDetailAction(id!), NETWORK_FAILURE);
  const result: AdminReferralDetailResult | null =
    open && !valid ? { ok: false, reason: "ERROR", message: "의뢰 번호가 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null } : value;
  const detail = result?.ok ? result.detail : null;
  const name = (institutionId: string | null) => (institutionId ? institutionNames[institutionId.toLowerCase()] : undefined);

  return (
    <Modal
      open={open}
      size="3xl"
      title="의뢰 상세"
      titleAddon={
        valid && id ? (
          <>
            {detail && <ReferralStatusBadge status={toBadgeStatus(detail.referral.referralStatus)} />}
            <div className="min-w-0 basis-full sm:basis-auto">
              <ShortId id={id} label="의뢰 ID" />
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
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* 왼쪽 40%: 의뢰 기본 정보 (+ 기술 정보 접기) */}
          <div className="flex min-w-0 flex-col gap-5 pb-6 lg:border-r lg:border-line lg:pb-0 lg:pr-7">
            <Block icon={FileText} title="의뢰 기본 정보">
              <dl className="flex flex-col divide-y divide-line">
                <Row label="환자명">
                  <span className="text-base font-semibold text-gray-900">{detail!.referral.patientName}</span>
                </Row>
                <Row label="의뢰 상태">
                  <ReferralStatusBadge status={toBadgeStatus(detail!.referral.referralStatus)} />
                </Row>
                <Row label="의뢰기관">
                  {name(detail!.referral.referringInstitutionId) ?? <ShortId id={detail!.referral.referringInstitutionId} label="의뢰기관 ID" />}
                </Row>
                <Row label="검사 유형">
                  <ShortId id={detail!.referral.examTypeId} label="검사 유형 ID" />
                  <span className="mt-1 block text-xs text-gray-500">이름은 관리자 권한으로 조회할 수 없어 ID로 표시합니다.</span>
                </Row>
                <Row label="의뢰 번호">
                  <ShortId id={detail!.referral.id} label="의뢰 ID" />
                </Row>
              </dl>
            </Block>
            <TechInfo items={techItems(detail!)} />
          </div>

          {/* 오른쪽 60%: 현재 예약 정보(위) + 상태 변경 이력(아래) */}
          <div className="flex min-w-0 flex-col gap-6 border-t border-line pt-6 lg:border-t-0 lg:pl-7 lg:pt-0">
            <Block
              icon={CalendarClock}
              title="현재 예약 정보"
              action={
                <Link href={`${ROUTES.admin.reservations}?referralId=${detail!.referral.id}`} className="text-sm font-semibold text-primary hover:underline">
                  이 의뢰의 예약 이력 전체
                </Link>
              }
            >
              <CurrentReservation reservation={detail!.reservation} institutionName={name} />
            </Block>
            <div className="border-t border-line pt-6">
              <Block icon={History} title="상태 변경 이력">
                {"ok" in detail!.histories ? (
                  <SectionNote>변경 이력을 불러오지 못했습니다. ({detail!.histories.message})</SectionNote>
                ) : detail!.histories.length === 0 ? (
                  <SectionNote>변경 이력이 없습니다.</SectionNote>
                ) : (
                  <HistoryTimeline histories={detail!.histories} />
                )}
              </Block>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** 영역 제목 + 오른쪽 보조 링크 (흰 배경, 구분은 바깥 구분선으로) */
function Block({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
          <Icon className="size-4 text-gray-400" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 기본 정보 한 줄: 왼쪽 작은 회색 라벨 · 오른쪽 값 (좁은 왼쪽 영역에서도 정렬이 맞도록) */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-3 py-3 first:pt-0 last:pb-0">
      <dt className="pt-0.5 text-xs font-medium text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-[15px] text-gray-800">{children}</dd>
    </div>
  );
}

function techItems(detail: Detail): [string, string | null][] {
  const r = detail.reservation && !("ok" in detail.reservation) ? detail.reservation : null;
  return [
    ["의뢰 ID", detail.referral.id],
    ["의뢰기관 ID", detail.referral.referringInstitutionId],
    ["작성자 ID", detail.referral.referrerId],
    ["검사 유형 ID", detail.referral.examTypeId],
    ["현재 예약 ID", detail.referral.currentReservationId],
    ["슬롯 ID", r?.slotId ?? null],
    ["검사기관 ID", r?.examInstitutionId ?? null],
    ["장비 ID", r?.equipmentId ?? null],
  ];
}

function CurrentReservation({ reservation, institutionName }: { reservation: Detail["reservation"]; institutionName: (id: string | null) => string | undefined }) {
  if (reservation === null) return <SectionNote>연결된 예약이 없습니다.</SectionNote>;
  if ("ok" in reservation) return <SectionNote>현재 예약 정보를 불러오지 못했습니다. ({reservation.message})</SectionNote>;
  return (
    <div className="flex flex-col gap-4">
      {reservation.failureReason && <FailureReasonNotice reason={reservation.failureReason} compact />}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Info label="예약 상태"><ReservationStatusBadge status={reservation.reservationStatus} /></Info>
        <Info label="예약 시도 횟수">{reservation.attemptNo}번째 시도</Info>
        <Info label="검사기관">{institutionName(reservation.examInstitutionId) ?? (reservation.examInstitutionId ? <ShortId id={reservation.examInstitutionId} label="검사기관 ID" /> : <Empty reason="none" />)}</Info>
        <Info label="검사 일시">
          {reservation.startTime ? (
            `${formatDateTimeWithWeekday(reservation.startTime)}${reservation.endTime ? ` ~ ${formatDateTimeWithWeekday(reservation.endTime).slice(-5)}` : ""}`
          ) : (
            <Empty reason="none" />
          )}
        </Info>
        <Info label="예약 확정 시각">{reservation.confirmedAt ? formatDateTimeWithWeekday(reservation.confirmedAt) : <Empty reason="none" />}</Info>
        <Info label="종료 시각">{reservation.endedAt ? formatDateTimeWithWeekday(reservation.endedAt) : <Empty reason="none" />}</Info>
        <Info label="장비 ID">{reservation.equipmentId ? <ShortId id={reservation.equipmentId} label="장비 ID" /> : <Empty reason="none" />}</Info>
        <Info label="예약 ID">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ShortId id={reservation.id} label="예약 ID" />
            <Link href={`${ROUTES.admin.reservations}?reservationId=${reservation.id}`} className="text-sm font-semibold text-primary hover:underline">
              예약 상세 보기
            </Link>
          </span>
        </Info>
        <Info label="슬롯 ID">
          {reservation.slotId ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ShortId id={reservation.slotId} label="슬롯 ID" />
              <Link href={`${ROUTES.admin.slots}?slotId=${reservation.slotId}`} className="text-sm font-semibold text-primary hover:underline">
                슬롯 상태 이력 보기
              </Link>
            </span>
          ) : (
            <Empty reason="none" />
          )}
        </Info>
      </dl>
    </div>
  );
}
