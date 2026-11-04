import { Building2, LogOut } from "lucide-react";

import NotificationBellLink from "@/features/notifications/components/NotificationBellLink";
import type { SessionUser } from "@/types/auth";

import Logo from "./Logo";

interface AppHeaderProps {
  /** 로고 옆 문구. 로그인 후에는 기관명, 로그인 화면에서는 서비스 소개 문구 */
  subtitle: string;
  /** 로그인 사용자. 없으면 우측 계정 영역을 표시하지 않는다 (관리자 화면도 쓰므로 표시에 쓰는 값만 받는다) */
  user?: Pick<SessionUser, "roleLabel" | "hasUnreadNotifications">;
  /** 알림 아이콘 이동 경로. null이면 알림 아이콘을 표시하지 않는다 */
  notificationHref?: string | null;
  /** 로그아웃 버튼 표시 (API 모드 로그인 세션에서만. 기존 `POST /auth/logout` 사용) */
  showLogout?: boolean;
}

/**
 * 공통 헤더: 로고 · 기관명 | 계정 · 알림 · 로그아웃.
 * 좁은 화면에서는 기관명·계정 문구를 줄여 한 줄을 유지한다 (높이 64px 고정).
 */
export default function AppHeader({ subtitle, user, notificationHref = null, showLogout = false }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-4">
        <Logo />
        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
        <span className="hidden truncate text-sm font-medium text-gray-600 sm:block">{subtitle}</span>
      </div>
      {user && (
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700">
            <Building2 className="size-4 shrink-0 text-gray-500" strokeWidth={1.8} aria-hidden="true" />
            <span className="max-w-[140px] truncate sm:max-w-[240px]">{user.roleLabel}</span>
          </div>
          {notificationHref && (
            /* 알림 상태 Provider 안에서는 공유 읽음 상태를, 밖에서는 세션 값을 사용한다 */
            <NotificationBellLink href={notificationHref} fallbackHasUnread={user.hasUnreadNotifications} />
          )}
          {showLogout && (
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <LogOut className="size-4" strokeWidth={1.8} aria-hidden="true" />
                <span className="hidden sm:inline">로그아웃</span>
                <span className="sr-only sm:hidden">로그아웃</span>
              </button>
            </form>
          )}
        </div>
      )}
    </header>
  );
}
