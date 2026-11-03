import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { isDemoModeEnabled } from "@/lib/dev/demoMode";

/**
 * ⚠️ 데모 체험 바로가기 (실제 인증 아님)
 *
 * 역할(의뢰기관·검사기관)을 골라 그 역할의 Mock 화면으로 이동한다. 인증·세션·토큰을 만들지 않고 화면만 이동한다.
 * 표시 조건은 isDemoModeEnabled (Mock 모드에서만, 배포 환경은 NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS=true 필요).
 * API 모드에서는 표시하지 않는다 (JWT 로그인만 쓴다). 인증 연동 후 제거한다.
 */

const DEMO_LINKS = [
  { href: "/examining/equipment", label: "검사기관 데모 체험하기" },
  { href: "/referring/slots", label: "의뢰기관 데모 체험하기" },
] as const;

export default function DevRoleShortcuts() {
  if (!isDemoModeEnabled()) return null;

  return (
    <aside
      aria-labelledby="demo-shortcuts-title"
      className="mt-6 w-full max-w-[652px] rounded-lg border border-dashed border-amber-400 bg-amber-50 px-5 py-4 text-sm text-amber-900"
    >
      <p id="demo-shortcuts-title" className="font-bold">
        데모 체험 · 로그인 없이 화면 이동
      </p>
      <p className="mt-1 text-amber-800">
        API 연동 전 개발용 Mock 화면입니다. 실제 로그인이 아니며, 예시 기관 정보와 예시 데이터로 화면만 확인합니다.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {DEMO_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 font-semibold hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            {label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </aside>
  );
}
