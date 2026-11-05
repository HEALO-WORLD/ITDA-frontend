import type { ExaminationSummaryCounts } from "../types";

/**
 * 검사 현황 요약 바 (집계 기준은 query.ts의 summarizeExaminations, 검색 조건과 무관).
 * 검사 진행 상태(대기·진행 중·완료)와 결과 등록 상태(미등록)는 따로 센다.
 * scope: 집계 범위 안내 (API 모드는 전체 건수 API가 없어 현재 페이지만 센다). 없으면 Mock 화면 그대로
 */
export default function ExaminationSummary({ counts, scope }: { counts: ExaminationSummaryCounts; scope?: string }) {
  return (
    <section aria-label="검사 현황 요약" className="rounded-xl border border-line bg-white px-6 py-4">
      {scope && (
        <p className="mb-3 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{scope}</p>
      )}
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <SummaryItem label="검사 대기" value={counts.waiting} valueClass="text-gray-900" />
        <SummaryItem label="검사 진행 중" value={counts.inProgress} valueClass="text-primary" />
        <SummaryItem label="검사 완료" value={counts.completed} valueClass="text-emerald-700" />
        <li aria-hidden="true" className="hidden h-6 w-px bg-line sm:block" />
        <SummaryItem
          label="결과 미등록"
          value={counts.resultPending}
          valueClass={counts.resultPending > 0 ? "text-amber-700" : "text-gray-900"}
        />
      </ul>
      <p className="mt-2 text-xs text-gray-500">결과 미등록은 검사가 완료되었지만 결과가 아직 등록되지 않은 건입니다.</p>
    </section>
  );
}

function SummaryItem({ label, value, valueClass }: { label: string; value: number; valueClass: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="text-[15px] text-gray-600">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${valueClass}`} aria-live="polite">
        {value}건
      </span>
    </li>
  );
}
