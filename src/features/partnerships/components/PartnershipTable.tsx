"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import { emptyStateClass, primaryButtonClass, rowClass, secondaryButtonClass, tableClass, tableWrapClass, tdClass, theadClass, thClass } from "@/components/ui/styles";
import { formatDateTime } from "@/lib/format/date";

import {
  approvePartnershipAction,
  rejectPartnershipAction,
  requestPartnershipAction,
  terminateExaminingPartnershipAction,
  terminateReferringPartnershipAction,
} from "../actions";
import type { MyPartnershipItemDto } from "../remote";
import { PARTNERSHIP_STATUS_LABELS, type PartnershipActionResult, type PartnershipFilter, type PartnershipScreenRole, type PartnershipStatus } from "../types";

import PartnershipRequestDialog from "./PartnershipRequestDialog";

const STATUS_TONES: Record<PartnershipStatus, StatusTone> = { PENDING: "neutral", ACTIVE: "success", REJECTED: "danger", TERMINATED: "muted" };
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";
const dangerButtonClass =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
const rowButtonClass = "h-9! px-3.5!";

type ConfirmKind = "approve" | "reject" | "terminate" | "rerequest";

const CONFIRM: Record<ConfirmKind, { title: string; button: string; busy: string; danger: boolean }> = {
  approve: { title: "협약 승인", button: "승인", busy: "승인 중…", danger: false },
  reject: { title: "협약 거절", button: "거절", busy: "거절 중…", danger: true },
  terminate: { title: "협약 종료", button: "종료", busy: "종료 중…", danger: true },
  rerequest: { title: "협약 다시 요청", button: "다시 요청", busy: "요청 중…", danger: false },
};

interface PartnershipTableProps {
  role: PartnershipScreenRole;
  partnerships: MyPartnershipItemDto[];
  filter: PartnershipFilter;
  totalCount: number;
}

/**
 * 협약 목록 + 상태별 처리 (API 모드).
 * - 의뢰기관: 협약 중 → 종료, 거절·종료 → 다시 요청, [새 협약 요청]. 승인 대기는 처리할 일이 없다 (검사기관 승인 전에는 의뢰 불가)
 * - 검사기관: 승인 대기 → 승인·거절, 협약 중 → 종료
 * 모든 처리는 확인 대화상자를 거치고, 처리 중에는 다시 요청하지 않는다. 결과는 서버가 다시 그린 목록으로 맞춘다 (화면에서 먼저 바꾸지 않는다).
 * 협약 이력 조회 API는 없어 이력 화면을 두지 않는다.
 */
export default function PartnershipTable({ role, partnerships, filter, totalCount }: PartnershipTableProps) {
  const [target, setTarget] = useState<{ kind: ConfirmKind; item: MyPartnershipItemDto } | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [outcome, setOutcome] = useState<PartnershipActionResult | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const isReferring = role === "REFERRING";

  const open = (kind: ConfirmKind, item: MyPartnershipItemDto) => {
    setOutcome(null);
    setConfirmError(null);
    setTarget({ kind, item });
  };

  const run = async () => {
    if (!target || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setConfirmError(null);
    const { kind, item } = target;
    try {
      const result =
        kind === "approve"
          ? await approvePartnershipAction(item.partnershipId)
          : kind === "reject"
            ? await rejectPartnershipAction(item.partnershipId)
            : kind === "rerequest"
              ? await requestPartnershipAction(item.partnerInstitutionId)
              : isReferring
                ? await terminateReferringPartnershipAction(item.partnershipId)
                : await terminateExaminingPartnershipAction(item.partnershipId);
      // 성공·상태 변경(409)·없음(404)·결과 확인 불가는 서버가 목록을 다시 그렸으므로 창을 닫고 목록 위에 알린다
      if (result.ok || result.reason === "CONFLICT" || result.reason === "NOT_FOUND" || result.reason === "ERROR") {
        setOutcome(result);
        setTarget(null);
      } else {
        setConfirmError(result.message);
      }
    } catch {
      setConfirmError(NETWORK_ERROR_MESSAGE);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const partnerLabel = isReferring ? "검사기관" : "요청 기관";
  const emptyMessage =
    totalCount === 0
      ? isReferring
        ? "아직 협약한 검사기관이 없습니다. [새 협약 요청]으로 검사기관에 협약을 요청해 주세요."
        : "아직 들어온 협약 요청이 없습니다."
      : `${PARTNERSHIP_STATUS_LABELS[filter as PartnershipStatus] ?? ""} 상태의 협약이 없습니다.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
          총 <span className="font-bold text-primary">{partnerships.length}</span>건
          {filter !== "all" && <span className="text-gray-500"> (전체 {totalCount}건 중)</span>}
        </p>
        {isReferring && (
          <button
            type="button"
            onClick={() => {
              setOutcome(null);
              setRequestOpen(true);
            }}
            className={primaryButtonClass}
          >
            <Plus className="size-4" aria-hidden="true" />새 협약 요청
          </button>
        )}
      </div>

      <p className="text-sm text-gray-500">
        {isReferring
          ? "검사기관이 승인한 '협약 중' 기관에만 검사를 의뢰할 수 있습니다. 승인 대기 중에는 의뢰할 수 없습니다."
          : "승인한 '협약 중' 의료기관만 우리 기관에 검사를 의뢰할 수 있습니다."}
      </p>

      {outcome && (
        <p role={outcome.ok ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm ${outcome.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {outcome.message}
        </p>
      )}

      {partnerships.length === 0 ? (
        <div role="status" className={emptyStateClass}>
          {emptyMessage}
        </div>
      ) : (
        <div className={tableWrapClass}>
          <table className={`${tableClass} min-w-[820px]`}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>{partnerLabel}</th>
                <th scope="col" className={thClass}>협약 상태</th>
                <th scope="col" className={thClass}>요청일</th>
                <th scope="col" className={thClass}>승인일</th>
                <th scope="col" className={thClass}>종료일</th>
                <th scope="col" className={`${thClass} text-center!`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {partnerships.map((item) => (
                <tr key={item.partnershipId} className={rowClass}>
                  <td className={`${tdClass} font-medium text-gray-900`}>{item.partnerInstitutionName}</td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge tone={STATUS_TONES[item.status]}>{PARTNERSHIP_STATUS_LABELS[item.status]}</StatusBadge>
                      {item.status === "PENDING" && (
                        <span className="text-xs text-gray-500">{isReferring ? "검사기관 승인 전 · 의뢰 불가" : "승인 전 · 의뢰 불가"}</span>
                      )}
                      {item.status === "ACTIVE" && <span className="text-xs text-emerald-700">검사 의뢰 가능</span>}
                    </div>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(item.requestedAt)}</td>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{item.approvedAt ? formatDateTime(item.approvedAt) : "—"}</td>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{item.terminatedAt ? formatDateTime(item.terminatedAt) : "—"}</td>
                  <td className={`${tdClass} text-center`}>
                    <RowActions role={role} item={item} onAction={open} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={target !== null} title={target ? CONFIRM[target.kind].title : ""} onClose={() => !pending && setTarget(null)} closeOnBackdrop={!pending}>
        {target && (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] text-gray-700">
              <strong className="font-semibold text-gray-900">{target.item.partnerInstitutionName}</strong>
              {confirmText(role, target.kind)}
            </p>
            {confirmError && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {confirmError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTarget(null)} disabled={pending} className={secondaryButtonClass}>
                취소
              </button>
              <button
                type="button"
                data-autofocus
                onClick={run}
                disabled={pending}
                aria-busy={pending}
                className={CONFIRM[target.kind].danger ? dangerButtonClass : primaryButtonClass}
              >
                {pending ? CONFIRM[target.kind].busy : CONFIRM[target.kind].button}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {requestOpen && (
        <PartnershipRequestDialog
          onClose={() => setRequestOpen(false)}
          onDone={(result) => {
            setRequestOpen(false);
            setOutcome(result);
          }}
        />
      )}
    </div>
  );
}

function confirmText(role: PartnershipScreenRole, kind: ConfirmKind): string {
  switch (kind) {
    case "approve":
      return "의 협약 요청을 승인할까요? 승인하면 이 의료기관이 우리 기관에 검사를 의뢰할 수 있습니다.";
    case "reject":
      return "의 협약 요청을 거절할까요? 거절한 뒤에도 의료기관이 다시 요청할 수 있습니다.";
    case "rerequest":
      return "에 협약을 다시 요청할까요? 검사기관이 승인하기 전까지는 검사를 의뢰할 수 없습니다.";
    case "terminate":
      return role === "REFERRING"
        ? " 협약을 종료할까요? 종료하면 이 검사기관에 새 검사를 의뢰할 수 없습니다. 다시 협약하려면 새로 요청해 승인을 받아야 합니다."
        : " 협약을 종료할까요? 종료하면 이 의료기관은 우리 기관에 새 검사를 의뢰할 수 없습니다.";
  }
}

/** 상태별 처리 버튼 (처리할 수 없는 상태는 '—') */
function RowActions({ role, item, onAction }: { role: PartnershipScreenRole; item: MyPartnershipItemDto; onAction: (kind: ConfirmKind, item: MyPartnershipItemDto) => void }) {
  const name = item.partnerInstitutionName;
  const buttons: { kind: ConfirmKind; label: string; className: string }[] = [];
  if (role === "EXAMINING" && item.status === "PENDING") {
    buttons.push({ kind: "approve", label: "승인", className: primaryButtonClass }, { kind: "reject", label: "거절", className: secondaryButtonClass });
  }
  if (item.status === "ACTIVE") buttons.push({ kind: "terminate", label: "협약 종료", className: secondaryButtonClass });
  if (role === "REFERRING" && (item.status === "REJECTED" || item.status === "TERMINATED")) {
    buttons.push({ kind: "rerequest", label: "다시 요청", className: secondaryButtonClass });
  }
  if (buttons.length === 0) {
    return (
      <span className="text-gray-400" aria-label="처리할 작업 없음">
        —
      </span>
    );
  }
  return (
    <div className="flex justify-center gap-1.5">
      {buttons.map((button) => (
        <button
          key={button.kind}
          type="button"
          onClick={() => onAction(button.kind, item)}
          aria-label={`${name} ${button.label}`}
          aria-haspopup="dialog"
          className={`${button.className} ${rowButtonClass}`}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
