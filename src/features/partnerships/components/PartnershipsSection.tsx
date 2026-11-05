import Link from "next/link";

import { ROUTES } from "@/constants/navigation";

import { loadPartnerships } from "../server";
import { PARTNERSHIP_FILTERS, PARTNERSHIP_STATUS_LABELS, type PartnershipFilter, type PartnershipScreenRole } from "../types";

import PartnershipFailureNotice from "./PartnershipFailureNotice";
import PartnershipTable from "./PartnershipTable";

interface PartnershipsSectionProps {
  role: PartnershipScreenRole;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const FILTER_LABELS: Record<PartnershipFilter, string> = { all: "전체", ...PARTNERSHIP_STATUS_LABELS };

/**
 * 기관 협약 목록 (API 모드, 의뢰기관·검사기관 공통). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 * - 요청: 내 기관 협약 1회 (`GET /api/v1/partnerships/me`, 상태 조건 없이). 상태 필터(`?status=`)와 건수는 받은 목록으로 계산한다
 * - 역할은 페이지가 정한다. 서버 로더가 users/me 역할을 다시 확인하고, 맞지 않으면 요청하지 않는다
 * - 승인·거절·종료·요청 후에는 Server Function의 refresh()로 이 목록이 서버 값으로 다시 그려진다
 */
export default async function PartnershipsSection({ role, searchParams }: PartnershipsSectionProps) {
  const raw = (await searchParams).status;
  const filter: PartnershipFilter | null =
    raw === undefined ? "all" : (PARTNERSHIP_FILTERS as readonly unknown[]).includes(raw) && raw !== "all" ? (raw as PartnershipFilter) : null;
  if (!filter) {
    return <PartnershipFailureNotice failure={{ ok: false, reason: "ERROR", message: "알 수 없는 협약 상태 필터입니다. 필터를 다시 선택해 주세요." }} />;
  }

  const result = await loadPartnerships(role);
  if (!result.ok) return <PartnershipFailureNotice failure={result} />;
  const base = role === "REFERRING" ? ROUTES.referring.partnerships : ROUTES.examining.partnerships;
  const count = (value: PartnershipFilter) => (value === "all" ? result.partnerships.length : result.partnerships.filter((item) => item.status === value).length);
  const visible = filter === "all" ? result.partnerships : result.partnerships.filter((item) => item.status === filter);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="협약 상태 구분" className="flex flex-wrap gap-2 border-b border-line">
        {PARTNERSHIP_FILTERS.map((value) => {
          const active = value === filter;
          return (
            <Link
              key={value}
              href={value === "all" ? base : `${base}?status=${value}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-3 text-[15px] font-semibold ${
                active ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {FILTER_LABELS[value]} ({count(value)})
            </Link>
          );
        })}
      </nav>
      <PartnershipTable key={filter} role={role} partnerships={visible} filter={filter} totalCount={result.partnerships.length} />
    </div>
  );
}
