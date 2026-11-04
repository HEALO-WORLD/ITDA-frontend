import { Building2, ChevronDown } from "lucide-react";

import NotificationBellLink from "@/features/notifications/components/NotificationBellLink";
import type { SessionUser } from "@/types/auth";

import Logo from "./Logo";

interface AppHeaderProps {
  /** 로고 옆 문구. 로그인 후에는 기관명, 로그인 화면에서는 서비스 소개 문구 */
  subtitle: string;
  /** 로그인 사용자. 없으면 우측 계정 영역을 표시하지 않는다 */
  user?: SessionUser;
  /** 알림 아이콘 이동 경로. null이면 알림 아이콘을 표시하지 않는다 */
  notificationHref?: string | null;
  /** 로그아웃 버튼 표시 (API 모드 로그인 세션에서만. 기존 `POST /auth/logout` 사용) */
  showLogout?: boolean;
}

export default function AppHeader({ subtitle, user, notificationHref = null, showLogout = false }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-[72px] shrink-0 items-center justify-between border-b border-line bg-white px-8">
      <div className="flex items-center gap-5">
        <Logo />
        <span className="h-6 w-px bg-line" aria-hidden="true" />
        <span className="text-[15px] font-medium text-gray-600">{subtitle}</span>
      </div>

      {user && (
        <div className="flex items-center gap-5">
          {/* 계정 메뉴: 드롭다운 항목(로그아웃 등)은 인증 연동 시 확정 (screen-spec S01 확인 필요) */}
          <div className="flex items-center gap-2 text-[15px] font-medium text-gray-800">
            <Building2 className="size-5 text-gray-500" strokeWidth={1.8} aria-hidden="true" />
            <span>{user.roleLabel}</span>
            <ChevronDown className="size-4 text-gray-500" strokeWidth={1.8} aria-hidden="true" />
          </div>

          {notificationHref && (
            <>
              <span className="h-6 w-px bg-line" aria-hidden="true" />
              {/* 알림 상태 Provider 안에서는 공유 읽음 상태를, 밖에서는 세션 값을 사용한다 */}
              <NotificationBellLink
                href={notificationHref}
                fallbackHasUnread={user.hasUnreadNotifications}
              />
            </>
          )}

          {showLogout && (
            <>
              <span className="h-6 w-px bg-line" aria-hidden="true" />
              <form action="/auth/logout" method="post">
                <button type="submit" className="text-[15px] font-medium text-gray-600 hover:text-gray-900 hover:underline">
                  로그아웃
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </header>
  );
}
