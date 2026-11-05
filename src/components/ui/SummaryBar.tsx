import type { ReactNode } from "react";

export interface SummaryBarItem {
  label: string;
  value: ReactNode;
  /** 숫자 색 (기본 진한 회색). 값을 알 수 없는 안내 문구는 흐린 색을 넘긴다 */
  valueClass?: string;
}

/**
 * 화면 상단 현황 요약 바 (검사·장애·예약 화면 공용 모양: 흰 카드 + 라벨·굵은 숫자를 가로로, 항목 사이 세로 구분선).
 * scope: 집계 범위 안내 배지 (예: 현재 페이지 기준). note: 아래 작은 설명
 */
export default function SummaryBar({ ariaLabel, items, scope, note }: { ariaLabel: string; items: SummaryBarItem[]; scope?: string; note?: string }) {
  return (
    <section aria-label={ariaLabel} className="rounded-xl border border-line bg-white px-6 py-4">
      {scope && <p className="mb-3 inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{scope}</p>}
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {items.map((item, index) => (
          <SummaryRow key={item.label} item={item} divider={index > 0} />
        ))}
      </ul>
      {note && <p className="mt-2 text-xs text-gray-500">{note}</p>}
    </section>
  );
}

function SummaryRow({ item, divider }: { item: SummaryBarItem; divider: boolean }) {
  return (
    <>
      {divider && <li aria-hidden="true" className="hidden h-6 w-px bg-line sm:block" />}
      <li className="flex items-baseline gap-2">
        <span className="text-[15px] text-gray-600">{item.label}</span>
        <span className={`text-xl font-bold tabular-nums ${item.valueClass ?? "text-gray-900"}`}>{item.value}</span>
      </li>
    </>
  );
}
