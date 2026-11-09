import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Info, Search } from "lucide-react";
import Link from "next/link";

import { tdClass, thClass } from "@/components/ui/styles";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";

import type { ExaminationLookups } from "../lookups";
import type { ExaminationProgressItem } from "../remote";
import type { ExaminationSummaryCounts, ResultRegistrationStatus } from "../types";

import ExaminationApiActions from "./ExaminationApiActions";
import ExaminationApiDetailButton from "./ExaminationApiDetailButton";
import { ProgressStatusBadge, ResultRegistrationBadge } from "./ExaminationBadges";
import ExaminationSummary from "./ExaminationSummary";

interface ExaminationApiBoardProps {
  examinations: ExaminationProgressItem[];
  totalElements: number;
  /** 현재 페이지 (0부터, 백엔드 PagedResponse.number) */
  page: number;
  totalPages: number;
  /** 검사 유형·장비 이름 (서버에서 목록 API 1회씩) */
  lookups: ExaminationLookups;
}

/** 결과 상태는 백엔드 resultRegistered와 진행 상태로만 정한다 (따로 저장·전송하지 않는다) */
export function toResultStatus(exam: Pick<ExaminationProgressItem, "progressStatus" | "resultRegistered">): ResultRegistrationStatus {
  if (exam.resultRegistered) return "REGISTERED";
  return exam.progressStatus === "COMPLETED" ? "PENDING" : "BEFORE_EXAM";
}

/** `2026-11-05 10:00 ~ 10:30` (LocalDateTime 문자열을 그대로 자른다: 시간대 변환 없음) */
export function formatExamSchedule(exam: Pick<ExaminationProgressItem, "examDate" | "startTime" | "endTime">): string {
  return `${exam.examDate.slice(0, 10)} ${exam.startTime.slice(11, 16)} ~ ${exam.endTime.slice(11, 16)}`;
}

/**
 * 검사 진행·결과 (API 모드). 기준: Mock 화면(ExaminationBoard)·와이어프레임 — 요약 카드 → 흰 카드(제목·건수·검색·표·페이지).
 * - 요약은 전체 건수 API가 없어 현재 페이지만 센다 ('현재 페이지 기준'으로 표시)
 * - 검색 조건은 백엔드 목록 API가 page·size만 받아 쓸 수 없다: 모양만 두고 비활성 + 이유 안내 (현재 페이지만 거르지 않는다)
 * - 가상 환자 ID 열은 두지 않는다: 검사 목록 응답에 없고, 의뢰 단건 API는 의뢰기관·관리자만 조회할 수 있다
 * - 상태 변경·결과 등록 버튼은 기존 ExaminationApiActions를 그대로 쓴다
 */
export default function ExaminationApiBoard({ examinations, totalElements, page, totalPages, lookups }: ExaminationApiBoardProps) {
  const counts: ExaminationSummaryCounts = {
    waiting: examinations.filter((item) => item.progressStatus === "WAITING").length,
    inProgress: examinations.filter((item) => item.progressStatus === "IN_PROGRESS").length,
    completed: examinations.filter((item) => item.progressStatus === "COMPLETED").length,
    resultPending: examinations.filter((item) => toResultStatus(item) === "PENDING").length,
  };
  const name = (names: Record<string, string>, id: string) => names[id.toLowerCase()];

  return (
    <div className="flex flex-col gap-5">
      <ExaminationSummary counts={counts} scope={`현재 페이지 기준 (${examinations.length}건) · 전체 상태별 건수는 제공되지 않습니다`} />

      <section aria-labelledby="examination-list-title" className="min-w-0 rounded-xl border border-line bg-white px-4 pb-5 pt-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="examination-list-title" className="text-lg font-bold text-gray-900">
            검사 목록
            <span className="ml-2 text-base font-semibold tabular-nums text-primary">{totalElements}건</span>
          </h2>
          <p className="text-xs text-gray-500">정렬: 검사 생성일 최신 순 (서버 기준)</p>
        </div>

        <UnavailableFilter />

        {(lookups.examTypesFailed || lookups.equipmentsFailed) && (
          <p role="status" className="mb-3 text-sm text-amber-700">
            {lookups.examTypesFailed && lookups.equipmentsFailed ? "검사 유형·장비" : lookups.examTypesFailed ? "검사 유형" : "검사 장비"} 이름을 불러오지 못해
            &lsquo;확인 불가&rsquo;로 표시합니다. 검사 처리는 그대로 할 수 있습니다.
          </p>
        )}

        {examinations.length === 0 ? (
          <div role="status" className="rounded-lg border border-dashed border-line px-6 py-14 text-center text-[15px] text-gray-500">
            {page > 0 ? "이 페이지에 표시할 검사가 없습니다." : "우리 기관에 배정된 검사가 없습니다."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
            <table className="w-full min-w-[1060px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[150px]" />
                <col />
                <col className="w-[184px]" />
                <col className="w-[112px]" />
                <col className="w-[112px]" />
                <col className="w-[216px]" />
              </colgroup>
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className={thClass}>의뢰 번호</th>
                  <th scope="col" className={thClass}>검사 유형</th>
                  <th scope="col" className={thClass}>검사 장비</th>
                  <th scope="col" className={thClass}>검사 예정 일시</th>
                  <th scope="col" className={`${thClass} text-center!`}>진행 상태</th>
                  <th scope="col" className={`${thClass} text-center!`}>결과 상태</th>
                  <th scope="col" className={thClass}>작업</th>
                </tr>
              </thead>
              <tbody>
                {examinations.map((exam) => {
                  const examTypeName = name(lookups.examTypeNames, exam.examTypeId);
                  const equipmentName = name(lookups.equipmentNames, exam.equipmentId);
                  const resultStatus = toResultStatus(exam);
                  return (
                    <tr key={exam.examinationId} className="border-t border-line align-middle transition-colors first:border-t-0 hover:bg-gray-50/70">
                      <td className={`${tdClass} whitespace-nowrap`}>
                        <ReferralIdCopyButton referralId={exam.referralId} label="의뢰 번호" />
                      </td>
                      <td className={`${tdClass} truncate`} title={examTypeName}>
                        {examTypeName ?? <Unknown />}
                      </td>
                      <td className={`${tdClass} truncate`} title={equipmentName}>
                        {equipmentName ?? <Unknown />}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatExamSchedule(exam)}</td>
                      <td className={`${tdClass} text-center`}>
                        <ProgressStatusBadge status={exam.progressStatus} />
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <ResultRegistrationBadge status={resultStatus} />
                      </td>
                      <td className={tdClass}>
                        <div className="flex items-start gap-1.5">
                          <ExaminationApiDetailButton
                            examination={exam}
                            examTypeName={examTypeName ?? null}
                            equipmentName={equipmentName ?? null}
                            resultStatus={resultStatus}
                          />
                          <ExaminationApiActions
                            examination={{
                              examinationId: exam.examinationId,
                              progressStatus: exam.progressStatus,
                              reservationStatus: exam.reservationStatus,
                              resultRegistered: exam.resultRegistered,
                              examDate: exam.examDate,
                              startTime: exam.startTime,
                              endTime: exam.endTime,
                            }}
                            detail={{ referralId: exam.referralId, examTypeName: examTypeName ?? null, equipmentName: equipmentName ?? null }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <ExaminationPagination page={page} totalPages={totalPages} />
      </section>
    </div>
  );
}

function Unknown() {
  return <span className="text-gray-400">확인 불가</span>;
}

const toolbarControl = "h-10 rounded-lg border border-line bg-gray-50 text-sm text-gray-400";

/**
 * 와이어프레임의 검색 툴바 모양 (통합 검색·검사 기간·검사 유형·진행 상태·결과 상태·검색).
 * 백엔드 검사 목록 API가 page·size만 받으므로 모두 비활성으로 두고 이유를 함께 보여 준다 (동작하는 것처럼 보이지 않게).
 */
function UnavailableFilter() {
  const selects = ["전체 유형", "전체 진행 상태", "전체 결과 상태"];
  return (
    <div className="mb-4 flex flex-col gap-2">
      <fieldset disabled aria-describedby="examination-filter-unavailable" className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">검사 검색 조건 (사용할 수 없음)</legend>
        <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-[320px] sm:flex-1 sm:basis-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
          <input type="search" aria-label="의뢰번호 검색 (사용할 수 없음)" placeholder="의뢰번호 검색" className={`${toolbarControl} w-full cursor-not-allowed pl-9 pr-3 placeholder:text-gray-400`} />
        </div>
        <button type="button" className={`${toolbarControl} inline-flex cursor-not-allowed items-center gap-2 px-3`}>
          <CalendarDays className="size-4" aria-hidden="true" />
          검사 기간 전체
        </button>
        {selects.map((label) => (
          <div key={label} className="relative">
            <select aria-label={`${label} (사용할 수 없음)`} className={`${toolbarControl} cursor-not-allowed appearance-none pl-3 pr-9`}>
              <option>{label}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
          </div>
        ))}
        <button type="button" className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-gray-200 px-5 text-sm font-bold text-gray-400">
          <Search className="size-4" aria-hidden="true" />
          검색
        </button>
      </fieldset>
      <p id="examination-filter-unavailable" className="flex items-start gap-1.5 text-xs text-gray-500">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        검사 목록 API가 검색 조건을 아직 지원하지 않아 검색 필터를 사용할 수 없습니다. 페이지를 넘겨 전체 검사를 확인해 주세요.
      </p>
    </div>
  );
}

/** 한 번에 보여 줄 페이지 번호 수 */
const PAGE_WINDOW = 5;

/** 화면 주소는 `?page=`(1부터)를 쓴다. 서버가 페이지를 다시 조회한다 */
const pageHref = (page: number) => `?page=${page + 1}`;

function ExaminationPagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1 && page === 0) return null;

  // 범위를 벗어난 페이지(삭제 등으로 줄어든 경우)에서는 첫 페이지로 돌아갈 수 있게 한다
  const lastPage = Math.max(totalPages - 1, 0);
  const start = Math.max(0, Math.min(page - Math.floor(PAGE_WINDOW / 2), lastPage - PAGE_WINDOW + 1));
  const pages = Array.from({ length: Math.min(PAGE_WINDOW, totalPages) }, (_, index) => start + index);
  const linkClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-line px-2 text-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary";
  const disabledClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-line px-2 text-sm text-gray-300";

  return (
    <nav aria-label="검사 목록 페이지" className="mt-4 flex items-center justify-center gap-1">
      {page > 0 ? (
        <Link href={pageHref(Math.min(page - 1, lastPage))} className={linkClass} aria-label="이전 페이지">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden="true">
          <ChevronLeft className="size-4" />
        </span>
      )}

      {pages.map((item) =>
        item === page ? (
          <span key={item} aria-current="page" className={`${linkClass} border-primary bg-primary font-semibold text-white hover:bg-primary`}>
            {item + 1}
          </span>
        ) : (
          <Link key={item} href={pageHref(item)} className={linkClass} aria-label={`${item + 1}페이지`}>
            {item + 1}
          </Link>
        ),
      )}

      {page < lastPage ? (
        <Link href={pageHref(page + 1)} className={linkClass} aria-label="다음 페이지">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden="true">
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
