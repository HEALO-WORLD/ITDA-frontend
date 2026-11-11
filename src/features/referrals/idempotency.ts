/**
 * 의뢰 생성 멱등 키 관리 (브라우저 메모리, 순수 로직).
 * - 같은 요청 내용(슬롯·검사 유형·환자명)이면 같은 키를 돌려준다: 재시도·결과 확인 요청이 새 의뢰를 만들지 않는다
 *   (백엔드는 같은 키 + 같은 내용이면 기존 의뢰를 돌려준다)
 * - 내용이 바뀌면 새 키를 만든다 (같은 키로 다른 내용을 보내면 백엔드가 409 REFERRAL_IDEMPOTENCY_CONFLICT)
 * - 결과를 알 수 없는 요청 뒤에는 lock()으로 내용 변경을 막는다: 새 키로 다시 보내면 중복 의뢰가 생길 수 있다
 * 새로고침하면 사라진다 (브라우저 저장소에 두지 않는다). 최종 중복 방지는 백엔드 멱등 키다.
 */

export interface ReferralRequestContent {
  slotId: string;
  examTypeId: string;
  patientName: string;
}

const fingerprintOf = ({ slotId, examTypeId, patientName }: ReferralRequestContent) =>
  `${slotId.toLowerCase()}|${examTypeId.toLowerCase()}|${patientName.trim()}`;

export function createIdempotencyTracker(generate: () => string = () => crypto.randomUUID()) {
  let current: { fingerprint: string; key: string } | null = null;
  let locked = false;
  return {
    /** 이 내용으로 보낼 키. 잠겨 있으면 잠근 내용과 다를 때 null (보내지 않는다) */
    keyFor(content: ReferralRequestContent): string | null {
      const fingerprint = fingerprintOf(content);
      if (current && current.fingerprint === fingerprint) return current.key;
      if (locked) return null;
      current = { fingerprint, key: generate() };
      return current.key;
    },
    /** 결과 불명: 지금 내용과 키를 고정한다 */
    lock() {
      locked = true;
    },
    get isLocked() {
      return locked;
    },
  };
}
