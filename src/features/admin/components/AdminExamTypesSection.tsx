import Link from "next/link";

import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";

import { loadAdminExamTypePage } from "../examTypes";
import { isExamTypeModality, type AdminExamTypeModality } from "../remote";

import { parsePage, readParam, TotalCount, type SearchParams } from "./AdminDataParts";
import AdminExamTypeManager from "./AdminExamTypeManager";
import { AdminFailureNotice } from "./AdminNotices";

const PATH = ROUTES.admin.examTypes;
const FILTERS: { value: AdminExamTypeModality | null; label: string }[] = [
  { value: null, label: "전체" },
  { value: "CT", label: "CT" },
  { value: "MRI", label: "MRI" },
];

/**
 * 검사 유형 관리 (관리자, API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 * - 목록 조건: `?modality=CT|MRI`(없으면 전체) · `?page=`(1부터) → `GET /api/v1/exam-types?modality&page&size=20` (요청 1회, 이름순)
 * - 등록·이름 수정 뒤에는 Server Function의 refresh()로 이 목록이 서버 값으로 다시 그려진다
 * - 종류 변경·삭제 API는 없어 두지 않는다. 소요 시간은 장비별 지원 검사 유형에서 정한다
 */
export default async function AdminExamTypesSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const rawModality = readParam(params, "modality");
  const page = parsePage(readParam(params, "page"));
  const modality = rawModality === "" ? undefined : isExamTypeModality(rawModality) ? rawModality : null;
  if (modality === null || page === null) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "목록 조건이 올바르지 않습니다. 종류 탭을 다시 선택해 주세요.", code: null }} />;
  }

  const list = await loadAdminExamTypePage({ modality, page });
  if (!list.ok) return <AdminFailureNotice failure={list} />;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="검사 종류 구분" className="flex flex-wrap gap-2 border-b border-line">
        {FILTERS.map(({ value, label }) => {
          const active = (value ?? undefined) === modality;
          return (
            <Link
              key={label}
              href={value ? `${PATH}?modality=${value}` : PATH}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-3 text-[15px] font-semibold ${
                active ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <AdminExamTypeManager
        key={`${modality ?? "all"}-${list.page}`}
        items={list.items}
        modality={modality ?? null}
        emptyMessage={list.page > 0 ? "이 페이지에 검사 유형이 없습니다." : modality ? `등록된 ${modality} 검사 유형이 없습니다.` : "등록된 검사 유형이 없습니다."}
        summary={<TotalCount total={list.totalElements} page={list.page} totalPages={list.totalPages} unit="검사 유형" />}
      />
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={modality ? { modality } : {}} label="검사 유형 목록 페이지" />
    </div>
  );
}
