"use client";

import { AlertTriangle } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import Modal from "@/components/ui/Modal";

import { changeExaminationStatusAction, registerExaminationResultAction } from "../actions";
import type { ExaminationProgressItem } from "../remote";
import { PROGRESS_ACTION_LABELS, type NextProgressStatus } from "../rules";
import type { ExaminationActionResult } from "../types";

type ExaminationApiActionTarget = Pick<
  ExaminationProgressItem,
  "examinationId" | "progressStatus" | "reservationStatus" | "resultRegistered" | "examDate" | "startTime" | "endTime"
>;

interface ExaminationApiActionsProps {
  examination: ExaminationApiActionTarget;
}

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
 */
export default function ExaminationApiActions({ examination }: ExaminationApiActionsProps) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ExaminationActionResult | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const next: NextProgressStatus | null =
    examination.progressStatus === "WAITING"
      ? "IN_PROGRESS"
      : examination.progressStatus === "IN_PROGRESS"
        ? "COMPLETED"
        : null;
  const startBlocked = next === "IN_PROGRESS" && examination.reservationStatus !== "CONFIRMED";
  const canRegister = examination.progressStatus === "COMPLETED" && !examination.resultRegistered;

  const changeStatus = async () => {
    if (!next || startBlocked || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setOutcome(null);
    try {
      setOutcome(await changeExaminationStatusAction(examination.examinationId, next));
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
        <button type="button" onClick={changeStatus} disabled={pending || startBlocked} aria-busy={pending} className={buttonClass}>
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
        open={registerOpen}
        title="검사 결과 등록"
        description={`검사 일시 ${examination.examDate.slice(0, 10)} ${examination.startTime.slice(11, 16)}~${examination.endTime.slice(11, 16)}`}
        closeOnBackdrop={false}
        onClose={() => setRegisterOpen(false)}
      >
        {registerOpen && (
          <ApiResultRegisterForm
            examinationId={examination.examinationId}
            onCancel={() => setRegisterOpen(false)}
            onRegistered={(result) => {
              setOutcome(result);
              setRegisterOpen(false);
            }}
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
  onCancel,
  onRegistered,
}: {
  examinationId: string;
  onCancel: () => void;
  onRegistered: (result: ExaminationActionResult) => void;
}) {
  const errorId = useId();
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      const result = await registerExaminationResultAction(examinationId, { summary, notes });
      if (result.ok) {
        onRegistered(result);
        return;
      }
      setSubmitError(result.message);
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

      <fieldset disabled={isSubmitting} className="flex flex-col gap-5">
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
          disabled={isSubmitting}
          className="h-12 rounded-lg bg-primary px-6 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {isSubmitting ? "등록 중" : "결과 등록"}
        </button>
      </div>
    </form>
  );
}
