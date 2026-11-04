"use client";

import { CalendarClock, RefreshCw, Stethoscope } from "lucide-react";
import { useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { detailButtonClass } from "@/components/ui/styles";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadReferralDetailAction } from "../actions";
import { abbreviateReferralId } from "../referralId";
import type { DetailCell, ReferralDetailLoadResult } from "../server";

import { DetailError, DetailFooter, DetailLoading, Empty, FailureReasonNotice, HistoryTimeline, Info, Section, SectionNote } from "./ReferralDetailParts";
import ReferralIdCopyButton from "./ReferralIdCopyButton";
import ReferralStatusBadge from "./ReferralStatusBadge";
import ReservationStatusBadge from "./ReservationStatusBadge";

interface ReferralApiDetailButtonProps {
  /** 의뢰 ID 원본 (상세 조회·복사에 그대로 쓴다. 화면에는 줄여 보인다) */
  referralId: string;
  /** 목록에서 검사 유형 API로 바꾼 문구 (상세에서 다시 조회하지 않는다) */
  examTypeLabel: string;
  /** 목록 배지와 같은 표시 상태 */
  badgeStatus: Parameters<typeof ReferralStatusBadge>[0]["status"];
}

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

const cell = (value: DetailCell) => (value.state === "ok" ? value.value : <Empty reason={value.state} />);

/**
 * 의뢰 목록(API 모드)의 '상세' 버튼과 상세 대화상자.
 * 헤더: 제목 · 의뢰 번호(축약, 전체 UUID 복사) · 의뢰 상태 배지 · 닫기 / 본문: 검사 정보 · 예약 정보 · 상태 변경 이력(타임라인).
 * 열 때 Server Function으로 한 건만 조회한다 (의뢰·변경 이력·현재 예약·검사기관·장비). 예약 상태와 관계없이 열 수 있다.
 * 응답에 없는 값은 만들지 않고 '정보 없음 / 찾을 수 없음 / 조회 실패'로 구분한다. 이력은 백엔드가 준 것만 보인다. 조회 전용이다.
 * 모양 조각(섹션·정보 칸·타임라인 등)은 관리자 의뢰 상세 모달과 함께 쓴다 (ReferralDetailParts).
 */
export default function ReferralApiDetailButton({ referralId, examTypeLabel, badgeStatus }: ReferralApiDetailButtonProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ReferralDetailLoadResult | null>(null);
  const loadingRef = useRef(false);

  const show = async () => {
    setOpen(true);
    if (loadingRef.current) return;
    loadingRef.current = true;
    setResult(null);
    try {
      setResult(await loadReferralDetailAction(referralId));
    } catch {
      setResult({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE, code: null });
    } finally {
      loadingRef.current = false;
    }
  };

  const detail = result?.ok ? result.detail : null;
  const reservation = detail?.reservation;
  const createdAt = detail?.histories?.find((h) => h.reason === "REFERRAL_CREATED")?.occurredAt;
  const reservationEmpty = (key: string) => <Empty key={key} reason={reservation?.state === "ok" ? "none" : (reservation?.state ?? "none")} />;

  return (
    <>
      <button type="button" onClick={show} aria-label={`${abbreviateReferralId(referralId)} 상세`} className={detailButtonClass}>
        상세
      </button>
      <Modal
        open={open}
        size="xl"
        title="의뢰 상세"
        titleAddon={
          <>
            <ReferralStatusBadge status={badgeStatus} />
            <div className="basis-full sm:basis-auto">
              <ReferralIdCopyButton referralId={referralId} />
            </div>
          </>
        }
        onClose={() => setOpen(false)}
      >
        {!result ? (
          <DetailLoading />
        ) : !result.ok ? (
          <DetailError message={result.message} onRetry={show} />
        ) : (
          <div className="flex flex-col gap-5">
            <Section icon={Stethoscope} title="검사 정보">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <Info label="환자명" strong>{detail!.patientName}</Info>
                <Info label="검사 유형" strong>{examTypeLabel}</Info>
                <Info label="검사기관">{reservation?.state === "ok" ? cell(reservation.examInstitution) : reservationEmpty("i")}</Info>
                <Info label="검사 장비">{reservation?.state === "ok" ? cell(reservation.equipment) : reservationEmpty("e")}</Info>
                <Info label="검사 일시">
                  {reservation?.state === "ok" && reservation.startTime ? formatDateTimeWithWeekday(reservation.startTime) : reservationEmpty("t")}
                </Info>
                <Info label="의뢰 요청 일시">{createdAt ? formatDateTimeWithWeekday(createdAt) : <Empty reason={detail!.histories ? "none" : "error"} />}</Info>
              </dl>
            </Section>

            <Section icon={CalendarClock} title="예약 정보">
              {reservation?.state === "ok" ? (
                <div className="flex flex-col gap-4">
                  {reservation.failureReason && <FailureReasonNotice reason={reservation.failureReason} />}
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                    <Info label="현재 예약 상태"><ReservationStatusBadge status={reservation.reservationStatus} /></Info>
                    <Info label="예약 시도">{reservation.attemptNo}번째 시도</Info>
                    <Info label="예약 확정 시각">{reservation.confirmedAt ? formatDateTimeWithWeekday(reservation.confirmedAt) : <Empty reason="none" />}</Info>
                    <Info label="종료 시각">{reservation.endedAt ? formatDateTimeWithWeekday(reservation.endedAt) : <Empty reason="none" />}</Info>
                  </dl>
                </div>
              ) : (
                <SectionNote>
                  {reservation?.state === "none"
                    ? "연결된 예약이 없습니다."
                    : reservation?.state === "missing"
                      ? "예약 정보를 찾을 수 없습니다."
                      : "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
                </SectionNote>
              )}
            </Section>

            <Section icon={RefreshCw} title="상태 변경 이력">
              {!detail!.histories ? (
                <SectionNote>변경 이력을 불러오지 못했습니다.</SectionNote>
              ) : detail!.histories.length === 0 ? (
                <SectionNote>변경 이력이 없습니다.</SectionNote>
              ) : (
                <HistoryTimeline histories={detail!.histories} />
              )}
            </Section>
          </div>
        )}
        <DetailFooter onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}
