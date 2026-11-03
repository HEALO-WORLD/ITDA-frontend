import { getApiMode } from "@/lib/api/config";

/**
 * ⚠️ 데모 체험(로그인 없이 역할별 Mock 화면 보기) 사용 여부. 실제 인증이 아니다.
 *
 * Mock 모드(NEXT_PUBLIC_API_MODE가 비었거나 "mock")일 때만 켤 수 있다. API 모드에서는 항상 꺼져 JWT 로그인만 쓴다.
 * - 개발 환경(`next dev`): Mock 모드면 항상 켜짐
 * - 배포 환경(Vercel 등): Mock 모드이면서 NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS=true일 때만 켜짐
 * 데모 체험은 세션·쿠키·토큰을 만들지 않고 화면만 이동한다 (Mock 화면은 원래 로그인 없이 Mock 데이터를 보여 준다).
 * NEXT_PUBLIC_ 값은 빌드 시점에 들어가므로 바꾸면 다시 배포해야 반영된다.
 */
export function isDemoModeEnabled(): boolean {
  let isMockMode: boolean;
  try {
    isMockMode = getApiMode() === "mock";
  } catch {
    // 설정 값이 잘못되면 데모도 끈다
    return false;
  }
  if (!isMockMode) return false;
  return process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS === "true";
}
