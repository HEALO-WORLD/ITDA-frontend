import { AlertTriangle, ChevronDown, ChevronUp, Clock, Info, Layers, Plus, Search, Sparkles, X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import type { ExamType } from "@/features/slots/types";

import { formatOperatingHoursSummary } from "../operatingHours";
import { getSupportedExamTypeNames } from "../supportedExamTypes";
import type { Equipment } from "../types";

import EquipmentStatusBadge from "./EquipmentStatusBadge";

export type ExamTypeFilter = "ALL" | ExamType;

/**
 * 장비 목록 한 행 (Mock·API 공용 표시 값). Mock은 toMockPickerRow로, API는 장비 API 응답으로 만든다.
 * - hours: set(운영시간 있음) · unset(미설정 → 설정 필요 버튼) · unavailable(아직 모름 → label, 없으면 '조회 준비 중')
 * - supported: 지원 검사 유형 이름 · 비어 있으면 '미설정' · 문자열이면 그 안내(불러오는 중 등)를 흐리게 보인다
 */
export interface EquipmentPickerRow {
  id: string;
  name: string;
  examType: ExamType;
  statusBadge: ReactNode;
  hours: { kind: "set"; summary: string } | { kind: "unset" } | { kind: "unavailable"; label?: string };
  supported: string[] | null | { placeholder: string };
}

/** Mock 장비 → 행 (기존 Mock 표시 그대로) */
export function toMockPickerRow(equipment: Equipment): EquipmentPickerRow {
  return {
    id: equipment.id,
    name: equipment.name,
    examType: equipment.examType,
    statusBadge: <EquipmentStatusBadge status={equipment.status} />,
    hours: equipment.operatingHours.length > 0 ? { kind: "set", summary: formatOperatingHoursSummary(equipment.operatingHours) } : { kind: "unset" },
    supported: getSupportedExamTypeNames(equipment.supportedExamTypeIds),
  };
}
/** "ALL" = 현재 목록(검색·필터 결과)의 전체 장비 */
export type EquipmentSelection = "ALL" | string;

interface EquipmentPickerProps {
  /** 기관의 전체 장비 수 (등록 장비 없음과 검색 결과 없음 구분용) */
  totalCount: number;
  /** 검색·필터 결과 */
  visibleEquipments: EquipmentPickerRow[];
  query: string;
  onQueryChange: (query: string) => void;
  typeFilter: ExamTypeFilter;
  onTypeFilterChange: (filter: ExamTypeFilter) => void;
  selection: EquipmentSelection;
  onSelect: (selection: EquipmentSelection) => void;
  /** 선택 장비가 검색 결과에서 빠져 전체 보기로 바뀐 경우 안내 */
  selectionNotice: string | null;
  onShowSchedule: (equipment: EquipmentPickerRow) => void;
  /** 운영 시간 설정·수정 폼 바로 열기 */
  onEditHours: (equipment: EquipmentPickerRow) => void;
  onRegister: () => void;
  onGenerateSlots: () => void;
  /** 검색 줄 오른쪽 안내 (기본: Mock 개발용 안내) */
  note?: ReactNode;
}

const TYPE_FILTERS: { value: ExamTypeFilter; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "CT", label: "CT" },
  { value: "MRI", label: "MRI" },
];

/**
 * 접은 상태에서 보여 줄 장비 행 수. 장비가 많아도 달력이 아래로 밀리지 않게 하고,
 * 나머지는 [더 보기]로 펼친다 (검색·유형 필터로 좁힐 수도 있다)
 */
const COLLAPSED_ROW_LIMIT = 5;

const thClass = "whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-3 py-2 text-sm text-gray-700";
const actionClass =
  "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/**
 * 장비 목록 (상단 전체 너비 표).
 * 행(또는 장비명 버튼)을 누르면 장비를 고르고, 선택은 달력·슬롯 목록의 조회 대상이 된다.
 * 장비가 많으면 일부만 보여 주고 [더 보기]로 펼치며, 접혀 있어도 선택한 장비 행은 항상 보인다.
 */
export default function EquipmentPicker({
  totalCount,
  visibleEquipments,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  selection,
  onSelect,
  selectionNotice,
  onShowSchedule,
  onEditHours,
  onRegister,
  onGenerateSlots,
  note = "개발용 예시: 등록·생성 내용은 이 브라우저에만 저장됩니다.",
}: EquipmentPickerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isFiltered = query.trim() !== "" || typeFilter !== "ALL";
  const hiddenCount = Math.max(0, visibleEquipments.length - COLLAPSED_ROW_LIMIT);
  const collapsedRows = visibleEquipments.slice(0, COLLAPSED_ROW_LIMIT);
  // 접혀 있어도 선택한 장비는 보이게 한다 (선택 상태를 화면에서 잃지 않도록)
  const pinnedSelected =
    !isExpanded && selection !== "ALL" && !collapsedRows.some(({ id }) => id === selection)
      ? visibleEquipments.find(({ id }) => id === selection)
      : undefined;
  const rows = isExpanded ? visibleEquipments : pinnedSelected ? [...collapsedRows, pinnedSelected] : collapsedRows;

  /** 관리 버튼 클릭이 행 선택으로 번지지 않게 한다 */
  const stop = (event: MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };

  return (
    <section aria-labelledby="equipment-picker-title" className="@container min-w-0 rounded-xl border border-line bg-white">
      <div className="flex flex-col gap-3 border-b border-line px-4 pb-4 pt-5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="equipment-picker-title" className="text-lg font-bold text-gray-900">
            장비
            <span className="ml-2 text-base font-semibold tabular-nums text-primary">
              {isFiltered ? `${visibleEquipments.length} / ${totalCount}대` : `${totalCount}대`}
            </span>
          </h2>
          {/* TODO(api): 장비 등록·슬롯 생성 API 확정 후 연결한다 */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRegister}
              aria-haspopup="dialog"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Plus className="size-4" aria-hidden="true" />
              장비 등록
            </button>
            <button
              type="button"
              onClick={onGenerateSlots}
              disabled={totalCount === 0}
              aria-haspopup="dialog"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              슬롯 생성
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="장비명 검색"
              aria-label="장비명 검색"
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-9 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div role="group" aria-label="검사 유형 필터" className="flex gap-1 rounded-lg bg-surface-muted p-1">
            {TYPE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={typeFilter === value}
                onClick={() => onTypeFilterChange(value)}
                className={`h-8 min-w-[56px] rounded-md px-3 text-sm font-semibold transition-colors ${
                  typeFilter === value ? "bg-white text-primary shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {note && <p className="text-xs text-gray-400">{note}</p>}
        </div>

        {selectionNotice && (
          <p role="status" className="text-xs text-amber-700">
            {selectionNotice}
          </p>
        )}
      </div>

      {totalCount === 0 ? (
        <p role="status" className="px-4 py-10 text-center text-[15px] text-gray-500">
          등록된 장비가 없습니다. [장비 등록]으로 장비를 추가해 주세요.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            {/*
              고정 열 너비: 유형·상태·관리 버튼은 잘리지 않게, 장비명·운영 시간은 남는 폭에서 말줄임.
              표 영역이 좁으면(컨테이너 기준) 운영시간 → 유형·상태 순으로 열을 빼고 장비명 아래 줄에 보여
              관리 버튼이 가로 스크롤 없이 보이게 한다.
            */}
            <table className="w-full min-w-[400px] table-fixed border-collapse" aria-label="장비 목록">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className={`${thClass} @min-[960px]:w-[30%]`}>장비명</th>
                  <th scope="col" className={`${thClass} hidden w-[88px] @min-[600px]:table-cell`}>검사 유형</th>
                  <th scope="col" className={`${thClass} hidden w-[96px] @min-[600px]:table-cell`}>장비 상태</th>
                  <th scope="col" className={`${thClass} hidden @min-[960px]:table-cell`}>운영시간</th>
                  <th scope="col" className={`${thClass} w-[236px]`}>관리</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  onClick={() => onSelect("ALL")}
                  className={`cursor-pointer border-t border-line ${selection === "ALL" ? "bg-primary-soft" : "hover:bg-gray-50"}`}
                >
                  <FullWidthCells className={tdClass}>
                    <button
                      type="button"
                      aria-pressed={selection === "ALL"}
                      onClick={(e) => stop(e, () => onSelect("ALL"))}
                      className="inline-flex items-center gap-2 rounded font-semibold text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <Layers className="size-4 shrink-0 text-gray-500" aria-hidden="true" />
                      {isFiltered ? "검색 결과 전체" : "전체 장비"}
                      <span className="text-sm font-normal text-gray-500">{visibleEquipments.length}대의 슬롯을 함께 봅니다</span>
                    </button>
                  </FullWidthCells>
                </tr>

                {visibleEquipments.length === 0 ? (
                  <tr className="border-t border-line">
                    <FullWidthCells role="status" className="px-3 py-8 text-center text-sm text-gray-500">
                      검색 조건에 맞는 장비가 없습니다.
                      <button
                        type="button"
                        onClick={() => {
                          onQueryChange("");
                          onTypeFilterChange("ALL");
                        }}
                        className="ml-2 font-medium text-primary hover:underline"
                      >
                        검색 조건 초기화
                      </button>
                    </FullWidthCells>
                  </tr>
                ) : (
                  rows.map((equipment) => {
                    const isSelected = selection === equipment.id;
                    const hasHours = equipment.hours.kind === "set";
                    const hoursSummary =
                      equipment.hours.kind === "set"
                        ? equipment.hours.summary
                        : equipment.hours.kind === "unset"
                          ? "미설정"
                          : (equipment.hours.label ?? "조회 준비 중");
                    const supportedNames = Array.isArray(equipment.supported) && equipment.supported.length > 0 ? equipment.supported : null;
                    const supportedSummary = supportedNames
                      ? supportedNames.join(", ")
                      : equipment.supported && !Array.isArray(equipment.supported)
                        ? equipment.supported.placeholder
                        : "미설정";
                    return (
                      <tr
                        key={equipment.id}
                        onClick={() => onSelect(equipment.id)}
                        className={`cursor-pointer border-t border-line ${isSelected ? "bg-primary-soft" : "hover:bg-gray-50"}`}
                      >
                        <td className={`${tdClass} relative`}>
                          {isSelected && <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />}
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            onClick={(e) => stop(e, () => onSelect(equipment.id))}
                            title={equipment.name}
                            className={`block max-w-full truncate rounded text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                              isSelected ? "text-primary" : "text-gray-900"
                            }`}
                          >
                            {equipment.name}
                          </button>
                          {/* 좁은 표: 빠진 열(유형·상태·운영시간)을 장비명 아래에 보인다 */}
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm @min-[960px]:hidden">
                            <span className="contents @min-[600px]:hidden">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
                                {equipment.examType}
                              </span>
                              {equipment.statusBadge}
                            </span>
                            <span
                              className={`min-w-0 max-w-full truncate ${hasHours ? "text-gray-600" : "text-gray-400"}`}
                              title={hoursSummary}
                            >
                              {equipment.hours.kind === "unset" ? "운영시간 미설정" : equipment.hours.kind === "unavailable" ? `운영시간 ${hoursSummary}` : hoursSummary}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-gray-500" title={supportedSummary}>
                            지원 검사: <span className={supportedNames ? "text-gray-700" : "text-gray-400"}>{supportedSummary}</span>
                          </p>
                        </td>
                        <td className={`${tdClass} hidden @min-[600px]:table-cell`}>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
                            {equipment.examType}
                          </span>
                        </td>
                        <td className={`${tdClass} hidden @min-[600px]:table-cell`}>
                          {equipment.statusBadge}
                        </td>
                        <td
                          className={`${tdClass} hidden truncate text-sm @min-[960px]:table-cell ${hasHours ? "text-gray-700" : "text-gray-400"}`}
                          title={hoursSummary}
                        >
                          {hoursSummary}
                        </td>
                        <td className={tdClass}>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => stop(e, () => onShowSchedule(equipment))}
                              aria-label={`${equipment.name} 상세 보기`}
                              aria-haspopup="dialog"
                              className={`${actionClass} border-line bg-white text-gray-600 hover:bg-gray-50`}
                            >
                              <Info className="size-3.5" aria-hidden="true" />
                              상세
                            </button>
                            {equipment.hours.kind !== "unset" ? (
                              <button
                                type="button"
                                onClick={(e) => stop(e, () => onEditHours(equipment))}
                                aria-label={`${equipment.name} 운영시간 수정`}
                                aria-haspopup="dialog"
                                className={`${actionClass} border-line bg-white text-gray-600 hover:bg-gray-50`}
                              >
                                <Clock className="size-3.5" aria-hidden="true" />
                                운영시간 수정
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => stop(e, () => onEditHours(equipment))}
                                aria-label={`${equipment.name} 운영시간 설정 필요`}
                                aria-haspopup="dialog"
                                className={`${actionClass} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}
                              >
                                <AlertTriangle className="size-3.5" aria-hidden="true" />
                                운영시간 설정 필요
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {hiddenCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm sm:px-5">
              <p className="text-gray-500">
                {isExpanded
                  ? `${visibleEquipments.length}대 모두 표시 중`
                  : `${COLLAPSED_ROW_LIMIT}대 표시 중 · ${hiddenCount}대 더 있음${pinnedSelected ? " (선택한 장비는 아래에 함께 표시)" : ""}`}
              </p>
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                aria-expanded={isExpanded}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-semibold text-primary hover:bg-primary-soft"
              >
                {isExpanded ? (
                  <>
                    접기 <ChevronUp className="size-4" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    더 보기 ({hiddenCount}대) <ChevronDown className="size-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 표 전체 너비 칸. 보이는 열 수(2·4·5열)가 표 영역 폭에 따라 달라지고, 열 수보다 큰 colSpan은
 * 빈 열을 만들어 다른 열을 좁히므로 열 수별 칸을 하나씩 두고 그때 맞는 칸만 보인다 (숨긴 칸은 보조기기에도 읽히지 않는다)
 */
function FullWidthCells({ className, role, children }: { className: string; role?: string; children: ReactNode }) {
  return (
    <>
      <td colSpan={2} role={role} className={`${className} @min-[600px]:hidden`}>
        {children}
      </td>
      <td colSpan={4} role={role} className={`${className} hidden @min-[600px]:table-cell @min-[960px]:hidden`}>
        {children}
      </td>
      <td colSpan={5} role={role} className={`${className} hidden @min-[960px]:table-cell`}>
        {children}
      </td>
    </>
  );
}
