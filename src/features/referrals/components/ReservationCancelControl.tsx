"use client";

import { AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { getReservationCancelAvailability, type CancelRecheckOutcome, type ReservationCancelTarget } from "../reservationCancel";
import { cancelReservationAction, type ReservationCancelActionResult } from "../reservationCancelActions";
import type { ReferralDetail } from "../server";

type OkReservation = Extract<ReferralDetail["reservation"], { state: "ok" }>;
type Failure = Extract<ReservationCancelActionResult, { ok: false }>;

/** 상세 대화상자에 남길 결과 안내 */
export interface ReservationCancelNotice {
  tone: "success" | "error" | "info";
  message: string;
  /** 결과 불명 뒤 상태 확인에 실패: 이 표식으로 상태 확인만 다시 할 수 있다 (취소 요청은 다시 보내지 않는다) */
  recheckTarget?: ReservationCancelTarget;
}

/** 취소 결과 불명(5xx·네트워크·타임아웃): 성공·실패를 단정하지 않고 최신 상태를 다시 조회한다 */
export const CANCEL_UNKNOWN_RESULT_NOTICE = "예약 취소 요청의 처리 결과를 확인하지 못했습니다. 최신 예약 상태를 확인하겠습니다.";

/** 결과 불명 뒤 다시 조회한 결과별 안내 (어느 경우에도 취소를 자동으로 다시 보내지 않는다) */
export function getCancelRecheckNotice(outcome: CancelRecheckOutcome, target: ReservationCancelTarget): ReservationCancelNotice {
  switch (outcome) {
    case "CANCELED":
      return { tone: "success", message: "최신 예약 상태를 확인한 결과, 예약 취소가 완료되었습니다." };
    case "SAME_CONFIRMED":
      return { tone: "info", message: "최신 예약 상태를 확인한 결과, 예약은 아직 취소되지 않았습니다. 예약 정보를 확인한 뒤 필요하면 [예약 취소]를 다시 눌러 주세요." };
    case "CHANGED":
      return { tone: "error", message: "예약 정보가 변경되었습니다. 이전 취소 요청은 다시 보내지 않았습니다. 최신 예약 정보를 확인해 주세요." };
    case "LOOKUP_FAILED":
      return {
        tone: "error",
        message: "최신 예약 상태를 확인하지 못해 예약 취소 처리 여부를 알 수 없습니다. 취소를 다시 요청하기 전에 [상태 다시 확인]을 눌러 주세요.",
        recheckTarget: target,
      };
  }
}

interface ReservationCancelControlProps {
  referralId: string;
  referralStatus: ReferralDetail["referralStatus"];
  reservation: OkReservation;
  /** 상세를 불러온 브라우저 시각(ms). 렌더링 중에 현재 시각을 읽지 않으려고 불러올 때 잡아 둔다 */
  checkedAtMs: number;
  /** 요청 중에는 상세 대화상자도 닫히지 않게 한다 */
  onPendingChange: (pending: boolean) => void;
  /**
   * 취소 성공·대상 변경·409 등: 안내를 남기고 상세를 다시 불러온다 (확인 창은 닫는다).
   * 결과 불명이면 확인한 예약 표식(unknownResultTarget)을 함께 넘긴다 → 다시 불러온 상세로 결과를 판단한다
   */
  onSettled: (notice: ReservationCancelNotice, unknownResultTarget?: ReservationCancelTarget) => void;
}

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";
/** 이 결과 뒤에는 서버 상태가 확인 창과 다를 수 있다: 확인 창을 닫고 최신 상세를 다시 불러온다 (같은 확인으로 다시 보내지 않는다) */
const REFETCH_REASONS: ReadonlySet<Failure["reason"]> = new Set(["STALE", "CONFLICT", "NOT_FOUND"]);
/** 다시 시도해도 해결되지 않는다: 확인 창에 안내만 하고 확정 버튼을 막는다 */
const BLOCKING_REASONS: ReadonlySet<Failure["reason"]> = new Set(["SIGNED_OUT", "UNAUTHORIZED", "FORBIDDEN", "FORBIDDEN_ORIGIN", "NOT_AVAILABLE", "INVALID_INPUT"]);

const dangerButtonClass =
  "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-line disabled:text-gray-400";
const confirmDangerClass =
  "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none";
const secondaryClass =
  "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300";

/**
 * 의뢰 상세(API 모드)의 '예약 취소' 버튼과 확인 창. 상세 대화상자 하단에 둔다 (목록에는 두지 않는다).
 * - 표시: 의뢰·예약 CONFIRMED, 검사 시작 2시간 전(KST)까지. 마감이 지났으면 버튼 대신 안내 (최종 판단은 백엔드)
 * - 확인 창에는 상세에서 이미 받은 검사 일정을 그대로 보인다. 그 값(시도 번호·시각)을 취소 대상 표식으로 함께 보낸다
 *   → 확인한 뒤 재조정 등으로 현재 예약이 바뀌었으면 서버가 취소하지 않는다 (STALE)
 * - 요청 중에는 확정·닫기·Esc를 막고 ref로 연속 클릭을 막는다
 */
export default function ReservationCancelControl({ referralId, referralStatus, reservation, checkedAtMs, onPendingChange, onSettled }: ReservationCancelControlProps) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  /** 열 때 고정한 확인 대상 (확인 창이 보여 주는 예약 = 서버로 보내는 표식) */
  const [confirmTarget, setConfirmTarget] = useState<(ReservationCancelTarget & { reservation: OkReservation }) | null>(null);
  const [confirmError, setConfirmError] = useState<Failure | null>(null);
  /** 버튼을 누른 순간 마감이 지났는지 다시 확인한 결과 (렌더링 중 현재 시각을 읽지 않는다) */
  const [deadlinePassedAtClick, setDeadlinePassedAtClick] = useState(false);

  const availability = deadlinePassedAtClick ? "DEADLINE_PASSED" : getReservationCancelAvailability(referralStatus, reservation, checkedAtMs);
  if (availability === "NOT_APPLICABLE") return null;
  if (availability === "DEADLINE_PASSED") {
    return <p className="mr-auto self-center text-sm text-gray-500">검사 시작 2시간 전이 지나 예약을 취소할 수 없습니다.</p>;
  }

  const setBusy = (value: boolean) => {
    pendingRef.current = value;
    setPending(value);
    onPendingChange(value);
  };

  const openConfirm = () => {
    if (pendingRef.current) return;
    if (getReservationCancelAvailability(referralStatus, reservation, Date.now()) !== "AVAILABLE") {
      setDeadlinePassedAtClick(true);
      return;
    }
    const { attemptNo, startTime, endTime } = reservation;
    if (!startTime || !endTime) return;
    setConfirmError(null);
    setConfirmTarget({ attemptNo, startTime, endTime, reservation });
  };

  const closeConfirm = () => {
    if (pendingRef.current) return;
    setConfirmTarget(null);
  };

  const submit = async () => {
    if (!confirmTarget || pendingRef.current || (confirmError && BLOCKING_REASONS.has(confirmError.reason))) return;
    setBusy(true);
    setConfirmError(null);
    let result: ReservationCancelActionResult;
    try {
      const { attemptNo, startTime, endTime } = confirmTarget;
      result = await cancelReservationAction(referralId, { attemptNo, startTime, endTime });
    } catch {
      result = { ok: false, reason: "UNKNOWN_RESULT", message: NETWORK_ERROR_MESSAGE, code: null };
    }
    setBusy(false);
    if (result.ok) {
      setConfirmTarget(null);
      onSettled({ tone: "success", message: result.message });
    } else if (result.reason === "UNKNOWN_RESULT") {
      // 처리 결과를 모른다: 확인 창을 닫고(같은 확인으로 다시 보내지 않음) 최신 상세로 결과를 판단한다. 자동 재요청 없음
      const { attemptNo, startTime, endTime } = confirmTarget;
      setConfirmTarget(null);
      onSettled({ tone: "info", message: CANCEL_UNKNOWN_RESULT_NOTICE }, { attemptNo, startTime, endTime });
    } else if (REFETCH_REASONS.has(result.reason)) {
      setConfirmTarget(null);
      onSettled({ tone: "error", message: result.message });
    } else {
      setConfirmError(result);
    }
  };

  const shown = confirmTarget?.reservation;
  const blocked = !!confirmError && BLOCKING_REASONS.has(confirmError.reason);
  return (
    <>
      <button type="button" onClick={openConfirm} disabled={pending} aria-haspopup="dialog" className={`mr-auto ${dangerButtonClass}`}>
        예약 취소
      </button>
      <Modal
        open={!!confirmTarget}
        title="예약을 취소할까요?"
        description="취소 후에는 되돌릴 수 없습니다."
        closeOnBackdrop={false}
        preventClose={pending}
        onClose={closeConfirm}
        footer={
          <>
            <button type="button" onClick={closeConfirm} disabled={pending} className={secondaryClass}>
              닫기
            </button>
            <button type="button" onClick={() => void submit()} disabled={pending || blocked} aria-busy={pending} className={confirmDangerClass}>
              {pending ? "예약 취소 중" : "예약 취소"}
            </button>
          </>
        }
      >
        {shown && (
          <div className="flex flex-col gap-4">
            {confirmError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>{confirmError.message}</p>
              </div>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5 rounded-xl border border-line bg-gray-50/60 px-4 py-4 text-sm">
              <dt className="text-gray-500">검사 일시</dt>
              <dd className="font-semibold tabular-nums text-gray-900">
                {formatDateTimeWithWeekday(confirmTarget.startTime)} ~ {confirmTarget.endTime.slice(11, 16)}
              </dd>
              <dt className="text-gray-500">검사기관</dt>
              <dd className="break-words text-gray-900">{shown.examInstitution.state === "ok" ? shown.examInstitution.value : <span className="text-gray-400">확인 불가</span>}</dd>
              <dt className="text-gray-500">검사 장비</dt>
              <dd className="break-words text-gray-900">{shown.equipment.state === "ok" ? shown.equipment.value : <span className="text-gray-400">확인 불가</span>}</dd>
              <dt className="text-gray-500">예약 시도</dt>
              <dd className="text-gray-900">{confirmTarget.attemptNo}번째 시도</dd>
            </dl>
            <p className="text-xs text-gray-500">검사 시작 2시간 전까지만 취소할 수 있으며, 최종 가능 여부는 서버에서 확인합니다.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
