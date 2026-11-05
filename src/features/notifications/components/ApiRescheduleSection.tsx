import { cache } from "react";

import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import { examTypeLabel, ReferralFailureNotice } from "@/features/referrals/components/ReferralApiSection";
import { DetailValue, toBadgeStatus } from "@/features/referrals/components/ReferralApiTable";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { loadExamTypes, loadReferralTablePage } from "@/features/referrals/server";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import NotificationPagination from "./NotificationPagination";
import RescheduleAlert from "./RescheduleAlert";

/** 재조정 목록 페이지 쿼리 (오른쪽 알림 내역의 `?page=`와 겹치지 않게 따로 둔다, 1부터) */
export const RESCHEDULE_PAGE_PARAM = "reschedulePage";

type SearchParams = Record<string, string | string[] | undefined>;

/** `?reschedulePage=`(1부터) → 0부터. 없거나 올바르지 않으면 첫 페이지 */
function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^[1-9]\d*$/.test(value)) return 0;
  const page = Number(value) - 1;
  return Number.isSafeInteger(page) ? page : 0;
}

/**
 * 재조정 필요 의뢰 한 페이지 (요청 1회당 한 번만: 안내 배너와 표가 같은 결과를 쓴다).
 * - 의뢰 목록 `GET /api/v1/referrals?status=NEEDS_RESCHEDULE&page&size=10&sort=updatedAt,desc` (의뢰기관 역할 확인 후, 범위는 백엔드가 기관으로 정한다)
 * - 기존 예약 일시·검사기관: 현재 페이지 의뢰의 예약 단건(중복 제외·동시 5건) + 내 기관 협약 목록 1회 (의뢰 목록 표와 같은 로더)
 * - 검사 유형 이름: 검사 유형 목록 1회
 */
const loadReschedule = cache(async (page: number) => {
  const [result, examTypes] = await Promise.all([
    loadReferralTablePage({ page, status: "NEEDS_RESCHEDULE", sort: "updatedAt,desc", subject: "재조정 필요 목록" }),
    loadExamTypes(),
  ]);
  return { result, examTypes };
});

/** 상단 재조정 안내 배너 (Mock과 같은 RescheduleAlert). 원인(장애 장비)은 API에 없어 표시하지 않는다 */
export async function ApiRescheduleAlert({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { result } = await loadReschedule(parsePage((await searchParams)[RESCHEDULE_PAGE_PARAM]));
  if (!result.ok) return null;
  return <RescheduleAlert count={result.totalElements} failureExamTypes={null} isMockData={false} />;
}

const thClass = "whitespace-nowrap border-b border-line px-3 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-3 py-3.5 text-sm text-gray-700";

/**
 * 예약 재조정 필요 목록 (API 모드). 모양·열은 Mock RescheduleTable과 같다:
 * 예약번호(현재 예약 ID 축약·복사, 예약 전이면 —) | 검사기관 | 검사유형 | 기존 예약일시 | 상태 | 작업.
 * - 건수·페이지는 백엔드 응답 기준. 0건이면 "재조정이 필요한 예약이 없습니다."
 * - [새 슬롯 검색]은 비활성: 슬롯 목록 조회 API와 재예약(POST /referrals/{id}/reschedule) 연결 전이라 잘못된 예약이 생기지 않게 막는다
 * - 환자명은 이 표에 보이지 않는다 (Mock 표에도 없다)
 */
export default async function ApiRescheduleSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { result, examTypes } = await loadReschedule(parsePage(params[RESCHEDULE_PAGE_PARAM]));
  if (!result.ok) return <ReferralFailureNotice failure={result} subject="재조정 필요 목록" />;
  const typeById = new Map((examTypes.ok ? examTypes.examTypes : []).map((type) => [type.id.toLowerCase(), type]));
  // 오른쪽 알림 내역의 페이지는 그대로 둔다
  const keep: Record<string, string> = typeof params.page === "string" && params.page ? { page: params.page } : {};

  return (
    <section aria-labelledby="reschedule-title" className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6">
      <h2 id="reschedule-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
        예약 재조정 필요
        <span className="ml-2 text-base font-semibold tabular-nums text-primary">{result.totalElements}건</span>
      </h2>
      <p className="mb-5 mt-2 text-[15px] text-gray-600">
        {result.totalElements > 0 && "아래 예약 건은 재조정이 필요합니다."}
        {result.detailIncomplete && <span className="ml-1 text-sm text-amber-700">일부 예약 정보를 불러오지 못해 &lsquo;—&rsquo;로 표시했습니다.</span>}
      </p>

      {result.rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-[15px] text-gray-500">
          {result.page > 0 ? "이 페이지에 재조정이 필요한 예약이 없습니다." : "재조정이 필요한 예약이 없습니다."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
            <table className="w-full min-w-[680px] border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className={thClass}>예약번호</th>
                  <th scope="col" className={thClass}>검사기관</th>
                  <th scope="col" className={thClass}>검사유형</th>
                  <th scope="col" className={thClass}>기존 예약일시</th>
                  <th scope="col" className={`${thClass} text-center!`}>상태</th>
                  <th scope="col" className={`${thClass} text-center!`}>작업</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const type = typeById.get(row.examTypeId.toLowerCase());
                  return (
                    <tr key={row.referralId} className="border-t border-line">
                      <td className={`${tdClass} whitespace-nowrap font-medium`}>
                        {/* 예약번호 = 현재 예약 ID (의뢰 ID는 행 key로만 쓴다) */}
                        {row.reservationId ? (
                          <ReferralIdCopyButton referralId={row.reservationId} label="예약번호" />
                        ) : (
                          <DetailValue cell={{ state: "none" }} />
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <DetailValue cell={row.examInstitution} />
                      </td>
                      <td className={tdClass}>{type ? examTypeLabel(type) : examTypes.ok ? "알 수 없는 유형" : "확인 불가"}</td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <DetailValue cell={row.examStartTime} format={formatDateTimeWithWeekday} />
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <ReferralStatusBadge status={toBadgeStatus(row.referralStatus)} />
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <button
                          type="button"
                          disabled
                          aria-describedby="reschedule-action-unavailable"
                          className="inline-flex h-10 cursor-not-allowed items-center whitespace-nowrap rounded-lg bg-gray-200 px-4 text-[15px] font-semibold text-gray-400"
                        >
                          새 슬롯 검색
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p id="reschedule-action-unavailable" className="mt-3 text-xs text-gray-500">
            대체 슬롯 선택은 슬롯 조회·재예약 기능이 연결되면 사용할 수 있습니다.
          </p>
        </>
      )}
      <NotificationPagination
        page={result.page}
        totalPages={result.totalPages}
        query={keep}
        pageParam={RESCHEDULE_PAGE_PARAM}
        label="재조정 필요 목록 페이지"
      />
    </section>
  );
}
