import { isApiFeature } from "@/lib/api/config";

/**
 * 장비 장애(중단) 등록 기능 스위치 (브라우저·서버 공통).
 * 백엔드 POST /api/v1/equipment-downtimes가 배포되기 전이므로 기본은 꺼짐이다.
 * 켜는 조건: API 모드에서 incidents가 API 대상 + NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION=true
 * (NEXT_PUBLIC_ 값은 빌드 때 들어가므로 바꾸면 다시 빌드·배포해야 한다). Mock 모드에서는 항상 꺼짐 (Mock 등록 화면은 따로 있다).
 */
export function isDowntimeRegistrationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION === "true" && isApiFeature("incidents");
}
