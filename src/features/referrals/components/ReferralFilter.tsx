
"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import DatePicker from "@/components/ui/DatePicker";
import { controlClass, filterPanelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { REFERRAL_STATUS_LABELS } from "./ReferralStatusBadge";
import type { ReferralDisplayStatus } from "../types";
import type { ReferralFilterCriteria } from "../filter";
import type { DateKey } from "@/lib/date/seoulDate";

interface ReferralFilterProps {
  draft: ReferralFilterCriteria;
  onChange: (criteria: ReferralFilterCriteria) => void;
  onSearch: () => void;
  onReset: () => void;
  organizations: readonly string[];
}



const statusOptions = Object.entries(
  REFERRAL_STATUS_LABELS
) as [ReferralDisplayStatus, string][];

export default function ReferralFilter({
  draft,
  onChange,
  onSearch,
  onReset,
  organizations,
}: ReferralFilterProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const update = (patch: Partial<ReferralFilterCriteria>) => {
    onChange({ ...draft, ...patch });
  };

  const dateError =
    draft.dateFrom &&
    draft.dateTo &&
    draft.dateFrom > draft.dateTo
      ? "시작일은 종료일보다 늦을 수 없습니다."
      : null;

  const handleSearch = () => {
    if (dateError) return;
    onSearch();
  };

  const handleKeywordKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ) => {
    if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSearch();
    }
  };

  const advancedCount =
    Number(Boolean(draft.organizationName)) +
    Number(Boolean(draft.dateFrom || draft.dateTo));

  return (
    <div
      role="search"
      aria-label="의뢰·예약 검색 조건"
      className={filterPanelClass}
    >
      {/* 기본 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[190px] flex-[2_1_230px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={draft.keyword}
            onChange={(event) =>
              update({ keyword: event.target.value })
            }
            onKeyDown={handleKeywordKeyDown}
            placeholder="의뢰번호·환자 ID 검색"
            aria-label="의뢰번호 또는 가상 환자 ID 검색"
            className={`${controlClass} pl-9`}
          />
        </div>

        <select
          aria-label="예약 상태"
          value={draft.status}
          onChange={(event) =>
            update({
              status: event.target.value as
                | ReferralDisplayStatus
                | "",
            })
          }
          className={`${controlClass} min-w-[125px] flex-[1_1_125px]`}
        >
          <option value="">전체 상태</option>
          {statusOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="검사 유형"
          value={draft.examType}
          onChange={(event) =>
            update({
              examType: event.target.value as
                ReferralFilterCriteria["examType"],
            })
          }
          className={`${controlClass} min-w-[110px] flex-[1_1_110px]`}
        >
          <option value="">전체 유형</option>
          <option value="CT">CT</option>
          <option value="MRI">MRI</option>
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setIsDetailOpen((prev) => !prev)}
            aria-expanded={isDetailOpen}
            aria-controls="referral-detail-filters"
            className={`inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm font-medium hover:bg-gray-50 ${
              advancedCount > 0 || isDetailOpen
                ? "border-primary text-primary"
                : "border-line text-gray-700"
            }`}
          >
            <SlidersHorizontal
              className="size-4"
              aria-hidden="true"
            />
            상세 필터
            {advancedCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-white">
                {advancedCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleSearch}
            className={primaryButtonClass}
          >
            <Search className="size-4" aria-hidden="true" />
            검색
          </button>

          <button
            type="button"
            onClick={onReset}
            className={secondaryButtonClass}
          >
            <RotateCcw
              className="size-4"
              aria-hidden="true"
            />
            초기화
          </button>
        </div>
      </div>

      {/* 상세 필터 */}
      {isDetailOpen && (
        <div
          id="referral-detail-filters"
          className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="referral-organization"
              className="text-sm font-medium text-gray-700"
            >
              검사기관
            </label>
            <select
              id="referral-organization"
              value={draft.organizationName}
              onChange={(event) =>
                update({
                  organizationName: event.target.value,
                })
              }
              className={controlClass}
            >
              <option value="">전체 검사기관</option>
              {organizations.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <DatePicker
            id="referral-date-from"
            label="검사 시작일"
            value={draft.dateFrom as DateKey | ""}
            onChange={(value) =>
              update({ dateFrom: value })
            }
            placeholder="시작일 선택"
          />

          <DatePicker
            id="referral-date-to"
            label="검사 종료일"
            value={draft.dateTo as DateKey | ""}
            onChange={(value) =>
              update({ dateTo: value })
            }
            placeholder="종료일 선택"
          />

          {dateError && (
            <p
              role="alert"
              className="text-sm text-red-600 sm:col-span-2 xl:col-span-3"
            >
              {dateError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
