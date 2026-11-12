import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleAlert,
  FilePlus2,
  Loader2,
  type LucideIcon,
  RefreshCw,
  RotateCcw,
  SearchX,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { FAILURE_REASON_LABELS, HISTORY_REASON_LABELS, REFERRAL_STATUS_LABELS } from "../labels";
import type { FailureReasonDto, ReferralHistoryReasonDto, ReferralStatusDto } from "../remote";

/**
 * 의뢰 상세 대화상자 공용 조각 (의뢰기관 상세 모달 · 관리자 의뢰 상세 모달이 같은 모양을 쓴다).
 * 섹션 · 정보 칸(작은 라벨 + 선명한 값) · 빈 값 구분 · 실패 사유 경고 · 상태 변경 타임라인 · 로딩 · 오류.
 */

/** 값이 없는 이유 3가지 (API 응답에 없음 · 대상 없음(404) · 조회 실패). 값을 만들어 채우지 않는다 */
const EMPTY_META = {
  none: { label: "정보 없음", icon: null, className: "text-gray-400" },
  missing: { label: "찾을 수 없음", icon: SearchX, className: "text-amber-700" },
  error: { label: "조회 실패", icon: CircleAlert, className: "text-red-600" },
} as const;
export type EmptyReason = keyof typeof EMPTY_META;

export function Empty({ reason }: { reason: EmptyReason }) {
  const { label, icon: Icon, className } = EMPTY_META[reason];
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${className}`}>
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : <span aria-hidden="true">—</span>}
      {label}
    </span>
  );
}

/** 정보 한 칸: 작은 보조 라벨 + 선명한 값 */
export function Info({ label, children, strong = false, wide = false }: { label: string; children: ReactNode; strong?: boolean; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className={`mt-1 break-words ${strong ? "text-base font-semibold text-gray-900" : "text-[15px] font-medium text-gray-800"}`}>{children}</dd>
    </div>
  );
}

export function Section({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Icon className="size-4 text-gray-400" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 섹션 안의 짧은 안내 (예약 없음 · 부분 조회 실패 · 이력 없음 등) */
export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">{children}</p>;
}

/** 예약 실패 사유 경고 영역. compact: 한 줄 안내 (관리자 2단 상세 모달) */
export function FailureReasonNotice({ reason, compact = false }: { reason: FailureReasonDto; compact?: boolean }) {
  if (compact) {
    return (
      <p role="note" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span className="font-semibold text-amber-800">예약 실패 사유</span>
        <span className="text-gray-900">{FAILURE_REASON_LABELS[reason]}</span>
      </p>
    );
  }
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-amber-800">예약 실패 사유</p>
        <p className="mt-0.5 text-sm font-medium text-gray-900">{FAILURE_REASON_LABELS[reason]}</p>
      </div>
    </div>
  );
}

/** 이력 사유별 아이콘·색 (과하지 않게 아이콘 원만 칠한다) */
const HISTORY_META: Record<ReferralHistoryReasonDto, { icon: LucideIcon; className: string }> = {
  REFERRAL_CREATED: { icon: FilePlus2, className: "bg-info-soft text-info" },
  RESERVATION_CONFIRMED: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  RESERVATION_FAILED: { icon: XCircle, className: "bg-orange-50 text-orange-600" },
  RESERVATION_BLOCKED: { icon: Ban, className: "bg-red-50 text-red-600" },
  RESCHEDULED: { icon: RotateCcw, className: "bg-info-soft text-info" },
  CANCELED_BY_REQUESTER: { icon: Ban, className: "bg-gray-100 text-gray-500" },
  RESCHEDULE_TIMEOUT: { icon: CircleAlert, className: "bg-gray-100 text-gray-600" },
};

export interface TimelineItem {
  fromStatus: ReferralStatusDto | null;
  toStatus: ReferralStatusDto;
  reason: ReferralHistoryReasonDto;
  occurredAt: string;
}

/** 상태 변경 이력 세로 타임라인 (백엔드가 준 순서·항목 그대로) */
export function HistoryTimeline({ histories }: { histories: TimelineItem[] }) {
  return (
    <ol className="relative flex flex-col gap-4">
      {histories.map((h, index) => {
        const { icon: Icon, className } = HISTORY_META[h.reason];
        const last = index === histories.length - 1;
        return (
          <li key={`${h.occurredAt}-${index}`} className="relative flex gap-3">
            {!last && <span className="absolute left-[15px] top-8 -bottom-4 w-px bg-line" aria-hidden="true" />}
            <span className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${className}`}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold text-gray-900">{HISTORY_REASON_LABELS[h.reason]}</p>
                <time dateTime={h.occurredAt} className="text-xs tabular-nums text-gray-500">
                  {formatDateTimeWithWeekday(h.occurredAt)}
                </time>
              </div>
              <p className="mt-0.5 text-sm text-gray-600">
                {h.fromStatus ? `${REFERRAL_STATUS_LABELS[h.fromStatus]} → ` : ""}
                {REFERRAL_STATUS_LABELS[h.toStatus]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function DetailLoading() {
  return (
    <p role="status" className="flex items-center justify-center gap-2 py-16 text-[15px] text-gray-500">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
      의뢰 상세를 불러오고 있습니다.
    </p>
  );
}

/** 단건 조회 실패: 원인 안내 + 다시 시도 (빈 화면으로 두지 않는다) */
export function DetailError({ title = "의뢰 상세를 불러오지 못했습니다.", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-100 bg-red-50/70 px-4 py-8 text-center">
      <CircleAlert className="size-6 text-red-500" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-gray-900">{title}</p>
      <p className="text-sm text-gray-600">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          다시 시도
        </button>
      )}
    </div>
  );
}

/** 대화상자 아래 닫기 버튼 줄 */
export function DetailFooter({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-6 flex justify-end border-t border-line pt-4">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
      >
        닫기
      </button>
    </div>
  );
}
