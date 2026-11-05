import Link from "next/link";

import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { emptyStateClass, rowClass, tableClass, tableWrapClass, tdClass as baseTd, theadClass, thClass as baseTh } from "@/components/ui/styles";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { toReferralDisplayStatus, type ReferralStatusDto } from "../remote";
import type { DetailCell } from "../server";

import ReferralApiDetailButton from "./ReferralApiDetailButton";
import ReferralIdCopyButton from "./ReferralIdCopyButton";
import ReferralStatusBadge from "./ReferralStatusBadge";

/** 표 1행 (화면용). 예약 ID·기관 ID·작성자 ID는 담지 않는다 */
export interface ReferralApiRow {
  referralId: string;
  /** 목록 응답 patientName 그대로 (마스킹하지 않는다) */
  patientName: string;
  referralStatus: ReferralStatusDto;
  /** 검사 유형 API로 바꾼 문구 */
  examTypeLabel: string;
  examInstitution: DetailCell;
  examStartTime: DetailCell;
}

interface ReferralApiTableProps {
  rows: ReferralApiRow[];
  /** 0부터 (백엔드 number) */
  page: number;
  totalPages: number;
  totalElements: number;
  /** 검색·필터가 하나라도 적용됐는지 (빈 결과 문구) */
  filtered: boolean;
  /** 페이지 이동 때 유지할 조건 (주소 쿼리 그대로) */
  query: Record<string, string>;
  /** 부가 정보(예약·검사기관) 일부를 조회하지 못함 */
  detailIncomplete: boolean;
}

/** 백엔드 상태 → 배지 상태. FAILED는 화면 표시 상태가 없어 예약 실패 배지로 보여 준다 */
export const toBadgeStatus = (status: ReferralStatusDto) => toReferralDisplayStatus(status) ?? "FAILED";

// 공통 표 모양 (Mock 의뢰·예약 목록·관리자 표와 같다)
const thClass = baseTh;
const tdClass = baseTd;

/** 값이 없는 셀: "—"만 보이고, 원인(예약 전·정보 없음·조회 실패)은 스크린리더와 툴팁으로 구분한다 */
const EMPTY_REASON: Record<Exclude<DetailCell["state"], "ok">, string> = {
  none: "예약 정보 없음",
  missing: "예약·기관 정보를 찾을 수 없음",
  error: "정보를 불러오지 못함",
};

export function DetailValue({ cell, format = (value) => value }: { cell: DetailCell; format?: (value: string) => string }) {
  if (cell.state === "ok") return <>{format(cell.value)}</>;
  return (
    <span title={EMPTY_REASON[cell.state]} className="text-gray-400">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{EMPTY_REASON[cell.state]}</span>
    </span>
  );
}

/**
 * 의뢰·예약 목록 표 (API 모드). 모양은 Mock 와이어프레임과 같고, API 모드에만 환자명 열을 더했다:
 * 의뢰 번호(의뢰 ID 축약·전체 복사) | 환자명 | 검사기관 | 검사 유형 | 검사 일시 | 예약 상태 | 관리.
 * - 검사기관·검사 일시: 현재 예약(currentReservationId)의 검사기관 이름·슬롯 시작 시각. 없으면 "—"
 * - 관리(상세): 누르면 그 의뢰 한 건만 조회해 상세 대화상자를 연다 (ReferralApiDetailButton). Mock 상세 모달은 쓰지 않는다
 * 건수·페이지는 백엔드 응답(totalElements·totalPages·number) 기준이다.
 */
export default function ReferralApiTable({ rows, page, totalPages, totalElements, filtered, query, detailIncomplete }: ReferralApiTableProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
          총 <span className="font-bold text-primary">{totalElements}</span>건의 의뢰·예약
          {totalPages > 0 && (
            <span className="text-gray-500">
              {" "}
              · {page + 1}/{totalPages}페이지
            </span>
          )}
        </p>
      </div>

      {detailIncomplete && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          일부 예약 정보(검사기관·검사 일시)를 불러오지 못해 &quot;—&quot;로 표시했습니다. 잠시 후 다시 조회해 주세요.
        </p>
      )}

      {rows.length === 0 ? (
        <div role="status" className={emptyStateClass}>
          <p>
            {page > 0
              ? "이 페이지에 의뢰·예약이 없습니다."
              : filtered
                ? "검색 조건에 맞는 의뢰·예약이 없습니다."
                : "등록된 의뢰·예약 내역이 없습니다."}
          </p>
          {filtered && (
            <Link
              href={ROUTES.referring.referrals}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft"
            >
              검색 조건 초기화
            </Link>
          )}
        </div>
      ) : (
        <div className={tableWrapClass}>
          {/* Mock 6개 열(min-w 820px)에 환자명 열만큼 최소 너비를 늘린다. 좁은 화면은 Mock처럼 가로 스크롤 */}
          <table className={`${tableClass} min-w-[940px]`}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  의뢰 번호
                </th>
                <th scope="col" className={thClass}>
                  환자명
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
                <th scope="col" className={`${thClass} text-center!`}>
                  예약 상태
                </th>
                <th scope="col" className={`${thClass} text-center!`}>
                  관리
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.referralId} className={rowClass}>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    <ReferralIdCopyButton referralId={row.referralId} />
                  </td>
                  <td className={`${tdClass} whitespace-nowrap font-semibold text-gray-900`}>{row.patientName}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    <DetailValue cell={row.examInstitution} />
                  </td>
                  <td className={tdClass}>{row.examTypeLabel}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    <DetailValue cell={row.examStartTime} format={formatDateTimeWithWeekday} />
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <ReferralStatusBadge status={toBadgeStatus(row.referralStatus)} />
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <ReferralApiDetailButton
                      referralId={row.referralId}
                      examTypeLabel={row.examTypeLabel}
                      badgeStatus={toBadgeStatus(row.referralStatus)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NotificationPagination page={page} totalPages={totalPages} query={query} label="의뢰 목록 페이지" />
    </div>
  );
}
