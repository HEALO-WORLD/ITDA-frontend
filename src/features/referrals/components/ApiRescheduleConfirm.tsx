"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
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

type CheckResult = Awaited<ReturnType<typeof checkRescheduleCandidateAction>>;
type RequestResult = Awaited<ReturnType<typeof requestRescheduleAction>>;
type ProgressResult = Awaited<ReturnType<typeof loadRescheduleProgressAction>>;
type RequestFailure = Extract<RequestResult, { ok: false }>;

/**
 * 재예약 화면 단계.
 * CHECKING: 후보 확인 중 → READY(확인 통과) | REJECTED(통과 못 함, 다시 확인 가능)
 * SUBMITTING: 재예약 요청 중 → ACCEPTED(접수, 확정 아님) | FAILED(확실한 실패) | UNCERTAIN(결과 불명: 다시 요청하지 않고 상태 확인만)
 */
type Phase =
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
}

/**
 * 재조정 대체 슬롯 확인 대화상자 (API 모드). 기존 예약 | 변경할 예약을 좌우 카드로 비교한다 (좁은 화면은 세로).
 * 1. 열리면 checkRescheduleCandidateAction(의뢰·슬롯·장비 서버 재조회, 조회만)으로 후보를 확인한다
 * 2. 통과했을 때만 [이 슬롯으로 재조정 요청] → requestRescheduleAction (서버가 다시 확인한 뒤 POST 1회, 자동 재시도 없음)
 * 3. 성공은 '접수'다. 의뢰·예약을 다시 조회해 확정·처리 중·실패를 보여 준다 (자동 2·5·10초, 이후 [상태 새로고침])
 * 결과를 알 수 없으면 요청 버튼을 숨기고 상태 확인만 안내한다. 화면에서 의뢰·예약 상태를 바꾸지 않는다.
 * 제목·하단 버튼은 공통 Modal의 고정 영역에 두고 본문만 스크롤한다 (Esc·포커스 이동·복귀는 Modal 그대로).
 */
export default function ApiRescheduleConfirm({ open, target, slot, organizations, onCancel, onBusyChange, onAccepted }: ApiRescheduleConfirmProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "CHECKING" });
  const [checkRound, setCheckRound] = useState(0);
  const [progress, setProgress] = useState<ProgressResult | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const submittingRef = useRef(false);
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
}: {
  target: ApiRescheduleTarget;
  slot: ApiExamSlot;
  organizations: readonly PartnerOrganization[];
  newCardLabel: RescheduleView["newCardLabel"];
  banner: RescheduleView["banner"];
}) {
  const current = target.currentReservation;
  const currentInstitution = current?.examInstitutionId
    ? (organizations.find((org) => org.id.toLowerCase() === current.examInstitutionId!.toLowerCase())?.name ?? null)
    : null;
  const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a === b);
  const BannerIcon = banner.busy ? Loader2 : banner.tone === "success" ? CheckCircle2 : banner.tone === "info" ? Info : AlertTriangle;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReservationCard
          label="기존 예약"
          tone="neutral"
          dateTime={current ? `${localDateTime(current.startTime)}${current.endTime ? ` ~ ${current.endTime.slice(11, 16)}` : ""}` : "—"}
          institution={currentInstitution}
          examItem={target.examTypeName}
          equipment={current?.equipmentName ?? null}
        />
        <ReservationCard
          label={newCardLabel}
          tone="highlight"
          dateTime={`${formatDateTimeWithWeekday(slot.startAt)} ~ ${slot.endAt.slice(11, 16)}`}
          institution={slot.organizationName}
          examItem={slot.examTypeName}
          equipment={slot.equipmentName}
          sameInstitution={same(currentInstitution, slot.organizationName)}
          sameExamItem={same(target.examTypeName, slot.examTypeName)}
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

/** 예약 카드: 검사 일시를 가장 크게, 검사기관·세부 검사 항목, 검사 장비는 보조 정보. 기존과 같은 값은 '기존과 같음'으로 표시 */
function ReservationCard({
  label,
  tone,
  dateTime,
  institution,
  examItem,
  equipment,
  sameInstitution = false,
  sameExamItem = false,
}: {
  label: string;
  tone: "neutral" | "highlight";
  dateTime: string;
  institution: string | null;
  examItem: string | null;
  equipment: string | null;
  sameInstitution?: boolean;
  sameExamItem?: boolean;
}) {
  const sameTag = <span className="ml-1.5 rounded bg-white/80 px-1.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-line">기존과 같음</span>;
  return (
    <section
      aria-label={label}
      className={`flex flex-col gap-3 rounded-xl border px-4 py-4 sm:px-5 ${tone === "highlight" ? "border-primary/30 bg-primary-soft" : "border-line bg-gray-50"}`}
    >
      <h3 className={`text-sm font-bold ${tone === "highlight" ? "text-primary" : "text-gray-600"}`}>{label}</h3>
      <p className="text-lg font-bold tabular-nums text-gray-900">{dateTime}</p>
      <dl className="flex flex-col gap-1.5 text-[15px]">
        <div className="flex gap-3">
          <dt className="w-[88px] shrink-0 text-gray-500">검사기관</dt>
          <dd className="min-w-0 text-gray-900">
            {institution ?? "확인 불가"}
            {sameInstitution && sameTag}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[88px] shrink-0 text-gray-500">세부 검사 항목</dt>
          <dd className="min-w-0 text-gray-900">
            {examItem ?? "확인 불가"}
            {sameExamItem && sameTag}
          </dd>
        </div>
        <div className="flex gap-3 text-sm">
          <dt className="w-[88px] shrink-0 text-gray-400">검사 장비</dt>
          <dd className="min-w-0 text-gray-500">{equipment ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}
