"use client";

import { useRef, useState, type ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadReferralDetailAction } from "../actions";
import { FAILURE_REASON_LABELS, HISTORY_REASON_LABELS, REFERRAL_STATUS_LABELS, RESERVATION_STATUS_LABELS } from "../labels";
import { abbreviateReferralId } from "../referralId";
import type { DetailCell, ReferralDetailLoadResult } from "../server";

import DetailList from "./DetailList";
import ReferralStatusBadge from "./ReferralStatusBadge";

interface ReferralApiDetailButtonProps {
  /** 의뢰 ID 원본 (상세 조회에 그대로 쓴다) */
  referralId: string;
  /** 목록에서 검사 유형 API로 바꾼 문구 (상세에서 다시 조회하지 않는다) */
  examTypeLabel: string;
  /** 목록 배지와 같은 표시 상태 */
  badgeStatus: Parameters<typeof ReferralStatusBadge>[0]["status"];
}

const STATUS_LABELS = REFERRAL_STATUS_LABELS;
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";
const EMPTY_REASON = { none: "정보 없음", missing: "찾을 수 없음", error: "불러오지 못함" } as const;

function Empty({ reason }: { reason: keyof typeof EMPTY_REASON }) {
  return <span className="text-gray-400">— ({EMPTY_REASON[reason]})</span>;
}
const cell = (value: DetailCell) => (value.state === "ok" ? value.value : <Empty reason={value.state} />);

/**
 * 의뢰 목록(API 모드)의 '상세' 버튼과 상세 대화상자. 모양은 Mock 의뢰 상세 모달과 같다 (Modal + DetailList).
 * 열 때 Server Function으로 한 건만 조회한다 (의뢰·변경 이력·현재 예약·검사기관·장비). 예약 상태와 관계없이 열 수 있다.
 * 응답에 없는 값(의뢰 목적 등)은 만들지 않고, 조회하지 못한 값은 "—"와 이유로 보인다. 조회 전용이며 아무것도 바꾸지 않는다.
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

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={`${abbreviateReferralId(referralId)} 상세`}
        className="h-10 w-[92px] rounded-lg border border-primary bg-white text-[15px] font-semibold text-primary transition-colors hover:bg-primary-soft"
      >
        상세
      </button>
      <Modal open={open} title="의뢰 상세" description={abbreviateReferralId(referralId)} onClose={() => setOpen(false)}>
        {!result ? (
          <p role="status" className="py-8 text-center text-[15px] text-gray-500">
            의뢰 상세를 불러오고 있습니다.
          </p>
        ) : !result.ok ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-lg bg-red-50 px-4 py-6 text-center text-red-700">
            <p className="text-[15px] font-semibold">의뢰 상세를 불러오지 못했습니다.</p>
            <p className="text-sm">{result.message}</p>
            <button type="button" onClick={show} className="h-10 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              다시 시도
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <DetailList
              items={[
                ["예약 상태", <ReferralStatusBadge key="status" status={badgeStatus} />],
                ["의뢰 번호", <code key="id" className="break-all font-mono text-sm">{detail!.referralId}</code>],
                ["환자명", detail!.patientName],
                ["검사기관", reservation?.state === "ok" ? cell(reservation.examInstitution) : <Empty key="i" reason={reservation!.state} />],
                ["검사 장비", reservation?.state === "ok" ? cell(reservation.equipment) : <Empty key="e" reason={reservation!.state} />],
                ["검사 유형", examTypeLabel],
                [
                  "검사 일시",
                  reservation?.state === "ok" && reservation.startTime ? (
                    formatDateTimeWithWeekday(reservation.startTime)
                  ) : (
                    <Empty key="t" reason={reservation?.state === "ok" ? "none" : reservation!.state} />
                  ),
                ],
                ["의뢰 요청 일시", createdAt ? formatDateTimeWithWeekday(createdAt) : <Empty key="c" reason={detail!.histories ? "none" : "error"} />],
              ]}
            />

            <section aria-labelledby={`reservation-${referralId}`} className="rounded-lg bg-gray-50 p-4">
              <h3 id={`reservation-${referralId}`} className="mb-3 text-[15px] font-semibold text-gray-800">
                현재 예약
              </h3>
              {reservation?.state === "ok" ? (
                <DetailList
                  items={[
                    ["예약 처리", `${RESERVATION_STATUS_LABELS[reservation.reservationStatus]} (${reservation.attemptNo}번째 시도)`],
                    ...(reservation.failureReason
                      ? ([["실패 사유", <span key="f" className="font-medium text-red-700">{FAILURE_REASON_LABELS[reservation.failureReason]}</span>]] as [string, ReactNode][])
                      : []),
                    ["확정 시각", reservation.confirmedAt ? formatDateTimeWithWeekday(reservation.confirmedAt) : <Empty key="cf" reason="none" />],
                    ...(reservation.endedAt ? ([["종료 시각", formatDateTimeWithWeekday(reservation.endedAt)]] as [string, ReactNode][]) : []),
                  ]}
                />
              ) : (
                <p className="text-sm text-gray-600">
                  {reservation?.state === "none"
                    ? "연결된 예약이 없습니다."
                    : reservation?.state === "missing"
                      ? "예약 정보를 찾을 수 없습니다."
                      : "예약 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
                </p>
              )}
            </section>

            <section aria-labelledby={`history-${referralId}`}>
              <h3 id={`history-${referralId}`} className="mb-3 text-[15px] font-semibold text-gray-800">
                상태 변경 이력
              </h3>
              {!detail!.histories ? (
                <p className="text-sm text-gray-600">변경 이력을 불러오지 못했습니다.</p>
              ) : detail!.histories.length === 0 ? (
                <p className="text-sm text-gray-600">변경 이력이 없습니다.</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {detail!.histories.map((h, index) => (
                    <li key={`${h.occurredAt}-${index}`} className="flex flex-wrap gap-x-3 gap-y-0.5 rounded-md border border-line px-3 py-2">
                      <span className="tabular-nums text-gray-500">{formatDateTimeWithWeekday(h.occurredAt)}</span>
                      <span className="font-medium text-gray-900">{HISTORY_REASON_LABELS[h.reason]}</span>
                      <span className="text-gray-600">
                        {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : ""}
                        {STATUS_LABELS[h.toStatus]}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
        <div className="mt-7 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-11 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            닫기
          </button>
        </div>
      </Modal>
    </>
  );
}
