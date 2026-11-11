/** 목록에 보일 의뢰 ID 축약 표기: 앞 8자리…뒤 4자리 (표시 전용. 요청·복사에는 원본 UUID를 쓴다) */
export function abbreviateReferralId(referralId: string): string {
  return referralId.length > 12 ? `${referralId.slice(0, 8)}…${referralId.slice(-4)}` : referralId;
}
