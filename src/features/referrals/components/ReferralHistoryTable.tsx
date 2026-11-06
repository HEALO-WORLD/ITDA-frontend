
"use client";

import { useMemo, useState } from "react";

import { detailButtonClass, emptyStateClass, rowClass, tableClass, tableWrapClass, tdClass as baseTd, theadClass, thClass as baseTh } from "@/components/ui/styles";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import type { ReferralSummary } from "../types";
import {
  INITIAL_REFERRAL_FILTER,
  filterReferrals,
  type ReferralFilterCriteria,
} from "../filter";

import ReferralDetailDialog from "./ReferralDetailDialog";
import ReferralFilter from "./ReferralFilter";
import ReferralResultButton from "./ReferralResultButton";
import ReferralStatusBadge from "./ReferralStatusBadge";

interface ReferralHistoryTableProps {
  referrals: readonly ReferralSummary[];
}

// 공통 표 모양 (API 의뢰 목록·관리자 표와 같다)
const thClass = baseTh;
const tdClass = baseTd;

/**
 * 의뢰·예약 관리
 *
 * - 통합 검색
 * - 예약 상태 필터
 * - 검사 유형 필터
 * - 검사기관 필터
 * - 검사 기간 필터
 * - 검색 결과 건수 표시
 * - 예약 상세 모달
 *
 * 현재 Mock 데이터는 클라이언트에서 필터링한다.
 * 실제 API 연동 시 필터링·정렬·페이징은 서버에서 처리한다.
 */
export default function ReferralHistoryTable({
  referrals,
}: ReferralHistoryTableProps) {
  // 상세 모달에서 선택한 의뢰
  const [selected, setSelected] =
    useState<ReferralSummary | null>(null);

  // 사용자가 입력 중인 검색 조건
  const [draft, setDraft] =
    useState<ReferralFilterCriteria>({
      ...INITIAL_REFERRAL_FILTER,
    });

  // 실제 목록에 적용된 검색 조건
  const [applied, setApplied] =
    useState<ReferralFilterCriteria>({
      ...INITIAL_REFERRAL_FILTER,
    });

  /**
   * 검사기관 목록
   *
   * 의뢰 데이터에서 검사기관명을 추출하고
   * 중복 제거 후 가나다순으로 정렬한다.
   */
  const organizations = useMemo(
    () =>
      [...new Set(referrals.map((r) => r.organizationName))]
        .sort((a, b) => a.localeCompare(b, "ko")),
    [referrals]
  );

  /**
   * 적용된 검색 조건으로 필터링
   *
   * 검색 버튼을 누르기 전까지는
   * draft가 변경되어도 결과가 바뀌지 않는다.
   */
  const filteredReferrals = useMemo(
    () => filterReferrals(referrals, applied),
    [referrals, applied]
  );

  /**
   * 검색 실행
   */
  const handleSearch = () => {
    // 시작일이 종료일보다 늦으면 검색하지 않는다.
    if (
      draft.dateFrom &&
      draft.dateTo &&
      draft.dateFrom > draft.dateTo
    ) {
      return;
    }

    setApplied({ ...draft });
  };

  /**
   * 검색 조건 초기화
   */
  const handleReset = () => {
    setDraft({ ...INITIAL_REFERRAL_FILTER });
    setApplied({ ...INITIAL_REFERRAL_FILTER });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 검색 필터 */}
      <ReferralFilter
        draft={draft}
        onChange={setDraft}
        onSearch={handleSearch}
        onReset={handleReset}
        organizations={organizations}
      />

      {/* 검색 결과 건수 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          aria-live="polite"
          className="text-[15px] text-gray-600"
        >
          총{" "}
          <span className="font-bold text-primary">
            {filteredReferrals.length}
          </span>
          건의 의뢰·예약
        </p>
      </div>

      {/* 전체 의뢰 데이터가 없는 경우 */}
      {referrals.length === 0 ? (
        <div
          role="status"
          className={emptyStateClass}
        >
          <p>
            등록된 의뢰·예약 내역이 없습니다.
          </p>
        </div>
      ) : filteredReferrals.length === 0 ? (
        /* 필터링 결과가 없는 경우 */
        <div
          role="status"
          className={emptyStateClass}
        >
          <p>
            검색 조건에 맞는 의뢰·예약이 없습니다.
          </p>

          <button
            type="button"
            onClick={handleReset}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft"
          >
            검색 조건 초기화
          </button>
        </div>
      ) : (
        /* 검색 결과 테이블 */
        <div className={tableWrapClass}>
          <table className={`${tableClass} min-w-[820px]`}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  의뢰 번호
                </th>

                <th scope="col" className={thClass}>
                  검사기관
                </th>

                <th scope="col" className={thClass}>
                  검사 유형
                </th>

                <th scope="col" className={thClass}>
                  검사 일시
                </th>

                <th
                  scope="col"
                  className={`${thClass} text-center!`}
                >
                  예약 상태
                </th>

                <th
                  scope="col"
                  className={`${thClass} text-center!`}
                >
                  관리
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredReferrals.map((referral) => (
                <tr
                  key={referral.id}
                  className={rowClass}
                >
                  {/* 의뢰 번호 */}
                  <td
                    className={`${tdClass} whitespace-nowrap`}
                  >
                    {referral.referralNumber}
                  </td>

                  {/* 검사기관 */}
                  <td
                    className={`${tdClass} whitespace-nowrap`}
                  >
                    {referral.organizationName}
                  </td>

                  {/* 검사 유형 */}
                  <td className={tdClass}>
                    {referral.examType}
                  </td>

                  {/* 검사 일시 */}
                  <td
                    className={`${tdClass} whitespace-nowrap`}
                  >
                    {formatDateTimeWithWeekday(
                      referral.scheduledAt
                    )}
                  </td>

                  {/* 예약 상태 */}
                  <td
                    className={`${tdClass} text-center`}
                  >
                    <ReferralStatusBadge
                      status={referral.status}
                    />
                  </td>

                  {/* 예약 상세 */}
                  <td
                    className={`${tdClass} text-center`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(referral)}
                        aria-label={`${referral.referralNumber} 상세`}
                        className={detailButtonClass}
                      >
                        상세
                      </button>
                      {/* Mock 검사결과 (백엔드 요청 없음) */}
                      <ReferralResultButton referralId={referral.id} source="mock" label={referral.referralNumber} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 예약 상세 모달 */}
      <ReferralDetailDialog
        referral={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
