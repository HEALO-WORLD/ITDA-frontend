import { redirect } from "next/navigation";

import { ADMIN_HOME_ROUTE } from "@/constants/navigation";

/** `/admin` 진입은 회원 관리로 보낸다 (접근 확인은 관리자 레이아웃이 한다) */
export default function AdminHome() {
  redirect(ADMIN_HOME_ROUTE);
}
