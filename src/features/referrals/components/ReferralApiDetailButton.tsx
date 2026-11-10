"use client";

import { CalendarClock, RefreshCw, Stethoscope } from "lucide-react";
import { useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { detailButtonClass } from "@/components/ui/styles";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadReferralDetailAction } from "../actions";
import { abbreviateReferralId } from "../referralId";
import { classifyCancelRecheck, type ReservationCancelTarget } from "../reservationCancel";
import type { DetailCell, ReferralDetail, ReferralDetailLoadResult } from "../server";

import { DetailError, DetailLoading, Empty, FailureReasonNotice, HistoryTimeline, Info, Section, SectionNote } from "./ReferralDetailParts";
import ReferralIdCopyButton from "./ReferralIdCopyButton";
import ReferralStatusBadge from "./ReferralStatusBadge";
import ReservationCancelControl, { CANCEL_UNKNOWN_RESULT_NOTICE, getCancelRecheckNotice, type ReservationCancelNotice } from "./ReservationCancelControl";
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

/** 섹션 카드 (2열에서 같은 높이) */
const cardClass = "h-full min-w-0 rounded-xl border border-line bg-white px-5 py-5";
/** 하단 닫기 (기존 DetailFooter 버튼과 같은 모양, 대화상자 고정 하단 영역에 둔다) */
const closeButtonClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50";

const cell = (value: DetailCell) => (value.state === "ok" ? value.value : <Empty reason={value.state} />);

/**
 * 의뢰 목록(API 모드)의 '상세' 버튼과 상세 대화상자.
 * 헤더: 제목 · 의뢰 상태 배지 · 의뢰 번호(축약, 전체 UUID 복사) · 닫기
 * 본문: [검사 정보 | 예약 정보] (넓은 화면 2열, 좁은 화면 1열) → 상태 변경 이력(타임라인, 전체 너비) / 하단(고정): 닫기.
 * 열 때 Server Function으로 한 건만 조회한다 (의뢰·변경 이력·현재 예약·검사기관·장비). 예약 상태와 관계없이 열 수 있다.
 * 응답에 없는 값은 만들지 않고 '정보 없음 / 찾을 수 없음 / 조회 실패'로 구분한다. 이력은 백엔드가 준 것만 보인다. 조회 전용이다.
 * 모양 조각(섹션·정보 칸·타임라인 등)은 관리자 의뢰 상세 모달과 함께 쓴다 (ReferralDetailParts).
 */
export default function ReferralApiDetailButton({ referralId, examTypeLabel, badgeStatus }: ReferralApiDetailButtonProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ReferralDetailLoadResult | null>(null);
  /** 상세를 불러온 브라우저 시각 (예약 취소 마감 판단용. 렌더링 중에 현재 시각을 읽지 않는다) */
  const [loadedAtMs, setLoadedAtMs] = useState<number | null>(null);
  /** 예약 취소 결과 안내 (상세를 다시 불러와도 남긴다. 대화상자를 새로 열면 지운다) */
  const [notice, setNotice] = useState<ReservationCancelNotice | null>(null);
  /** 예약 취소 요청 중: 상세 대화상자도 닫지 못하게 한다 */
  const [cancelPending, setCancelPending] = useState(false);
  const loadingRef = useRef(false);
  /** 대화상자를 열 때마다 바뀐다: 닫았다 다시 연 뒤 이전 상태 확인 결과가 안내를 덮지 않게 한다 */
  const openCountRef = useRef(0);

  /** 상세를 다시 불러온다. 이미 불러오는 중이면 요청하지 않고 null */
  const load = async (): Promise<ReferralDetailLoadResult | null> => {
    if (loadingRef.current) return null;
    loadingRef.current = true;
    setResult(null);
    let loaded: ReferralDetailLoadResult;
    try {
      loaded = await loadReferralDetailAction(referralId);
      setLoadedAtMs(Date.now());
    } catch {
      loaded = { ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE, code: null };
    } finally {
      loadingRef.current = false;
    }
    setResult(loaded);
    return loaded;
  };

  /**
   * 예약 취소 결과 불명(5xx·네트워크·타임아웃) 뒤: 상세를 서버에서 다시 불러와(no-store) 확인한 예약과 비교해 안내한다.
   * 취소 요청은 다시 보내지 않는다. 다시 불러오는 동안은 상세가 비어 취소 버튼이 보이지 않는다
   */
  const recheck = async (target: ReservationCancelTarget) => {
    const openCount = openCountRef.current;
    setNotice({ tone: "info", message: CANCEL_UNKNOWN_RESULT_NOTICE });
    const loaded = await load();
    if (!loaded || openCount !== openCountRef.current) return;
    setNotice(getCancelRecheckNotice(classifyCancelRecheck(target, loaded.ok ? loaded.detail : null), target));
  };

  const show = async () => {
    openCountRef.current += 1;
    setOpen(true);
    setNotice(null);
    await load();
  };

  const detail = result?.ok ? result.detail : null;
  const currentReservation = detail?.reservation.state === "ok" ? detail.reservation : null;

  return (
    <>
      <button type="button" onClick={show} aria-label={`${abbreviateReferralId(referralId)} 상세`} className={detailButtonClass}>
        상세
      </button>
      <Modal
        open={open}
        size="detail"
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
        preventClose={cancelPending}
        footer={
          <>
            {/* 예약 취소: 확정 예약·취소 마감 전일 때만 (목록에는 두지 않는다) */}
            {detail && currentReservation && loadedAtMs !== null && (
              <ReservationCancelControl
                key={`${currentReservation.attemptNo}-${loadedAtMs}`}
                referralId={referralId}
                referralStatus={detail.referralStatus}
                reservation={currentReservation}
                checkedAtMs={loadedAtMs}
                onPendingChange={setCancelPending}
                onSettled={(next, unknownResultTarget) => {
                  setNotice(next);
                  // 상세는 클라이언트 상태라 목록 refresh()로 바뀌지 않는다: 직접 다시 불러온다 (결과 불명이면 다시 불러온 상태로 결과를 판단)
                  void (unknownResultTarget ? recheck(unknownResultTarget) : load());
                }}
              />
            )}
            <button type="button" onClick={() => setOpen(false)} disabled={cancelPending} className={closeButtonClass}>
              닫기
            </button>
          </>
        }
      >
        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${notice.tone === "success" ? "bg-emerald-50 text-emerald-800" : notice.tone === "info" ? "bg-info-soft text-info" : "bg-red-50 text-red-700"}`}
          >
            {notice.message}
            {notice.recheckTarget && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => notice.recheckTarget && void recheck(notice.recheckTarget)}
                  disabled={!result}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  상태 다시 확인
                </button>
              </div>
            )}
          </div>
        )}
        {!result ? (
          <DetailLoading />
        ) : !result.ok ? (
          <DetailError message={result.message} onRetry={() => void (notice?.recheckTarget ? recheck(notice.recheckTarget) : load())} />
        ) : (
          <ReferralDetailContent detail={result.detail} examTypeLabel={examTypeLabel} />
        )}
      </Modal>
    </>
  );
}

/** 상세 본문 (조회 결과 화면 배치만. 테스트에서도 같은 구성을 그린다) */
export function ReferralDetailContent({ detail, examTypeLabel }: { detail: ReferralDetail; examTypeLabel: string }) {
  const reservation = detail.reservation;
  const createdAt = detail.histories?.find((h) => h.reason === "REFERRAL_CREATED")?.occurredAt;
  const reservationEmpty = (key: string) => <Empty key={key} reason={reservation.state === "ok" ? "none" : reservation.state} />;
  return (
    <div className="flex flex-col gap-5">
      {/* 첫 줄: 검사 정보 | 예약 정보 (같은 높이), 좁은 화면은 세로 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className={cardClass}>
      <Section icon={Stethoscope} title="검사 정보">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Info label="환자명" strong>{detail.patientName}</Info>
          <Info label="검사 유형" strong>
            {/* 긴 검사 항목 이름은 단어 중간에서 끊지 않는다 */}
            <span className="break-keep">{examTypeLabel}</span>
          </Info>
          <Info label="검사기관">{reservation.state === "ok" ? cell(reservation.examInstitution) : reservationEmpty("i")}</Info>
          <Info label="검사 장비">{reservation.state === "ok" ? cell(reservation.equipment) : reservationEmpty("e")}</Info>
          <Info label="검사 일시">
            {reservation.state === "ok" && reservation.startTime ? formatDateTimeWithWeekday(reservation.startTime) : reservationEmpty("t")}
          </Info>
          <Info label="의뢰 요청 일시">{createdAt ? formatDateTimeWithWeekday(createdAt) : <Empty reason={detail.histories ? "none" : "error"} />}</Info>
        </dl>
      </Section>
      </div>

      <div className={cardClass}>
      <Section icon={CalendarClock} title="예약 정보">
        {reservation.state === "ok" ? (
          <div className="flex flex-col gap-4">
            {reservation.failureReason && <FailureReasonNotice reason={reservation.failureReason} />}
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <Info label="현재 예약 상태"><ReservationStatusBadge status={reservation.reservationStatus} /></Info>
              <Info label="예약 시도">{reservation.attemptNo}번째 시도</Info>
              <Info label="예약 확정 시각">{reservation.confirmedAt ? formatDateTimeWithWeekday(reservation.confirmedAt) : <Empty reason="none" />}</Info>
              <Info label="종료 시각">{reservation.endedAt ? formatDateTimeWithWeekday(reservation.endedAt) : <Empty reason="none" />}</Info>
            </dl>
          </div>
        ) : (
          <SectionNote>
            {reservation.state === "none"
              ? "연결된 예약이 없습니다."
              : reservation.state === "missing"
                ? "예약 정보를 찾을 수 없습니다."
                : "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
          </SectionNote>
        )}
      </Section>
      </div>
      </div>

      {/* 둘째 줄: 상태 변경 이력 (전체 너비, 길어지면 대화상자 본문만 스크롤) */}
      <div className={cardClass}>
      <Section icon={RefreshCw} title="상태 변경 이력">
        {!detail.histories ? (
          <SectionNote>변경 이력을 불러오지 못했습니다.</SectionNote>
        ) : detail.histories.length === 0 ? (
          <SectionNote>변경 이력이 없습니다.</SectionNote>
        ) : (
          <HistoryTimeline histories={detail.histories} />
        )}
      </Section>
      </div>
    </div>
  );
}
