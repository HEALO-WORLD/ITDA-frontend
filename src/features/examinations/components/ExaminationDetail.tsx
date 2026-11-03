import { useRef, useState, type ReactNode } from "react";

import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { changeExaminationProgress } from "../progress";
import {
  getNextProgressStatus,
  getProgressChangeBlockReason,
  getRegistrationBlockReason,
  getResultRegistrationStatus,
  PROGRESS_ACTION_LABELS,
  RESULT_STATUS_LABELS,
  type NextProgressStatus,
} from "../rules";
import type { Examination } from "../types";

import { ProgressStatusBadge, ResultRegistrationBadge } from "./ExaminationBadges";

interface ExaminationDetailProps {
  examination: Examination;
  /** 결과 등록이 가능한 건에서 등록 모달로 넘어간다 */
  onRegister: () => void;
  /** 진행 상태를 바꾼 뒤 목록·요약에 반영한다 */
  onProgressChanged: (status: NextProgressStatus) => void;
}

/**
 * 검사 상세 모달 본문.
 * 데이터에 있는 항목만 표시하고, 값이 없는 항목(의뢰 목적 등)은 숨긴다.
 * 대기·진행 중 검사는 [검사 시작]·[검사 완료]로 다음 단계로만 바꿀 수 있다 (개발용 Mock, 서버에 저장하지 않는다).
 */
export default function ExaminationDetail({ examination, onRegister, onProgressChanged }: ExaminationDetailProps) {
  const resultStatus = getResultRegistrationStatus(examination);
  const blockReason = getRegistrationBlockReason(examination);
  const { result } = examination;
  const nextProgress = getNextProgressStatus(examination);
  const progressBlockReason = nextProgress ? getProgressChangeBlockReason(examination, nextProgress) : null;
  const [isChanging, setIsChanging] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  /** 상태 갱신 전 연속 클릭까지 막는다 (버튼 비활성화는 다음 렌더부터 적용된다) */
  const changingRef = useRef(false);

  const handleChangeProgress = async () => {
    if (!nextProgress || changingRef.current) return;
    changingRef.current = true;
    setIsChanging(true);
    setProgressError(null);
    try {
      const outcome = await changeExaminationProgress(examination, nextProgress);
      if (outcome.ok) onProgressChanged(outcome.progressStatus);
      else setProgressError(outcome.message);
    } finally {
      changingRef.current = false;
      setIsChanging(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="의뢰 정보">
        <FieldGrid>
          <Field label="의뢰번호">{examination.referralNumber}</Field>
          <Field label="가상 환자 ID">{examination.virtualPatientId}</Field>
          <Field label="의뢰기관">{examination.referringOrganizationName}</Field>
          <Field label="의뢰 요청 일시">{formatDateTimeWithWeekday(examination.requestedAt)}</Field>
          {examination.purpose && (
            <Field label="의뢰 목적" wide>
              {examination.purpose}
            </Field>
          )}
        </FieldGrid>
      </Section>

      <Section title="검사기관·장비">
        <FieldGrid>
          <Field label="검사기관">{examination.organizationName}</Field>
          <Field label="검사 장비">{examination.equipmentName}</Field>
          <Field label="검사 유형">{examination.examType}</Field>
          <Field label="검사 예정 일시">{formatDateTimeWithWeekday(examination.scheduledAt)}</Field>
          <Field label="예약 상태">
            <ReferralStatusBadge status={examination.reservationStatus} />
          </Field>
        </FieldGrid>
      </Section>

      <Section title="검사 진행·결과">
        <FieldGrid>
          <Field label="검사 진행 상태">
            <ProgressStatusBadge status={examination.progressStatus} />
          </Field>
          <Field label="결과 등록 상태">
            <ResultRegistrationBadge status={resultStatus} />
          </Field>
          {result && (
            <>
              <Field label="검사 결과 상태">{RESULT_STATUS_LABELS[result.status]}</Field>
              <Field label="결과 등록 일시">{formatDateTimeWithWeekday(result.registeredAt)}</Field>
              <Field label="검사 결과" wide>
                <p className="whitespace-pre-wrap rounded-lg bg-surface-muted px-4 py-3 font-normal">{result.text}</p>
              </Field>
            </>
          )}
        </FieldGrid>

        {nextProgress && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">
                {nextProgress === "IN_PROGRESS"
                  ? "검사를 시작하면 검사 진행 중 상태로 바뀝니다."
                  : "검사를 마치면 검사 완료로 바뀌고 결과를 등록할 수 있습니다."}
                <span className="ml-1 text-xs text-gray-500">(개발용 예시: 서버에 저장되지 않습니다.)</span>
              </p>
              <button
                type="button"
                onClick={handleChangeProgress}
                disabled={isChanging || progressBlockReason !== null}
                aria-busy={isChanging}
                className="h-9 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              >
                {isChanging ? `${PROGRESS_ACTION_LABELS[nextProgress]} 처리 중` : PROGRESS_ACTION_LABELS[nextProgress]}
              </button>
            </div>
            {progressBlockReason && <p className="text-sm text-gray-500">{progressBlockReason}</p>}
            {progressError && (
              <p role="alert" className="text-sm text-red-600">
                {progressError}
              </p>
            )}
          </div>
        )}

        {resultStatus === "PENDING" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900">검사가 완료되었고 결과가 아직 등록되지 않았습니다.</p>
            <button
              type="button"
              onClick={onRegister}
              className="h-9 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              결과 등록
            </button>
          </div>
        ) : (
          !result && blockReason && <p className="text-sm text-gray-500">{blockReason}</p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="border-b border-line pb-2 text-sm font-bold text-gray-500">{title}</h3>
      {children}
    </section>
  );
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-[15px] font-medium text-gray-900">{children}</dd>
    </div>
  );
}
