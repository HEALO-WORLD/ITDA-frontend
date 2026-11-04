"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS_BY_ROLE, type NavRole } from "@/constants/navigation";

interface RoleSidebarProps {
  role: NavRole;
}

const itemBase =
  "relative flex items-center gap-3 rounded-lg px-4 py-3 text-[15px] font-medium transition-colors";

export default function RoleSidebar({ role }: RoleSidebarProps) {
  const pathname = usePathname();
  // 아이콘 컴포넌트는 서버→클라이언트 props로 전달할 수 없어 메뉴 구성을 여기서 조회한다
  const items = NAV_ITEMS_BY_ROLE[role];

  return (
    <aside className="w-[240px] shrink-0 border-r border-line bg-surface-muted">
      <nav aria-label="주 메뉴" className="sticky top-[72px] px-3 py-6">
        <ul className="flex flex-col gap-1">
          {items.map(({ label, href, icon: Icon }) => {
            // 경로가 없는 메뉴(범위 협의 중)는 비활성 표시만 한다
            if (!href) {
              return (
                <li key={label}>
                  <span
                    aria-disabled="true"
                    title="화면 범위 협의 중"
                    className={`${itemBase} cursor-not-allowed text-gray-400`}
                  >
                    <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
                    {label}
                  </span>
                </li>
              );
            }

            const isActive = pathname === href || pathname.startsWith(`${href}/`);

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={`${itemBase} ${
                    isActive
                      ? "bg-primary-soft font-bold text-primary"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute -left-3 top-0 h-full w-1 rounded-r bg-primary"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
