import { cache, type ReactNode } from "react";

import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import { examTypeLabel, ReferralFailureNotice } from "@/features/referrals/components/ReferralApiSection";
import { DetailValue, toBadgeStatus } from "@/features/referrals/components/ReferralApiTable";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { abbreviateReferralId } from "@/features/referrals/referralId";
import type { DetailCell } from "@/features/referrals/server";
import { loadExamTypes, loadReferralTablePage } from "@/features/referrals/server";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import NotificationPagination from "./NotificationPagination";
import RescheduleAlert from "./RescheduleAlert";
import { RescheduleSearchButton, RescheduleSearchProvider } from "./RescheduleSearchDialog";

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-800">{children}</dd>
    </div>
  );
}

/** 대화상자 요약용 문자열 (값이 없으면 표와 같은 표시) */
function cellText(cell: DetailCell): string {
  return cell.state === "ok" ? cell.value : cell.state === "none" ? "—" : "확인 불가";
}

/**
 * 예약 재조정 필요 목록 (API 모드). 전체 너비 카드 목록 (가로 스크롤 없음, 좁은 화면은 세로 배치):
 * 예약번호(현재 예약 ID 축약·복사, 예약 전이면 —) · 검사기관 · 검사유형 · 기존 예약일시 · 상태 | [새 슬롯 검색].
 * - 건수·페이지는 백엔드 응답 기준. 0건이면 "재조정이 필요한 예약이 없습니다."
 * - [새 슬롯 검색]: 페이지를 옮기지 않고 대체 슬롯 검색 대화상자를 연다 (의뢰 ID 기준, RescheduleSearchDialog)
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
    <RescheduleSearchProvider>
    <section aria-labelledby="reschedule-title" className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6">
      <h2 id="reschedule-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
        예약 재조정 필요
        <span className="ml-2 text-base font-semibold tabular-nums text-primary">{result.totalElements}건</span>
      </h2>
      {/* 건수·의미는 위 배너와 제목에 있으므로 반복 문장은 두지 않는다 */}
      <p className="mb-4 mt-1 text-sm text-gray-500">기존 예약일시를 확인하고 [새 슬롯 검색]으로 대체 슬롯을 선택해 주세요.</p>
      {result.detailIncomplete && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          일부 예약 정보를 불러오지 못해 &lsquo;—&rsquo;로 표시했습니다.
        </p>
      )}

      {result.rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-[15px] text-gray-500">
          {result.page > 0 ? "이 페이지에 재조정이 필요한 예약이 없습니다." : "재조정이 필요한 예약이 없습니다."}
        </p>
      ) : (
        <ul aria-label="예약 재조정 필요 목록" className="flex flex-col gap-3">
          {result.rows.map((row) => {
            const type = typeById.get(row.examTypeId.toLowerCase());
            const typeText = type ? examTypeLabel(type) : examTypes.ok ? "알 수 없는 유형" : "확인 불가";
            const summary = {
              reservationNumber: row.reservationId,
              copyable: true,
              institution: cellText(row.examInstitution),
              modality: type?.modality ?? null,
              examTypeName: type?.name ?? null,
              scheduledAt: row.examStartTime.state === "ok" ? row.examStartTime.value.slice(0, 16) : null,
            };
            return (
              // 카드: 왼쪽 빨간 선(재조정 필요) · 기존 예약일시를 가장 크게 · 나머지 정보는 한 줄 보조 정보 · 오른쪽 주 동작 [새 슬롯 검색]
              <li
                key={row.referralId}
                className="flex flex-col gap-4 rounded-xl border border-line border-l-4 border-l-red-400 bg-white px-5 py-4 shadow-card md:flex-row md:items-center md:justify-between md:gap-6"
              >
                <dl className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <dt className="sr-only">기존 예약일시</dt>
                    <dd className="text-lg font-bold tabular-nums text-gray-900">
                      <DetailValue cell={row.examStartTime} format={formatDateTimeWithWeekday} />
                    </dd>
                    <dt className="sr-only">상태</dt>
                    <dd>
                      <ReferralStatusBadge status={toBadgeStatus(row.referralStatus)} />
                    </dd>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                    <Field label="검사기관">
                      <DetailValue cell={row.examInstitution} />
                    </Field>
                    <Field label="검사유형">{typeText}</Field>
                    <Field label="예약번호">
                      {/* 예약번호 = 현재 예약 ID (축약·복사). 의뢰 ID는 행 key와 대화상자에만 쓴다 */}
                      {row.reservationId ? <ReferralIdCopyButton referralId={row.reservationId} label="예약번호" /> : <DetailValue cell={{ state: "none" }} />}
                    </Field>
                  </div>
                </dl>
                <RescheduleSearchButton
                  entry={{ kind: "api", referralId: row.referralId, summary }}
                  label={`예약번호 ${row.reservationId ? abbreviateReferralId(row.reservationId) : "없음"} 새 슬롯 검색`}
                />
              </li>
            );
          })}
        </ul>
      )}
      <NotificationPagination
        page={result.page}
        totalPages={result.totalPages}
        query={keep}
        pageParam={RESCHEDULE_PAGE_PARAM}
        label="재조정 필요 목록 페이지"
      />
    </section>
    </RescheduleSearchProvider>
  );
}
