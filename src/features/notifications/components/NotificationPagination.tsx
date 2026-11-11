import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** 한 번에 보여 줄 페이지 번호 수 (검사 목록 페이지네이션과 같다) */
const PAGE_WINDOW = 5;

interface NotificationPaginationProps {
  /** 0부터 */
  page: number;
  totalPages: number;
  /** 페이지 외에 유지할 쿼리 (예: 읽지 않음 필터) */
  query?: Record<string, string>;
  /** 페이지 번호 쿼리 이름 (한 화면에 목록이 둘일 때 구분) */
  pageParam?: string;
  /** 탐색 영역 이름 (스크린리더) */
  label?: string;
}

/**
 * 알림 목록 페이지 이동 (API 모드). 화면 주소는 `?page=`(1부터)를 쓰고 서버가 페이지를 다시 조회한다.
 * 모양은 검사 목록 페이지네이션(ExaminationApiBoard)과 같다.
 */
export default function NotificationPagination({
  page,
  totalPages,
  query = {},
  pageParam = "page",
  label = "알림 목록 페이지",
}: NotificationPaginationProps) {
  if (totalPages <= 1 && page === 0) return null;

  const pageHref = (target: number) => `?${new URLSearchParams({ ...query, [pageParam]: String(target + 1) })}`;
  // 범위를 벗어난 페이지(읽음 처리로 목록이 줄어든 경우 등)에서는 앞 페이지로 돌아갈 수 있게 한다
  const lastPage = Math.max(totalPages - 1, 0);
  const start = Math.max(0, Math.min(page - Math.floor(PAGE_WINDOW / 2), lastPage - PAGE_WINDOW + 1));
  const pages = Array.from({ length: Math.min(PAGE_WINDOW, totalPages) }, (_, index) => start + index);
  const linkClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-line bg-white px-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary";
  const disabledClass =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-line bg-gray-50 px-2 text-sm text-gray-300";

  return (
    <nav aria-label={label} className="mt-5 flex items-center justify-center gap-1.5">
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
          <span key={item} aria-current="page" className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-primary bg-primary px-2 text-sm font-semibold text-white shadow-sm">
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
