/**
 * 공통 스타일 클래스 (표·검색 패널·버튼·입력·빈 상태). 컴포넌트를 새로 만들지 않고 클래스만 공유한다.
 * 의뢰기관·검사기관·관리자 화면의 비슷한 요소는 이 값을 함께 써서 모양을 맞춘다.
 */

// ── 표 ──
export const tableWrapClass = "overflow-x-auto rounded-xl border border-line bg-white shadow-card";
export const tableClass = "w-full border-collapse";
export const theadClass = "bg-gray-50";
export const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
export const tdClass = "px-4 py-3.5 text-sm text-gray-700";
export const rowClass = "border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70";
export const rowSelectedClass = "border-t border-line first:border-t-0 bg-primary-soft/60";

// ── 검색·필터 패널 ──
export const filterPanelClass = "flex flex-col gap-3 rounded-xl border border-line bg-gray-50/70 p-4";
export const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

// ── 버튼 ──
export const primaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
/** 표의 '상세' 버튼·링크 (Mock·API·관리자 공통) */
export const detailButtonClass =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-primary/40 bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft";

// ── 빈 상태·건수 ──
export const emptyStateClass = "rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] text-gray-500";

// ── 라벨형 검색 카드 (기준: 의뢰기관 검사 슬롯 검색 SlotSearchFilter) ──
/** 흰 카드 + 라벨 붙은 입력(FormControls·DatePicker, 높이 48px) 그리드 + 오른쪽 아래 버튼 */
export const searchCardClass = "flex flex-col gap-5 rounded-xl border border-line bg-white px-5 py-5 sm:px-8 sm:py-6";
export const searchGridClass = "grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4";
export const searchButtonClass =
  "inline-flex h-11 min-w-[112px] items-center justify-center gap-2 rounded-lg bg-primary px-6 text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";
export const resetButtonClass =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50";
