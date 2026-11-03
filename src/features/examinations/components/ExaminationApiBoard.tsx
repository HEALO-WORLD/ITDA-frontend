import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import type { ExaminationProgressItem } from "../remote";

import ExaminationApiActions from "./ExaminationApiActions";

interface ExaminationApiBoardProps {
  examinations: ExaminationProgressItem[];
  totalElements: number;
  /** 현재 페이지 (0부터, 백엔드 PagedResponse.number) */
  page: number;
  totalPages: number;
}

const STATUS_LABELS = {
  WAITING: "검사 대기",
  IN_PROGRESS: "진행 중",
  COMPLETED: "검사 완료",
} as const;

export default function ExaminationApiBoard({
  examinations,
  totalElements,
  page,
  totalPages,
}: ExaminationApiBoardProps) {
  return (
    <section className="rounded-xl border border-line bg-white p-6">
      <h2 className="mb-4 text-lg font-bold">
        검사 목록 ({totalElements}건)
      </h2>

      {examinations.length === 0 ? (
        <p role="status" className="py-12 text-center text-gray-500">
          현재 페이지에 표시할 검사가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-3">검사 ID</th>
                <th className="p-3">검사 예정일</th>
                <th className="p-3">시작 시간</th>
                <th className="p-3">종료 시간</th>
                <th className="p-3">진행 상태</th>
                <th className="p-3">예약 상태</th>
                <th className="p-3">결과 등록</th>
                <th className="p-3">처리</th>
              </tr>
            </thead>
            <tbody>
              {examinations.map((exam) => (
                <tr key={exam.examinationId} className="border-b">
                  <td className="p-3 font-mono text-xs">
                    {exam.examinationId}
                  </td>
                  <td className="p-3">{exam.examDate.slice(0, 10)}</td>
                  <td className="p-3">{exam.startTime.slice(11, 16)}</td>
                  <td className="p-3">{exam.endTime.slice(11, 16)}</td>
                  <td className="p-3">
                    {STATUS_LABELS[exam.progressStatus]}
                  </td>
                  <td className="p-3">{exam.reservationStatus}</td>
                  <td className="p-3">
                    {exam.resultRegistered ? "등록 완료" : "미등록"}
                  </td>
                  <td className="p-3">
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
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ExaminationPagination page={page} totalPages={totalPages} />
    </section>
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