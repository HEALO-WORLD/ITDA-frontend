"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Info, Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { ROUTES } from "@/constants/navigation";
import type { ApiExamSlot } from "@/features/slots/apiSlots";
import type { PartnerOrganization } from "@/features/slots/types";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { checkRescheduleCandidateAction, requestRescheduleAction } from "../rescheduleActions";
import { loadRescheduleProgressAction } from "../rescheduleProgressActions";
import type { ApiRescheduleTarget } from "../rescheduleTarget";

import ReservationCard from "./ReservationCompareCard";

type CheckResult = Awaited<ReturnType<typeof checkRescheduleCandidateAction>>;
type RequestResult = Awaited<ReturnType<typeof requestRescheduleAction>>;
type ProgressResult = Awaited<ReturnType<typeof loadRescheduleProgressAction>>;
type RequestFailure = Extract<RequestResult, { ok: false }>;

/**
 * 재예약 화면 단계.
 * CHECKING: 후보 확인 중 → READY(확인 통과) | REJECTED(통과 못 함, 다시 확인 가능)
 * SUBMITTING: 재예약 요청 중 → ACCEPTED(접수, 확정 아님) | FAILED(확실한 실패) | UNCERTAIN(결과 불명: 다시 요청하지 않고 상태 확인만)
 */
export type Phase =
  | { kind: "CHECKING" }
  | { kind: "READY" }
  | { kind: "REJECTED"; message: string }
  | { kind: "SUBMITTING" }
  | { kind: "ACCEPTED"; message: string }
  | { kind: "FAILED"; message: string; showList: boolean }
  | { kind: "UNCERTAIN"; message: string };

/** 결과를 알 수 없는 요청 실패 (서버가 이미 접수했을 수 있다) */
const UNCERTAIN_CAUSES = new Set(["NETWORK", "INVALID_RESPONSE", "SERVER_ERROR"]);
const UNCERTAIN_MESSAGE = "재예약 요청 결과를 확인하지 못했습니다. 이미 접수되었을 수 있으니 다시 요청하지 말고 [현재 상태 확인]으로 확인해 주세요.";
/** 접수 뒤 자동 상태 확인 시점 (최대 3회, 이후 수동) */
const AUTO_CHECK_DELAYS_MS = [2_000, 5_000, 10_000];

/** 요청 실패 → 화면 단계 (409·404·권한·만료는 확실한 실패, 네트워크·응답 형식·5xx·중복 처리 중은 결과 불명) */
export function toRequestFailurePhase(result: RequestFailure): Extract<Phase, { kind: "FAILED" | "UNCERTAIN" }> {
  if (result.reason === "DUPLICATE_REQUEST") return { kind: "UNCERTAIN", message: result.message };
  if (result.reason === "REQUEST_FAILED" && result.request && UNCERTAIN_CAUSES.has(result.request.cause)) {
    return { kind: "UNCERTAIN", message: UNCERTAIN_MESSAGE };
  }
  const cause = result.request?.cause;
  const message =
    cause === "CONFLICT"
      ? "이미 재예약했거나 의뢰 상태가 바뀌어 요청하지 않았습니다. 재조정 목록에서 현재 상태를 확인해 주세요."
      : cause === "NOT_FOUND"
        ? "의뢰를 찾을 수 없거나 이 의뢰를 작성한 담당자가 아닙니다."
        : result.message;
  return { kind: "FAILED", message, showList: cause === "CONFLICT" || cause === "NOT_FOUND" || result.reason === "CANDIDATE_REJECTED" };
}

const localDateTime = (value: string | null) => (value ? formatDateTimeWithWeekday(value.slice(0, 16)) : "—");

type Tone = "info" | "success" | "warning" | "error";

/** 화면 표시 (제목·상태 배너 하나·새 예약 카드 이름·하단 버튼). 상태는 서버 응답(후보 확인·요청 결과·상태 재조회)만으로 정한다 */
export interface RescheduleView {
  title: "예약 변경 확인" | "예약 재조정 현황" | "예약 재조정 완료";
  banner: { tone: Tone; message: string; busy?: boolean; showList?: boolean };
  newCardLabel: "변경할 예약" | "변경 요청 예약" | "확정된 예약";
  /** 하단 버튼: 요청 전(취소·요청) | 다시 확인 | 닫기만 | 닫기·상태 확인 */
  actions: "REQUEST" | "RECHECK" | "CLOSE" | "STATUS";
  /** 상태 확인 버튼 이름 */
  statusLabel?: "상태 새로고침" | "현재 상태 확인";
}

/**
 * 단계 + 상태 재조회 결과 → 화면 표시 (순수 함수).
 * - 접수(ACCEPTED)는 확정이 아니다: 상태 재조회가 CONFIRMED를 돌려줄 때만 '예약 재조정 완료'
 * - 안내는 배너 하나에만 (접수 안내와 현재 상태를 함께 겹쳐 보이지 않는다)
 */
export function getRescheduleView(phase: Phase, progress: ProgressResult | null): RescheduleView {
  switch (phase.kind) {
    case "CHECKING":
      return { title: "예약 변경 확인", banner: { tone: "info", busy: true, message: "선택한 슬롯으로 재조정할 수 있는지 확인하고 있습니다." }, newCardLabel: "변경할 예약", actions: "REQUEST" };
    case "READY":
      return { title: "예약 변경 확인", banner: { tone: "success", message: "재조정 요청 전 확인을 통과했습니다. 아직 예약은 변경되지 않았습니다." }, newCardLabel: "변경할 예약", actions: "REQUEST" };
    case "SUBMITTING":
      return { title: "예약 변경 확인", banner: { tone: "info", busy: true, message: "재조정을 요청하고 있습니다." }, newCardLabel: "변경할 예약", actions: "REQUEST" };
    case "REJECTED":
      return { title: "예약 변경 확인", banner: { tone: "error", message: phase.message }, newCardLabel: "변경할 예약", actions: "RECHECK" };
    case "FAILED":
      return { title: "예약 변경 확인", banner: { tone: "error", message: phase.message, showList: phase.showList }, newCardLabel: "변경할 예약", actions: "CLOSE" };
    case "UNCERTAIN":
    case "ACCEPTED": {
      const base = { title: "예약 재조정 현황" as const, newCardLabel: "변경 요청 예약" as const, statusLabel: phase.kind === "UNCERTAIN" ? ("현재 상태 확인" as const) : ("상태 새로고침" as const) };
      if (progress?.ok) {
        if (progress.stage === "CONFIRMED") {
          return { title: "예약 재조정 완료", banner: { tone: "success", message: progress.message }, newCardLabel: "확정된 예약", actions: "CLOSE" };
        }
        if (progress.stage === "PROCESSING") {
          return { ...base, banner: { tone: "info", message: `재조정 요청이 접수되었습니다. ${progress.message}` }, actions: "STATUS" };
        }
        if (progress.stage === "FAILED" || progress.stage === "NEEDS_RESCHEDULE") {
          return { ...base, banner: { tone: "error", message: progress.message, showList: true }, actions: "CLOSE" };
        }
        return { ...base, banner: { tone: "warning", message: progress.message, showList: true }, actions: "CLOSE" };
      }
      if (progress && !progress.ok) {
        return { ...base, banner: { tone: "warning", message: `${phase.kind === "ACCEPTED" ? "재조정 요청은 접수되었지만 " : ""}현재 상태를 확인하지 못했습니다. ${progress.message}` }, actions: "STATUS" };
      }
      return phase.kind === "ACCEPTED"
        ? { ...base, banner: { tone: "info", message: `${phase.message} 잠시 뒤 자동으로 상태를 확인합니다.` }, actions: "STATUS" }
        : { ...base, banner: { tone: "warning", message: phase.message, showList: true }, actions: "STATUS" };
    }
  }
}

/**
 * PC 재조정 모달 3단계에서 [슬롯 다시 선택]을 보일지 (순수 함수).
 * 요청을 보내기 전(확인 중·확인 통과·확인 실패)에만 true. 요청 중·접수·결과 불명·실패 뒤에는 슬롯을 다시 고를 수 없다
 */
export function canReturnToSlotSelection(phase: Phase): boolean {
  return phase.kind === "CHECKING" || phase.kind === "READY" || phase.kind === "REJECTED";
}

/** 요청 상태 단계 표시 (재조정 요청 → 요청 접수 → 예약 확정) */
export type StatusStepState = "pending" | "current" | "done" | "error" | "warning";
export interface StatusStep {
  label: "재조정 요청" | "요청 접수" | "예약 확정";
  state: StatusStepState;
  /** 단계 아래 짧은 설명 (예: 확정 대기, 확인 필요) */
  note?: string;
}

/**
 * 단계 + 상태 재조회 결과 → 요청 상태 단계 (순수 함수, getRescheduleView와 같은 기준).
 * - '예약 확정'은 상태 재조회가 CONFIRMED일 때만 완료로 표시한다 (접수 ≠ 확정)
 * - 결과 불명(UNCERTAIN)·상태 확인 실패는 '확인 필요'로, 확실한 실패는 실패로 표시한다
 */
export function getRescheduleStatusSteps(phase: Phase, progress: ProgressResult | null): StatusStep[] {
  const step = (label: StatusStep["label"], state: StatusStepState, note?: string): StatusStep => (note ? { label, state, note } : { label, state });
  switch (phase.kind) {
    case "CHECKING":
    case "READY":
    case "REJECTED":
      return [step("재조정 요청", "pending", "요청 전"), step("요청 접수", "pending"), step("예약 확정", "pending")];
    case "SUBMITTING":
      return [step("재조정 요청", "current", "요청 중"), step("요청 접수", "pending"), step("예약 확정", "pending")];
    case "FAILED":
      return [step("재조정 요청", "error", "요청 실패"), step("요청 접수", "pending"), step("예약 확정", "pending")];
    case "ACCEPTED":
    case "UNCERTAIN": {
      const accepted = phase.kind === "ACCEPTED";
      const receipt = accepted ? step("요청 접수", "done", "접수됨") : step("요청 접수", "warning", "결과 확인 필요");
      if (progress?.ok) {
        if (progress.stage === "CONFIRMED") return [step("재조정 요청", "done"), step("요청 접수", "done", "접수됨"), step("예약 확정", "done", "확정됨")];
        if (progress.stage === "PROCESSING") return [step("재조정 요청", "done"), step("요청 접수", "done", "접수됨"), step("예약 확정", "current", "확정 대기")];
        if (progress.stage === "FAILED" || progress.stage === "NEEDS_RESCHEDULE") {
          return [step("재조정 요청", "done"), receipt, step("예약 확정", "error", "확정 실패")];
        }
        return [step("재조정 요청", "done"), receipt, step("예약 확정", "warning", "확인 필요")];
      }
      if (progress && !progress.ok) return [step("재조정 요청", "done"), receipt, step("예약 확정", "warning", "상태 확인 실패")];
      return accepted
        ? [step("재조정 요청", "done"), receipt, step("예약 확정", "current", "확정 대기")]
        : [step("재조정 요청", "done"), receipt, step("예약 확정", "pending")];
    }
  }
}

const STATUS_STATE_TEXT: Record<StatusStepState, string> = { pending: "대기", current: "진행 중", done: "완료", error: "실패", warning: "확인 필요" };

/** 요청 상태 단계 줄 (PC 재조정 모달 3단계) */
export function RescheduleStatusSteps({ steps }: { steps: StatusStep[] }) {
  return (
    <ol aria-label="재조정 요청 상태" className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-brand-canvas px-4 py-3">
      {steps.map(({ label, state, note }, index) => {
        const Icon = state === "done" ? Check : state === "error" ? X : state === "warning" ? AlertTriangle : state === "current" ? Loader2 : null;
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                state === "done"
                  ? "bg-brand-mint text-brand-navy"
                  : state === "current"
                    ? "bg-brand-navy text-white"
                    : state === "error"
                      ? "bg-red-600 text-white"
                      : state === "warning"
                        ? "bg-amber-400 text-amber-950"
                        : "bg-white text-gray-400 ring-1 ring-inset ring-line-strong"
              }`}
            >
              {Icon ? <Icon className={`size-4 ${state === "current" ? "animate-spin" : ""}`} /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${state === "pending" ? "text-gray-400" : "text-gray-900"}`}>{label}</span>
              <span
                className={`block text-xs ${state === "error" ? "text-red-700" : state === "warning" ? "text-amber-800" : state === "pending" ? "text-gray-400" : "text-gray-600"}`}
              >
                {note ?? STATUS_STATE_TEXT[state]}
              </span>
              <span className="sr-only">, {STATUS_STATE_TEXT[state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const BANNER_CLASS: Record<Tone, string> = {
  info: "border-primary/20 bg-primary-soft text-gray-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-700",
};

interface ApiRescheduleConfirmProps {
  /** 대화상자 열림 (닫을 때도 같은 대화상자를 닫아 연 버튼으로 포커스를 돌려준다) */
  open: boolean;
  target: ApiRescheduleTarget;
  /** 선택한 대체 슬롯. 닫혀 있으면 null */
  slot: ApiExamSlot | null;
  organizations: readonly PartnerOrganization[];
  onCancel: () => void;
  /** 요청 중에는 상위가 닫지 않게 한다 */
  onBusyChange: (busy: boolean) => void;
  /** 재예약이 접수됨 (상위가 닫을 때 검색 결과를 다시 불러오는 데 쓴다) */
  onAccepted: () => void;
  /**
   * PC 재조정 모달 3단계: 별도 대화상자 대신 같은 모달 본문 안에 그린다 (요청 상태 단계 줄 + 하단 버튼 줄 포함).
   * 상태 판단·요청·상태 재조회는 같다
   */
  inline?: boolean;
  /** inline: [← 슬롯 다시 선택] (요청 전 단계에서만 보인다. 요청 중·접수 뒤·실패 뒤에는 숨긴다) */
  onBack?: () => void;
}

/**
 * 재조정 대체 슬롯 확인 대화상자 (API 모드). 기존 예약 | 변경할 예약을 좌우 카드로 비교한다 (좁은 화면은 세로).
 * 1. 열리면 checkRescheduleCandidateAction(의뢰·슬롯·장비 서버 재조회, 조회만)으로 후보를 확인한다
 * 2. 통과했을 때만 [이 슬롯으로 재조정 요청] → requestRescheduleAction (서버가 다시 확인한 뒤 POST 1회, 자동 재시도 없음)
 * 3. 성공은 '접수'다. 의뢰·예약을 다시 조회해 확정·처리 중·실패를 보여 준다 (자동 2·5·10초, 이후 [상태 새로고침])
 * 결과를 알 수 없으면 요청 버튼을 숨기고 상태 확인만 안내한다. 화면에서 의뢰·예약 상태를 바꾸지 않는다.
 * 제목·하단 버튼은 공통 Modal의 고정 영역에 두고 본문만 스크롤한다 (Esc·포커스 이동·복귀는 Modal 그대로).
 */
export default function ApiRescheduleConfirm({ open, target, slot, organizations, onCancel, onBusyChange, onAccepted, inline = false, onBack }: ApiRescheduleConfirmProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "CHECKING" });
  const [checkRound, setCheckRound] = useState(0);
  const [progress, setProgress] = useState<ProgressResult | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const submittingRef = useRef(false);
  const inlineHeadingRef = useRef<HTMLHeadingElement>(null);
  // inline: 3단계로 넘어오면 단계 제목으로 포커스 (모달 안에서 화면이 바뀐 것을 알린다)
  useEffect(() => {
    if (inline) inlineHeadingRef.current?.focus();
  }, [inline]);
  const progressRef = useRef(false);
  const slotId = slot?.id ?? null;

  // 후보 확인 (조회만). 슬롯·의뢰가 바뀌거나 [다시 확인]을 누르면 다시 한다. 늦게 온 응답은 무시한다
  useEffect(() => {
    if (!slotId) return;
    let current = true;
    checkRescheduleCandidateAction(target.referralId, slotId).then(
      (result: CheckResult) => {
        if (!current) return;
        setPhase(result.ok ? { kind: "READY" } : { kind: "REJECTED", message: result.message });
      },
      () => {
        if (current) setPhase({ kind: "REJECTED", message: "서버에 연결할 수 없어 슬롯을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." });
      },
    );
    return () => {
      current = false;
    };
  }, [target.referralId, slotId, checkRound]);

  const checkProgress = async () => {
    if (progressRef.current) return;
    progressRef.current = true;
    setProgressLoading(true);
    try {
      setProgress(await loadRescheduleProgressAction(target.referralId));
    } catch {
      setProgress({ ok: false, reason: "ERROR", message: "상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." });
    } finally {
      progressRef.current = false;
      setProgressLoading(false);
    }
  };

  // 접수 뒤 자동 상태 확인 (2·5·10초 뒤, 확정·실패가 보이면 멈춘다)
  const accepted = phase.kind === "ACCEPTED";
  const settled = progress?.ok === true && progress.stage !== "PROCESSING";
  const checkProgressRef = useRef(checkProgress);
  useEffect(() => {
    checkProgressRef.current = checkProgress;
  });
  useEffect(() => {
    if (!accepted || settled) return;
    const timers = AUTO_CHECK_DELAYS_MS.map((delay) => setTimeout(() => void checkProgressRef.current(), delay));
    return () => timers.forEach(clearTimeout);
  }, [accepted, settled]);

  const submit = async () => {
    if (!slotId || submittingRef.current || phase.kind !== "READY") return; // 연속 클릭 방지
    submittingRef.current = true;
    setPhase({ kind: "SUBMITTING" });
    onBusyChange(true);
    let result: RequestResult;
    try {
      result = await requestRescheduleAction(target.referralId, slotId);
    } catch {
      result = { ok: false, reason: "REQUEST_FAILED", message: UNCERTAIN_MESSAGE, request: { cause: "NETWORK", status: null, code: null } };
    } finally {
      onBusyChange(false);
    }
    if (result.ok) {
      setPhase({ kind: "ACCEPTED", message: result.message });
      onAccepted();
      // 서버가 이미 확정까지 돌려준 경우에도 다시 조회해 확인한다
      return;
    }
    // 실패 뒤에도 같은 화면에서 다시 요청하지 않는다 (submittingRef를 풀지 않는다)
    setPhase(toRequestFailurePhase(result));
  };

  const view = getRescheduleView(phase, progress);
  const busy = phase.kind === "SUBMITTING";

  const footer = (
    <>
      <button type="button" onClick={onCancel} disabled={busy} className={secondaryButtonClass}>
        {view.actions === "REQUEST" || view.actions === "RECHECK" ? "취소" : "닫기"}
      </button>
      {view.actions === "RECHECK" && (
        <button
          type="button"
          onClick={() => {
            setPhase({ kind: "CHECKING" });
            setCheckRound((round) => round + 1);
          }}
          className={secondaryButtonClass}
        >
          다시 확인
        </button>
      )}
      {view.actions === "STATUS" && (
        <button type="button" onClick={() => void checkProgress()} disabled={progressLoading} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
          <RefreshCw className={`size-4 ${progressLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          {view.statusLabel}
        </button>
      )}
      {view.actions === "REQUEST" && (
        <button type="button" onClick={() => void submit()} disabled={phase.kind !== "READY"} className={primaryButtonClass}>
          {busy ? "요청 중" : "이 슬롯으로 재조정 요청"}
        </button>
      )}
    </>
  );

  if (inline) {
    if (!slot) return null;
    // 요청 전(확인 중·확인 통과·확인 실패)에만 슬롯을 다시 고를 수 있다. 요청 중·접수 뒤·결과 불명·실패 뒤에는 되돌아가지 않는다
    const canGoBack = Boolean(onBack) && canReturnToSlotSelection(phase);
    return (
      <section aria-labelledby="reschedule-confirm-title" className="flex flex-col gap-4">
        <h3 id="reschedule-confirm-title" ref={inlineHeadingRef} tabIndex={-1} className="text-lg font-bold text-gray-900 outline-none">
          {view.title}
        </h3>
        <RescheduleStatusSteps steps={getRescheduleStatusSteps(phase, progress)} />
        <RescheduleCompare target={target} slot={slot} organizations={organizations} newCardLabel={view.newCardLabel} banner={view.banner} inline />
        <div className="sticky bottom-0 z-20 -mx-5 -mb-5 mt-1 flex items-center gap-2 border-t border-line bg-white px-5 py-3 sm:-mx-7 sm:-mb-6 sm:px-7">
          {canGoBack && (
            <button type="button" onClick={onBack} className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              슬롯 다시 선택
            </button>
          )}
          <div className="ml-auto flex gap-2">{footer}</div>
        </div>
      </section>
    );
  }

  return (
    <Modal open={open} title={view.title} size="compare" closeOnBackdrop={false} onClose={onCancel} footer={slot ? footer : undefined}>
      {slot && (
        <RescheduleCompare
          target={target}
          slot={slot}
          organizations={organizations}
          newCardLabel={view.newCardLabel}
          banner={view.banner}
        />
      )}
    </Modal>
  );
}

const primaryButtonClass =
  "h-11 rounded-lg bg-primary px-5 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400";
const secondaryButtonClass =
  "h-11 rounded-lg border border-line bg-white px-5 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

/** 대화상자 본문: 기존 예약 | 변경할 예약 카드 + 상태 배너 하나 (테스트에서도 그대로 그린다) */
export function RescheduleCompare({
  target,
  slot,
  organizations,
  newCardLabel,
  banner,
  inline = false,
}: {
  target: ApiRescheduleTarget;
  slot: ApiExamSlot;
  organizations: readonly PartnerOrganization[];
  newCardLabel: RescheduleView["newCardLabel"];
  banner: RescheduleView["banner"];
  /** PC 재조정 모달: 기존 → 변경 화살표와 바뀌는 항목 표시 */
  inline?: boolean;
}) {
  const current = target.currentReservation;
  const currentInstitution = current?.examInstitutionId
    ? (organizations.find((org) => org.id.toLowerCase() === current.examInstitutionId!.toLowerCase())?.name ?? null)
    : null;
  const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a === b);
  const BannerIcon = banner.busy ? Loader2 : banner.tone === "success" ? CheckCircle2 : banner.tone === "info" ? Info : AlertTriangle;
  const currentDateTime = current?.startTime?.slice(0, 16) ?? null;
  // 바뀌는 항목 (값을 모르면 같다고 하지 않는다)
  const changes = inline
    ? {
        dateTime: currentDateTime !== slot.startAt,
        institution: Boolean(currentInstitution) && currentInstitution !== slot.organizationName,
        equipment: Boolean(current?.equipmentName) && current?.equipmentName !== slot.equipmentName,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className={inline ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
        <ReservationCard
          label="기존 예약"
          tone="neutral"
          dateTime={current ? `${localDateTime(current.startTime)}${current.endTime ? ` ~ ${current.endTime.slice(11, 16)}` : ""}` : "—"}
          institution={currentInstitution}
          examItem={target.examTypeName}
          equipment={current?.equipmentName ?? null}
        />
        {inline && (
          <span aria-hidden="true" className="flex items-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-navy text-white">
              <ArrowRight className="size-4" />
            </span>
          </span>
        )}
        <ReservationCard
          label={newCardLabel}
          tone="highlight"
          dateTime={`${formatDateTimeWithWeekday(slot.startAt)} ~ ${slot.endAt.slice(11, 16)}`}
          institution={slot.organizationName}
          examItem={slot.examTypeName}
          equipment={slot.equipmentName}
          sameInstitution={same(currentInstitution, slot.organizationName)}
          sameExamItem={same(target.examTypeName, slot.examTypeName)}
          changes={changes}
        />
      </div>

      <div
        role={banner.tone === "error" || banner.tone === "warning" ? "alert" : "status"}
        aria-live="polite"
        className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-[15px] ${BANNER_CLASS[banner.tone]}`}
      >
        <BannerIcon className={`mt-0.5 size-5 shrink-0 ${banner.busy ? "animate-spin" : ""}`} aria-hidden="true" />
        <div>
          <p>{banner.message}</p>
          {banner.showList && (
            <Link href={ROUTES.referring.notifications} className="mt-1 inline-block text-sm font-semibold underline underline-offset-4">
              재조정·알림에서 확인
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
