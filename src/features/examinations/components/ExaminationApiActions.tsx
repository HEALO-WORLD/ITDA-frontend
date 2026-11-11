"use client";

import { AlertTriangle } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import Modal from "@/components/ui/Modal";
import { useRenderedLoginSession } from "@/features/auth/loginSessionContext";
import { abbreviateReferralId } from "@/features/referrals/referralId";

import { changeExaminationStatusAction, registerExaminationResultAction } from "../actions";
import type { ExaminationProgressItem } from "../remote";
import { PROGRESS_ACTION_LABELS, type NextProgressStatus } from "../rules";
import type { ExaminationActionResult } from "../types";

import { PROGRESS_STATUS_LABELS } from "./ExaminationBadges";

type ExaminationApiActionTarget = Pick<
  ExaminationProgressItem,
  "examinationId" | "progressStatus" | "reservationStatus" | "resultRegistered" | "examDate" | "startTime" | "endTime"
>;

interface ExaminationApiActionsProps {
  examination: ExaminationApiActionTarget;
  /** 검사 완료 확인 창에 보여 줄 값 (목록에서 이미 받은 값. 추가 조회하지 않는다). 이름을 모르면 null */
  detail?: { referralId: string; examTypeName: string | null; equipmentName: string | null };
}

const secondaryClass =
  "h-10 whitespace-nowrap rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300";
const confirmClass =
  "h-10 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400";

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

const buttonClass =
  "h-9 whitespace-nowrap rounded-lg bg-primary px-3.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400";

/**
 * API 모드 검사 목록의 행별 처리 (검사 시작·검사 완료·결과 등록).
 * - 백엔드 계약대로 한 단계씩만 바꾼다: 대기 → 진행 중 → 완료. 완료된 검사는 바꾸지 않는다
 * - 검사 시작은 확정된 예약일 때만 서버가 허용하므로(EXAMINATION_START_NOT_ALLOWED) 미리 막고 이유를 보여 준다
 * - 결과 등록은 완료됐고 결과가 없는 검사에만 보인다 (한 번만 등록 가능)
 * - 처리 중에는 다시 요청하지 않는다 (상태 갱신 전 연속 클릭까지 ref로 막는다)
 * - 성공·409는 Server Function의 refresh()로 목록이 서버 값으로 다시 그려진다. 화면에서 먼저 바꾸지 않는다
 * - 검사 완료는 오조작을 막으려고 확인 창을 거친다: 버튼은 창만 열고, [검사 완료 확정]에서만 요청한다
 *   (요청 중에는 확정·취소·Esc·닫기 버튼을 막고, 실패하면 창을 유지한 채 안내한다. 409는 서버가 다시 불러온 상태라 다시 확정하지 않게 막는다)
 *   장비 장애 수동 확인과는 별개다 (수동 확인 이력 API가 없어 여기서 다루지 않는다)
 */
export default function ExaminationApiActions({ examination, detail }: ExaminationApiActionsProps) {
  /** 이 화면이 렌더링된 로그인 세션 (SessionGuard 제공). 상태 변경·결과 등록에 함께 보낸다 */
  const renderedLoginSession = useRenderedLoginSession();
  /** 다른 탭에서 계정이 바뀌어 서버가 요청하지 않았다: 이 화면에서는 변경 요청을 다시 보내지 않는다 */
  const [sessionChanged, setSessionChanged] = useState(false);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ExaminationActionResult | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 확인 창 안의 실패 안내 (창을 다시 열면 지운다) */
  const [confirmError, setConfirmError] = useState<Extract<ExaminationActionResult, { ok: false }> | null>(null);

  const next: NextProgressStatus | null =
    examination.progressStatus === "WAITING"
      ? "IN_PROGRESS"
      : examination.progressStatus === "IN_PROGRESS"
        ? "COMPLETED"
        : null;
  const startBlocked = next === "IN_PROGRESS" && examination.reservationStatus !== "CONFIRMED";
  const canRegister = examination.progressStatus === "COMPLETED" && !examination.resultRegistered;

  const openConfirm = () => {
    if (pendingRef.current || sessionChanged) return;
    setOutcome(null);
    setConfirmError(null);
    setConfirmOpen(true);
  };

  /** [검사 완료 확정]: 기존 Server Function을 한 번만 부른다. 성공하면 창을 닫고(목록은 refresh로 서버 값), 실패하면 창 안에 안내 */
  const confirmComplete = async () => {
    if (examination.progressStatus !== "IN_PROGRESS" || pendingRef.current || sessionChanged || confirmError?.reason === "CONFLICT") return;
    pendingRef.current = true;
    setPending(true);
    setConfirmError(null);
    try {
      const result = await changeExaminationStatusAction(examination.examinationId, "COMPLETED", renderedLoginSession);
      if (result.ok) {
        setConfirmOpen(false);
        setOutcome(result);
      } else {
        setConfirmError(result);
        if (result.reason === "SESSION_CHANGED") setSessionChanged(true);
      }
    } catch {
      setConfirmError({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const changeStatus = async () => {
    if (!next || startBlocked || pendingRef.current || sessionChanged) return;
    pendingRef.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const result = await changeExaminationStatusAction(examination.examinationId, next, renderedLoginSession);
      setOutcome(result);
      if (!result.ok && result.reason === "SESSION_CHANGED") setSessionChanged(true);
    } catch {
      setOutcome({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      {next && (
        <button
          type="button"
          onClick={next === "COMPLETED" ? openConfirm : changeStatus}
          disabled={pending || startBlocked || sessionChanged}
          aria-busy={pending}
          aria-haspopup={next === "COMPLETED" ? "dialog" : undefined}
          className={buttonClass}
        >
          {pending ? `${PROGRESS_ACTION_LABELS[next]} 처리 중` : PROGRESS_ACTION_LABELS[next]}
        </button>
      )}
      {startBlocked && <p className="text-xs text-gray-500">예약이 확정된 검사만 시작할 수 있습니다.</p>}
      {canRegister && (
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            setRegisterOpen(true);
          }}
          disabled={sessionChanged}
          className={buttonClass}
        >
          결과 등록
        </button>
      )}
      {/* 실패 메시지만 표시하고 성공 메시지는 표시하지 않음 */}
      {outcome && !outcome.ok && (
        <p role="alert" className="max-w-[240px] text-xs text-red-600">
          {outcome.message}
        </p>
      )}

      <Modal
        open={confirmOpen}
        title="검사를 완료하시겠습니까?"
        description={
          <>
            실제 검사가 완료되었는지 확인해 주세요.
            <br />
            완료 처리 후 검사 결과를 등록할 수 있습니다.
          </>
        }
        closeOnBackdrop={false}
        preventClose={pending}
        onClose={() => !pendingRef.current && setConfirmOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={pending} className={secondaryClass}>
              {confirmError?.reason === "CONFLICT" ? "닫기" : "취소"}
            </button>
            <button
              type="button"
              onClick={() => void confirmComplete()}
              disabled={pending || sessionChanged || confirmError?.reason === "CONFLICT"}
              aria-busy={pending}
              className={confirmClass}
            >
              {pending ? "검사 완료 처리 중" : "검사 완료 확정"}
            </button>
          </>
        }
      >
        {confirmOpen && (
          <div className="flex flex-col gap-4">
            {confirmError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  {confirmError.message}
                  {confirmError.reason === "CONFLICT" && " 최신 상태를 다시 불러왔습니다. 목록에서 상태를 확인해 주세요."}
                </p>
              </div>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5 rounded-xl border border-line bg-gray-50/60 px-4 py-4 text-sm">
              <dt className="text-gray-500">의뢰 번호</dt>
              <dd className="font-mono text-[13px] text-gray-900" title={detail?.referralId}>
                {detail ? abbreviateReferralId(detail.referralId) : <span className="font-sans text-gray-400">확인 불가</span>}
              </dd>
              <dt className="text-gray-500">검사 유형</dt>
              <dd className="break-words font-semibold text-gray-900">{detail?.examTypeName ?? <span className="font-normal text-gray-400">확인 불가</span>}</dd>
              <dt className="text-gray-500">검사 장비</dt>
              <dd className="break-words text-gray-900">{detail?.equipmentName ?? <span className="text-gray-400">확인 불가</span>}</dd>
              <dt className="text-gray-500">검사 예정 일시</dt>
              <dd className="tabular-nums text-gray-900">
                {examination.examDate.slice(0, 10)} {examination.startTime.slice(11, 16)} ~ {examination.endTime.slice(11, 16)}
              </dd>
              <dt className="text-gray-500">현재 상태</dt>
              <dd className="text-gray-900">{PROGRESS_STATUS_LABELS.IN_PROGRESS}</dd>
              <dt className="text-gray-500">변경 상태</dt>
              <dd className="font-semibold text-emerald-700">{PROGRESS_STATUS_LABELS.COMPLETED}</dd>
            </dl>
          </div>
        )}
      </Modal>

      <Modal
        open={registerOpen}
        title="검사 결과 등록"
        description={`검사 일시 ${examination.examDate.slice(0, 10)} ${examination.startTime.slice(11, 16)}~${examination.endTime.slice(11, 16)}`}
        closeOnBackdrop={false}
        onClose={() => setRegisterOpen(false)}
      >
        {registerOpen && (
          <ApiResultRegisterForm
            examinationId={examination.examinationId}
            loginSession={renderedLoginSession}
            onCancel={() => setRegisterOpen(false)}
            onRegistered={(result) => {
              setOutcome(result);
              setRegisterOpen(false);
            }}
            onSessionChanged={() => setSessionChanged(true)}
          />
        )}
      </Modal>
    </div>
  );
}

const fieldLabelClass = "mb-2 block text-[15px] font-bold text-gray-800";
const controlClass =
  "w-full resize-y rounded-lg border bg-white px-4 py-3 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * API 모드 결과 등록 폼 (백엔드 ExaminationResultCreateRequest: 결과 요약 필수, 추가 소견 선택).
 * Mock 폼의 결과 상태 선택·1000자 제한은 백엔드에 없어 쓰지 않는다.
 * 실패하면 입력값을 그대로 두고 안내한다.
 */
function ApiResultRegisterForm({
  examinationId,
  loginSession,
  onCancel,
  onRegistered,
  onSessionChanged,
}: {
  examinationId: string;
  /** 화면이 렌더링된 로그인 세션 (결과 등록 요청에 함께 보낸다) */
  loginSession: string | null | undefined;
  onCancel: () => void;
  onRegistered: (result: ExaminationActionResult) => void;
  /** 다른 탭에서 계정이 바뀌어 등록하지 않았다 (상위가 다른 변경 버튼도 잠근다) */
  onSessionChanged: () => void;
}) {
  const errorId = useId();
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** SESSION_CHANGED 뒤: 등록을 다시 보내지 않는다 (submittingRef도 풀지 않는다) */
  const [sessionLocked, setSessionLocked] = useState(false);
  const submittingRef = useRef(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setSubmitError(null);
    if (!summary.trim()) {
      setSummaryError("검사 결과 요약을 입력해 주세요.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await registerExaminationResultAction(examinationId, { summary, notes }, loginSession);
      if (result.ok) {
        onRegistered(result);
        return;
      }
      setSubmitError(result.message);
      if (result.reason === "SESSION_CHANGED") {
        // 이 폼에서는 다시 보내지 않는다 (입력·등록 버튼 잠금, 취소로 닫기만)
        setSessionLocked(true);
        onSessionChanged();
        setIsSubmitting(false);
        return;
      }
    } catch {
      setSubmitError(NETWORK_ERROR_MESSAGE);
    }
    submittingRef.current = false;
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      {submitError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>{submitError}</p>
        </div>
      )}

      <fieldset disabled={isSubmitting || sessionLocked} className="flex flex-col gap-5">
        <div>
          <label htmlFor="api-result-summary" className={fieldLabelClass}>
            결과 요약 <span className="text-red-600">*</span>
          </label>
          <textarea
            id="api-result-summary"
            data-autofocus
            rows={4}
            value={summary}
            placeholder="검사 결과 요약을 입력해 주세요."
            aria-invalid={summaryError ? true : undefined}
            aria-describedby={summaryError ? errorId : undefined}
            onChange={(e) => {
              setSummary(e.target.value);
              setSummaryError(null);
            }}
            className={`${controlClass} ${summaryError ? "border-red-500" : "border-line"}`}
          />
          {summaryError && (
            <p id={errorId} className="mt-1.5 text-sm text-red-600">
              {summaryError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="api-result-notes" className={fieldLabelClass}>
            추가 소견 <span className="text-sm font-normal text-gray-500">(선택)</span>
          </label>
          <textarea
            id="api-result-notes"
            rows={3}
            value={notes}
            placeholder="추가 소견이 있으면 입력해 주세요."
            onChange={(e) => setNotes(e.target.value)}
            className={`${controlClass} border-line`}
          />
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="h-12 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isSubmitting || sessionLocked}
          className="h-12 rounded-lg bg-primary px-6 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {isSubmitting ? "등록 중" : "결과 등록"}
        </button>
      </div>
    </form>
  );
}
