import Link from "next/link";

import { ROUTES } from "@/constants/navigation";

import { ADMIN_USER_TABS, loadAdminUsers, type AdminUserTab } from "../server";

import { AdminFailureNotice } from "./AdminNotices";
import AdminUserTable from "./AdminUserTable";

interface AdminUsersSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TAB_LABELS: Record<AdminUserTab, string> = { pending: "가입 승인 대기", approved: "승인 완료", all: "전체" };

/**
 * 회원 관리 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 * - `?tab=pending|approved|all` → 백엔드 `GET /api/v1/users?active=false|true|(없음)` (없으면 승인 대기)
 * - 승인 대기 건수는 승인 대기 목록 길이다 (백엔드에 건수 API가 없다). 승인하면 Server Function의 refresh()로 목록·건수가 다시 그려진다
 * - 관리자 역할 확인·조회는 서버 로더가 한다 (ADMIN이 아니면 요청하지 않는다)
 */
export default async function AdminUsersSection({ searchParams }: AdminUsersSectionProps) {
  const rawTab = (await searchParams).tab;
  const tab = rawTab === undefined ? "pending" : (ADMIN_USER_TABS as readonly unknown[]).includes(rawTab) ? (rawTab as AdminUserTab) : null;
  if (!tab) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "알 수 없는 회원 목록 탭입니다. 탭을 다시 선택해 주세요.", code: null }} />;
  }

  const [result, pending] = await Promise.all([loadAdminUsers(tab), tab === "pending" ? null : loadAdminUsers("pending")]);
  if (!result.ok) return <AdminFailureNotice failure={result} />;
  const pendingCount = tab === "pending" ? result.users.length : pending?.ok ? pending.users.length : null;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="회원 목록 구분" className="flex flex-wrap gap-2 border-b border-line">
        {ADMIN_USER_TABS.map((value) => {
          const active = value === tab;
          const label = value === "pending" && pendingCount !== null ? `${TAB_LABELS[value]} (${pendingCount})` : TAB_LABELS[value];
          return (
            <Link
              key={value}
              href={value === "pending" ? ROUTES.admin.users : `${ROUTES.admin.users}?tab=${value}`}
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
      <AdminUserTable key={tab} users={result.users} tab={tab} />
    </div>
  );
}
