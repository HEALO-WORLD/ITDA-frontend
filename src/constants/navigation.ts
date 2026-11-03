import { Bell, CalendarDays, FileText, Search, Wrench } from "lucide-react";

import type { OrganizationRole } from "@/types/auth";
import type { NavItem } from "@/types/navigation";

/** 화면 라우트 (screen-spec 0.2). 백엔드 API 경로가 아니다. */
export const ROUTES = {
  login: "/login",
  signup: "/signup",
  referring: {
    slots: "/referring/slots",
    referrals: "/referring/referrals",
    notifications: "/referring/notifications",
  },
  examining: {
    equipment: "/examining/equipment",
    reservations: "/examining/reservations",
    incidents: "/examining/incidents",
    examinations: "/examining/examinations",
    notifications: "/examining/notifications",
  },
} as const;

/** 의뢰기관 사이드바 (screen-spec 2.2, 대시보드는 MVP 범위에서 제외) */
const REFERRING_NAV: NavItem[] = [
  { label: "검사 슬롯 검색", icon: Search, href: ROUTES.referring.slots },
  { label: "의뢰·예약 관리", icon: CalendarDays, href: ROUTES.referring.referrals },
  { label: "재조정·알림", icon: Bell, href: ROUTES.referring.notifications },
];

/** 검사기관 사이드바 (screen-spec 2.3) */
const EXAMINING_NAV: NavItem[] = [
  { label: "장비·슬롯 운영", icon: CalendarDays, href: ROUTES.examining.equipment },
  { label: "확정 예약 관리", icon: CalendarDays, href: ROUTES.examining.reservations },
  { label: "장비 장애·재조정", icon: Wrench, href: ROUTES.examining.incidents },
  { label: "검사 진행·결과", icon: FileText, href: ROUTES.examining.examinations },
  { label: "알림", icon: Bell, href: ROUTES.examining.notifications },
];

export const NAV_ITEMS_BY_ROLE: Record<OrganizationRole, NavItem[]> = {
  REFERRING: REFERRING_NAV,
  EXAMINING: EXAMINING_NAV,
};

/**
 * 역할별 초기 진입 화면 (`/referring`·`/examining` 진입, 개발용 역할 바로가기, 추후 로그인 후 이동)
 * TODO(examining): 확정 예약 관리(S06) 구현 후 검사기관 기본 화면을 ROUTES.examining.reservations로 바꾼다.
 */
export const HOME_ROUTE_BY_ROLE: Record<OrganizationRole, string> = {
  REFERRING: ROUTES.referring.slots,
  EXAMINING: ROUTES.examining.equipment,
};

/** 헤더 알림 아이콘이 이동할 화면 */
export const NOTIFICATION_ROUTE_BY_ROLE: Record<OrganizationRole, string | null> = {
  REFERRING: ROUTES.referring.notifications,
  EXAMINING: ROUTES.examining.notifications,
};
