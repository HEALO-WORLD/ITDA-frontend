/** 서울 `YYYY-MM-DDTHH:mm`에 분을 더한다 (벽시계 문자열 계산, 시간대 변환 없음). 형식이 틀리면 null */
export function addMinutes(local: string, minutes: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi + minutes));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/**
 * 장애 등록 뒤 장애 목록 반영 확인 (브라우저·서버 공통 순수 로직).
 *
 * 등록 응답 id(slot-service 중단 ID)와 장애 목록 incidentId(referral-service)는 다른 값이라 ID로 찾을 수 없다.
 * 대신 이벤트가 그대로 옮기는 값으로 찾는다 (slot-service EquipmentDowntimeStartedEvent.of):
 *   장애.equipmentId = 중단.equipmentId, 장애.startAt·endAt = 중단.startedAt·endedAt (서울 LocalDateTime), 장애.reason = 중단.reason
 * 같은 장비에 기간이 겹치는 중단은 백엔드가 409 DOWNTIME_OVERLAP으로 막으므로 (장비·시작·종료)가 같은 다른 진행 중 장애는 생기지 않는다.
 * 그래도 예전에 같은 구간으로 만들어진 장애와 헷갈리지 않도록 발생 시각(occurredAt = 등록 시각)이 등록 요청 이후인지도 본다
 * (서버 간 시계 차이를 위해 2분 여유). 하나라도 다르면 '아직 반영 안 됨'으로 본다 (다른 장애를 새 등록으로 판단하지 않는다).
 */

/** 등록한 중단을 장애 목록에서 찾기 위한 값 (시각은 서울 LocalDateTime) */
export interface RegisteredIncidentMatch {
  equipmentId: string;
  startAt: string;
  endAt: string;
  reason: string;
  /** 등록 요청을 보낸 서울 시각 `YYYY-MM-DDTHH:mm` */
  registeredAt: string;
}

export const OCCURRED_AT_SKEW_MINUTES = 2;

const LOCAL = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/** LocalDateTime 비교용 (`HH:mm` = `HH:mm:00` = `HH:mm:00.000`). 형식이 다르면 null */
export function toComparableLocal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = LOCAL.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${match[1]}:${match[2] ?? "00"}${fraction ? `.${fraction}` : ""}`;
}

export function isRegisteredIncident(
  incident: { equipmentId: string; startAt: string; endAt: string; reason: string; occurredAt: string },
  match: RegisteredIncidentMatch,
): boolean {
  const start = toComparableLocal(incident.startAt);
  const end = toComparableLocal(incident.endAt);
  const occurred = toComparableLocal(incident.occurredAt);
  const earliest = toComparableLocal(addMinutes(match.registeredAt, -OCCURRED_AT_SKEW_MINUTES));
  return (
    incident.equipmentId.toLowerCase() === match.equipmentId.toLowerCase() &&
    start !== null &&
    start === toComparableLocal(match.startAt) &&
    end !== null &&
    end === toComparableLocal(match.endAt) &&
    incident.reason === match.reason &&
    occurred !== null &&
    earliest !== null &&
    occurred >= earliest
  );
}

/** 자동 확인 간격·최대 시간 */
export const INCIDENT_POLL_INTERVAL_MS = 2_000;
export const INCIDENT_POLL_TIMEOUT_MS = 30_000;

export type IncidentCheckOutcome = "FOUND" | "NOT_YET" | "STOP" | "RETRY";

export interface PollerDeps {
  /** 한 번 확인 (FOUND: 반영됨, NOT_YET·RETRY: 다음에 다시, STOP: 더 확인하지 않음(401·403 등)) */
  check: () => Promise<IncidentCheckOutcome>;
  onFound: () => void;
  onTimeout: () => void;
  onStop: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * 반영 확인 반복기. 확인은 한 번에 하나만 (응답을 기다린 뒤 다음 확인을 예약하므로 겹쳐 요청하지 않는다).
 * 첫 확인은 interval 뒤. 시작부터 timeout이 지나면 더 예약하지 않고 onTimeout. cancel()은 남은 예약을 지우고 늦게 온 응답도 무시한다.
 */
export function startIncidentPoller({
  check,
  onFound,
  onTimeout,
  onStop,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  intervalMs = INCIDENT_POLL_INTERVAL_MS,
  timeoutMs = INCIDENT_POLL_TIMEOUT_MS,
}: PollerDeps): { cancel: () => void } {
  const startedAt = now();
  let cancelled = false;
  let timer: unknown = null;

  const schedule = () => {
    if (cancelled) return;
    if (now() - startedAt + intervalMs > timeoutMs) {
      onTimeout();
      return;
    }
    timer = setTimer(tick, intervalMs);
  };

  const tick = async () => {
    timer = null;
    if (cancelled) return;
    let outcome: IncidentCheckOutcome;
    try {
      outcome = await check();
    } catch {
      outcome = "RETRY";
    }
    if (cancelled) return;
    if (outcome === "FOUND") onFound();
    else if (outcome === "STOP") onStop();
    else schedule();
  };

  schedule();
  return {
    cancel() {
      cancelled = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
