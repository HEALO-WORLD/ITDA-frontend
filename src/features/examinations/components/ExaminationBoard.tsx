"use client";

import { CheckCircle2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { useSeoulNow } from "@/lib/date/useSeoulNow";

import {
  EMPTY_EXAMINATION_CRITERIA,
  filterExaminations,
  hasExaminationCriteria,
  sortExaminations,
  summarizeExaminations,
  validateExaminationCriteria,
} from "../query";
import type { NextProgressStatus } from "../rules";
import type { ExamResult, Examination, ExaminationSearchCriteria } from "../types";

import { ProgressStatusBadge } from "./ExaminationBadges";
import ExaminationDetail from "./ExaminationDetail";
import ExaminationFilter from "./ExaminationFilter";
import ExaminationSummary from "./ExaminationSummary";
import ExaminationTable from "./ExaminationTable";
import ResultRegisterForm from "./ResultRegisterForm";

interface ExaminationBoardProps {
  /** 현재 검사기관의 검사 전체 (기관 필터링이 먼저 적용된 상태) */
  examinations: Examination[];
}

type ModalState = { type: "detail" | "register"; id: string } | null;

/**
 * 검사 진행·결과의 클라이언트 경계: 요약 → 검사 목록(검색 툴바·테이블) → 상세·결과 등록 모달.
 * 결과 등록·진행 상태 변경(Mock)은 이 컴포넌트 상태에만 반영하므로 목록·상세·요약·필터가 같은 데이터를 본다.
 * 과거 검사 이력도 관리하므로 지난 날짜도 검색할 수 있다.
 */
export default function ExaminationBoard({ examinations: initialExaminations }: ExaminationBoardProps) {
  const now = useSeoulNow();
  // TODO(api): 결과 등록 API 연동 후에는 등록 성공 시 서버 데이터를 다시 불러오는 방식으로 바꾼다
  const [examinations, setExaminations] = useState(initialExaminations);
  const [draft, setDraft] = useState<ExaminationSearchCriteria>(EMPTY_EXAMINATION_CRITERIA);
  const [applied, setApplied] = useState<ExaminationSearchCriteria>(EMPTY_EXAMINATION_CRITERIA);
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);

  const results = useMemo(() => sortExaminations(filterExaminations(examinations, applied)), [examinations, applied]);
  const summary = useMemo(() => summarizeExaminations(examinations), [examinations]);
  const target = modal ? (examinations.find(({ id }) => id === modal.id) ?? null) : null;

  const applySearch = (criteria: ExaminationSearchCriteria): boolean => {
    const error = validateExaminationCriteria(criteria);
    setCriteriaError(error);
    if (error) return false;
    setApplied(criteria);
    return true;
  };

  const resetSearch = () => {
    setDraft(EMPTY_EXAMINATION_CRITERIA);
    applySearch(EMPTY_EXAMINATION_CRITERIA);
  };

  /** 모달을 닫은 뒤 포커스를 돌려줄 행 (닫기 직전 목록에서의 위치 포함) */
  const focusReturnRef = useRef<{ id: string; index: number } | null>(null);
  const listTitleRef = useRef<HTMLHeadingElement>(null);

  /** 모달을 닫는다. 포커스 복귀 위치는 목록이 갱신된 뒤 아래 effect에서 정한다 */
  const closeModal = () => {
    focusReturnRef.current = target ? { id: target.id, index: results.findIndex(({ id }) => id === target.id) } : null;
    setModal(null);
  };

  /**
   * 모달이 닫히고(자식 Modal의 effect가 먼저 실행된다) 목록이 갱신된 다음 포커스를 옮긴다.
   * 1) 그 행이 남아 있으면 그 행의 [상세]
   * 2) 필터 때문에 빠졌으면 같은 위치에 오게 된 다음 행의 [상세] (마지막 행이었으면 새 마지막 행)
   * 3) 남은 행이 없으면 목록 제목
   */
  useEffect(() => {
    if (modal !== null || !focusReturnRef.current) return;
    const { id, index } = focusReturnRef.current;
    focusReturnRef.current = null;

    const focusTarget =
      results.find((examination) => examination.id === id) ??
      (results.length > 0 ? results[Math.min(Math.max(index, 0), results.length - 1)] : null);
    const button = focusTarget
      ? listRef.current?.querySelector<HTMLButtonElement>(`[aria-label="${focusTarget.referralNumber} 상세 보기"]`)
      : null;
    (button ?? listTitleRef.current)?.focus();
  }, [modal, results]);

  const handleRegistered = (examination: Examination, result: ExamResult) => {
    setExaminations((prev) => prev.map((item) => (item.id === examination.id ? { ...item, result } : item)));
    setSuccessMessage(`${examination.referralNumber} 검사 결과를 등록했습니다.`);
    closeModal();
  };

  /** 진행 상태 변경은 상세 모달을 닫지 않는다 (완료 후 바로 결과 등록으로 이어갈 수 있게) */
  const handleProgressChanged = (examination: Examination, progressStatus: NextProgressStatus) => {
    setExaminations((prev) => prev.map((item) => (item.id === examination.id ? { ...item, progressStatus } : item)));
    setSuccessMessage(
      `${examination.referralNumber} 검사를 ${progressStatus === "IN_PROGRESS" ? "시작" : "완료 처리"}했습니다.`,
    );
  };

  const emptyMessage =
    examinations.length === 0 ? "우리 기관에 배정된 검사가 없습니다." : "검색 조건에 맞는 검사가 없습니다.";

  return (
    <div className="flex flex-col gap-5">
      <ExaminationSummary counts={summary} />

      <section
        ref={listRef}
        aria-labelledby="examination-list-title"
        className="min-w-0 rounded-xl border border-line bg-white px-4 pb-5 pt-5 sm:px-6"
      >
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {/* 남은 행이 없을 때 포커스를 받을 수 있게 tabIndex -1 (Tab 순서에는 넣지 않는다) */}
          <h2
            id="examination-list-title"
            ref={listTitleRef}
            tabIndex={-1}
            className="rounded text-lg font-bold text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            검사 목록
            <span className="ml-2 text-base font-semibold tabular-nums text-primary">{results.length}건</span>
          </h2>
          <p className="text-xs text-gray-500">정렬: 결과 미등록 먼저 → 검사 예정 일시 최근 순</p>
        </div>

        <div className="mb-4 flex flex-col gap-3">
          <ExaminationFilter
            draft={draft}
            onDraftChange={setDraft}
            onSearch={() => applySearch(draft)}
            onReset={hasExaminationCriteria(applied) || hasExaminationCriteria(draft) ? resetSearch : undefined}
            today={now?.dateKey ?? null}
            error={criteriaError}
          />

          {successMessage && (
            <div
              role="status"
              className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] text-emerald-800"
            >
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <span>
                  {successMessage}
                  <span className="ml-1 text-sm text-emerald-700">
                    (개발용 예시: 이 화면에만 반영되며 서버 저장·의뢰기관 전달은 되지 않습니다. 새로고침하면 초기화됩니다.)
                  </span>
                </span>
              </p>
              <button
                type="button"
                onClick={() => setSuccessMessage(null)}
                aria-label="안내 닫기"
                className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <ExaminationTable
          rows={results}
          selectedId={target?.id ?? null}
          onOpenDetail={(examination) => setModal({ type: "detail", id: examination.id })}
          onOpenRegister={(examination) => setModal({ type: "register", id: examination.id })}
          emptyMessage={emptyMessage}
          onResetFilters={examinations.length > 0 ? resetSearch : undefined}
        />
      </section>

      <Modal
        open={modal?.type === "detail" && target !== null}
        size="lg"
        title={target ? `검사 ${target.referralNumber}` : "검사 상세"}
        titleAddon={target ? <ProgressStatusBadge status={target.progressStatus} /> : undefined}
        onClose={closeModal}
      >
        {modal?.type === "detail" && target && (
          <ExaminationDetail
            // 다른 검사를 열면 처리 중·오류 상태를 새로 시작한다
            key={target.id}
            examination={target}
            onRegister={() => setModal({ type: "register", id: target.id })}
            onProgressChanged={(status) => handleProgressChanged(target, status)}
          />
        )}
      </Modal>

      <Modal
        open={modal?.type === "register" && target !== null}
        title="검사 결과 등록"
        description={target ? `${target.referralNumber} 검사의 결과 상태와 텍스트를 입력합니다.` : undefined}
        closeOnBackdrop={false}
        onClose={closeModal}
      >
        {modal?.type === "register" && target && (
          <ResultRegisterForm
            examination={target}
            onCancel={closeModal}
            onRegistered={(result) => handleRegistered(target, result)}
          />
        )}
      </Modal>
    </div>
  );
}
