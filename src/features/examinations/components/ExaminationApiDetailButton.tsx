"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import Modal from "@/components/ui/Modal";
import { detailButtonClass } from "@/components/ui/styles";
import { NETWORK_FAILURE, useDetailResult } from "@/features/admin/components/AdminDetailParts";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import { abbreviateReferralId } from "@/features/referrals/referralId";

import type { ExaminationResultLoadResult } from "../lookups";
import type { ExaminationProgressItem } from "../remote";
import { loadExaminationResultAction } from "../resultActions";
import type { ResultRegistrationStatus } from "../types";

import { ProgressStatusBadge, ResultRegistrationBadge } from "./ExaminationBadges";

interface ExaminationApiDetailButtonProps {
  examination: ExaminationProgressItem;
  examTypeName: string | null;
  equipmentName: string | null;
  resultStatus: ResultRegistrationStatus;
}

/**
 * 검사 상세 (API 모드). 목록 응답 값만 보여 주고, 결과가 등록된 검사만 열 때 결과 조회 API를 1회 부른다.
 * 상태 변경·결과 등록은 목록의 기존 버튼(ExaminationApiActions)에서만 한다.
 */
export default function ExaminationApiDetailButton({ examination, examTypeName, equipmentName, resultStatus }: ExaminationApiDetailButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`의뢰 ${abbreviateReferralId(examination.referralId)} 검사 상세 보기`}
        className={detailButtonClass}
      >
        상세
      </button>
      <Modal
        open={open}
        size="lg"
        title="검사 상세"
        titleAddon={<ProgressStatusBadge status={examination.progressStatus} />}
        onClose={() => setOpen(false)}
      >
        {open && <DetailBody examination={examination} examTypeName={examTypeName} equipmentName={equipmentName} resultStatus={resultStatus} />}
      </Modal>
    </>
  );
}

function DetailBody({ examination, examTypeName, equipmentName, resultStatus }: ExaminationApiDetailButtonProps) {
  const rows: [string, React.ReactNode][] = [
    ["의뢰 번호", <ReferralIdCopyButton key="r" referralId={examination.referralId} label="의뢰 번호" />],
    ["검사 유형", examTypeName ?? <span className="text-gray-400">확인 불가</span>],
    ["검사 장비", equipmentName ?? <span className="text-gray-400">확인 불가</span>],
    ["검사 예정 일시", `${examination.examDate.slice(0, 10)} ${examination.startTime.slice(11, 16)} ~ ${examination.endTime.slice(11, 16)}`],
    ["검사 시작", examination.startedAt ? examination.startedAt.slice(0, 16).replace("T", " ") : "-"],
    ["검사 완료", examination.completedAt ? examination.completedAt.slice(0, 16).replace("T", " ") : "-"],
    ["결과 상태", <ResultRegistrationBadge key="s" status={resultStatus} />],
  ];
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-xl border border-line bg-gray-50/60 p-4 text-sm sm:grid-cols-2 sm:p-5">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium text-gray-500">{label}</dt>
            <dd className="mt-1 text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="examination-result-title" className="flex flex-col gap-2">
        <h3 id="examination-result-title" className="text-base font-bold text-gray-900">
          검사 결과
        </h3>
        {examination.resultRegistered ? (
          <ResultView examinationId={examination.examinationId} />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-gray-500">
            {examination.progressStatus === "COMPLETED" ? "아직 등록된 결과가 없습니다. 목록의 [결과 등록]으로 등록해 주세요." : "검사를 완료한 뒤 결과를 등록할 수 있습니다."}
          </p>
        )}
      </section>
    </div>
  );
}

function ResultView({ examinationId }: { examinationId: string }) {
  const { value, retry } = useDetailResult<ExaminationResultLoadResult>(examinationId, () => loadExaminationResultAction(examinationId), NETWORK_FAILURE);
  if (value === null) {
    return (
      <p role="status" className="flex items-center gap-2 py-4 text-sm text-gray-500">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        검사 결과를 불러오고 있습니다.
      </p>
    );
  }
  if (!value.ok) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {value.message}
        {(value.reason === "NETWORK" || value.reason === "ERROR") && (
          <button type="button" onClick={retry} className="inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            다시 시도
          </button>
        )}
      </div>
    );
  }
  const { summary, notes, registeredAt } = value.result;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4 text-sm">
      <div>
        <p className="text-xs font-medium text-gray-500">결과 요약</p>
        <p className="mt-1 whitespace-pre-wrap text-gray-900">{summary}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500">추가 소견</p>
        <p className="mt-1 whitespace-pre-wrap text-gray-900">{notes?.trim() ? notes : <span className="text-gray-400">없음</span>}</p>
      </div>
      <p className="text-xs text-gray-500">등록 일시 {registeredAt.slice(0, 16).replace("T", " ")}</p>
    </div>
  );
}
