import type { StatusTone } from "@/components/ui/StatusBadge";

/**
 * 장비 장애의 등록된 중단 기간(startAt ~ endAt) 상태 (화면 계산, 백엔드 status·API는 그대로).
 *
 * 백엔드 EquipmentIncidentStatus는 OCCURRED 하나뿐이라 "장애가 지금도 진행 중인지"를 알려 주지 않는다.
 * 그래서 등록된 중단 기간과 현재 시각을 비교해 중단 예정·중단 중·중단 해제로 보인다.
 * - 시작 포함·종료 미포함: startAt ≤ 현재 < endAt 이면 중단 중 (백엔드 중단 구간 집계와 같은 경계)
 * - '중단 해제'는 등록된 중단 기간이 끝났다는 뜻일 뿐, 장비 복구 완료를 뜻하지 않는다 (복구 기능·데이터 없음)
 */
export type ImpactWindowStatus = "UPCOMING" | "ACTIVE" | "ENDED";

export const IMPACT_WINDOW_META: Record<ImpactWindowStatus, { label: string; tone: StatusTone }> = {
  UPCOMING: { label: "중단 예정", tone: "info" },
  ACTIVE: { label: "중단 중", tone: "danger" },
  ENDED: { label: "중단 해제", tone: "muted" },
};

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/**
 * 백엔드 LocalDateTime 문자열(한국 시간, 시간대 표기 없음) → 절대 시각(ms).
 * 브라우저 시간대로 해석하지 않도록 +09:00을 직접 붙인다. 초·소수 초는 생략될 수 있고, 소수 초는 밀리초까지만 쓴다.
 * 형식이 다르거나 없는 날짜면 null (상태를 추측하지 않는다)
 */
export function parseKstLocalDateTime(value: string): number | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const [, minute, seconds = "00", fraction = ""] = match;
  const iso = `${minute}:${seconds}.${fraction.padEnd(3, "0").slice(0, 3)}+09:00`;
  const ms = Date.parse(iso);
  // 2026-02-30처럼 Date가 다음 달로 넘겨 버리는 값은 다시 KST 문자열로 바꿨을 때 원래 날짜와 달라 걸러진다
  if (Number.isNaN(ms) || new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16) !== minute) return null;
  return ms;
}

/** 중단 기간 상태. 시각을 해석할 수 없으면 null */
export function getImpactWindowStatus(startAt: string, endAt: string, nowMs: number): ImpactWindowStatus | null {
  const start = parseKstLocalDateTime(startAt);
  const end = parseKstLocalDateTime(endAt);
  if (start === null || end === null) return null;
  if (nowMs < start) return "UPCOMING";
  if (nowMs < end) return "ACTIVE";
  return "ENDED";
}

/**
 * 다음 상태 변경까지 남은 시간(ms). 열어 둔 화면의 배지를 경계 시각에만 다시 그리기 위해 쓴다.
 * 이미 종료됐거나 시각을 해석할 수 없으면 null (더 바뀌지 않는다)
 */
export function msUntilImpactWindowChange(startAt: string, endAt: string, nowMs: number): number | null {
  const start = parseKstLocalDateTime(startAt);
  const end = parseKstLocalDateTime(endAt);
  if (start === null || end === null) return null;
  if (nowMs < start) return start - nowMs;
  if (nowMs < end) return end - nowMs;
  return null;
}
