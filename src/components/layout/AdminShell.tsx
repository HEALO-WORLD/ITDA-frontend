import type { ReactNode } from "react";

import AppHeader from "./AppHeader";
import RoleSidebar from "./RoleSidebar";

interface AdminShellProps {
  /** 헤더 로고 옆 문구 (운영사 기관명) */
  organizationName: string;
  /** 헤더 계정 표시 (예: 관리자 · admin) */
  roleLabel: string;
  /** 헤더에 로그아웃 버튼 표시 (API 모드 로그인 세션에서만) */
  showLogout?: boolean;
  children: ReactNode;
}

/** 관리자 화면 공통 틀: 공통 헤더 + 관리자 사이드바 + 본문 (업무 화면 AppShell과 같은 배치. 알림 아이콘은 없다) */
export default function AdminShell({ organizationName, roleLabel, showLogout = false, children }: AdminShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader subtitle={organizationName} user={{ roleLabel, hasUnreadNotifications: false }} showLogout={showLogout} />
      <div className="flex flex-1">
        <RoleSidebar role="ADMIN" />
        <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
      </div>
    </div>
  );
}
