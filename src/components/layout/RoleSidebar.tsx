"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS_BY_ROLE, type NavRole } from "@/constants/navigation";

interface RoleSidebarProps {
  role: NavRole;
}

// 데스크톱: 왼쪽 세로 메뉴 / 모바일(md 미만): 헤더 아래 가로 스크롤 메뉴 (메뉴 항목·경로는 같다)
const itemBase =
  "relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors md:gap-3 md:py-2.5 md:text-[15px]";

/** 역할별 사이드바 (의뢰기관·검사기관·관리자 공통 모양) */
export default function RoleSidebar({ role }: RoleSidebarProps) {
  const pathname = usePathname();
  // 아이콘 컴포넌트는 서버→클라이언트 props로 전달할 수 없어 메뉴 구성을 여기서 조회한다
  const items = NAV_ITEMS_BY_ROLE[role];

  return (
    <aside className="shrink-0 border-b border-line bg-white md:w-[232px] md:border-b-0 md:border-r">
      <nav aria-label="주 메뉴" className="px-3 py-2 md:sticky md:top-16 md:px-3 md:py-5">
        <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {items.map(({ label, href, icon: Icon }) => {
            // 경로가 없는 메뉴(범위 협의 중)는 비활성 표시만 한다
            if (!href) {
              return (
                <li key={label}>
                  <span aria-disabled="true" title="화면 범위 협의 중" className={`${itemBase} cursor-not-allowed text-gray-400`}>
                    <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
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
                    isActive ? "bg-primary-soft font-semibold text-primary" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {isActive && <span className="absolute -left-3 top-1.5 bottom-1.5 hidden w-1 rounded-r bg-primary md:block" aria-hidden="true" />}
                  <Icon className={`size-[18px] ${isActive ? "text-primary" : "text-gray-400"}`} strokeWidth={1.8} aria-hidden="true" />
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
