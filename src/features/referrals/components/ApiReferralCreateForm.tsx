"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { TextInput } from "@/components/ui/FormControls";
import { ROUTES } from "@/constants/navigation";
import { useRenderedLoginSession } from "@/features/auth/loginSessionContext";
import type { ApiExamSlot } from "@/features/slots/apiSlots";
import { createSubmitLock } from "@/features/slots/submitLock";
import { formatDateLong } from "@/lib/format/date";

import { createReferralAction, loadReferralProgressAction } from "../createActions";
import type { CreateReferralActionResult, ReferralProgressResult } from "../createServer";
import { createIdempotencyTracker } from "../idempotency";
import { PATIENT_NAME_MAX_LENGTH, validatePatientName } from "../remote";

import DetailList from "./DetailList";

/**
 * 새 검사 의뢰 입력 (API 모드). Mock 화면(ReferralCreateForm)과 같은 배치: 선택한 슬롯(읽기 전용) → 입력 → 요청.
 * - 실제 환자 이름을 입력받는다 (Mock의 가상 환자 ID를 이름으로 바꿔 보내지 않는다). 의뢰 목적은 서버에 저장 필드가 없어 받지 않는다
 * - 요청: createReferralAction (서버가 슬롯·장비·협약을 다시 확인하고 POST /api/v1/referrals 1회)
 * - 멱등 키: 같은 내용이면 같은 키. 결과를 알 수 없으면(연결 끊김·시간 초과·5xx·응답 확인 불가) 내용을 잠그고
 *   [같은 요청으로 다시 확인]만 허용한다 (같은 키라 이미 접수됐으면 기존 의뢰를 돌려받는다)
 * - 201은 '접수'다: 의뢰·예약을 다시 조회해 처리 중 → 확정/실패를 보여 준다 (자동 확인 최대 3회, 이후 수동)
 * - 렌더링 시점 로그인 세션을 함께 보낸다. 다른 탭에서 계정이 바뀌었으면(SESSION_CHANGED) 입력·요청을 잠그고 새로고침 안내만 한다
 */

const AUTO_CHECK_DELAYS_MS = [2_000, 5_000, 10_000];
const NETWORK_FAILURE_MESSAGE = "서버 응답을 받지 못했습니다. 이미 접수되었을 수 있으니 [같은 요청으로 다시 확인]을 눌러 주세요.";

type Created = Extract<CreateReferralActionResult, { ok: true }>;

interface ApiReferralCreateFormProps {
  slot: ApiExamSlot;
  onCancel: () => void;
  /** 접수 성공 (상위가 닫을 때 검색 결과를 다시 불러오는 데 쓴다) */
  onCreated?: (referralId: string) => void;
  /** 요청 중 여부 (상위 모달이 닫히지 않게) */
  onBusyChange?: (busy: boolean) => void;
}

export default function ApiReferralCreateForm({ slot, onCancel, onCreated, onBusyChange }: ApiReferralCreateFormProps) {
  const [patientName, setPatientName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lock] = useState(createSubmitLock);
  const [tracker] = useState(() => createIdempotencyTracker());
  const [failure, setFailure] = useState<Extract<CreateReferralActionResult, { ok: false }> | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  /** 이 화면이 렌더링된 로그인 세션 (SessionGuard 제공) */
  const renderedLoginSession = useRenderedLoginSession();
  /** 다른 탭에서 계정이 바뀌어 서버가 요청하지 않았다: 이 화면에서는 다시 보내지 않는다 */
  const sessionChanged = failure?.reason === "SESSION_CHANGED";

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (lock.running || created || sessionChanged) return;
    const error = validatePatientName(patientName);
    setNameError(error);
    if (error) return;
    const content = { slotId: slot.id, examTypeId: slot.examTypeId, patientName };
    const idempotencyKey = tracker.keyFor(content);
    if (!idempotencyKey) return; // 결과 불명 뒤 내용이 바뀜 (입력은 잠겨 있어 보통 오지 않는다)
    void lock.run(async () => {
      setPending(true);
      onBusyChange?.(true);
      setFailure(null);
      try {
        const result = await createReferralAction({ ...content, idempotencyKey, confirmExisting: tracker.isLocked }, renderedLoginSession);
        if (result.ok) {
          setCreated(result);
          setUncertain(false);
          onCreated?.(result.referral.id);
          return;
        }
        setFailure(result);
        if (result.field === "patientName") setNameError(result.message);
        if (result.uncertain) {
          tracker.lock();
          setUncertain(true);
        }
      } catch {
        tracker.lock();
        setUncertain(true);
        setFailure({ ok: false, reason: "NETWORK", message: NETWORK_FAILURE_MESSAGE, uncertain: true });
      } finally {
        setPending(false);
        onBusyChange?.(false);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <section aria-label="선택한 검사 슬롯" className="rounded-lg bg-surface-muted px-4 py-4">
        <DetailList
          items={[
            ["검사기관", slot.organizationName],
            ["검사 유형", slot.examType],
            ["세부 검사 항목", slot.examTypeName],
            ["검사 장비", slot.equipmentName],
            ["검사 날짜", formatDateLong(slot.startAt.slice(0, 10))],
            ["검사 시간", `${slot.startAt.slice(11, 16)} ~ ${slot.endAt.slice(11, 16)}`],
          ]}
        />
      </section>
      <p className="mt-2 text-sm text-gray-500">검사 슬롯을 바꾸려면 창을 닫고 검색 결과에서 다른 슬롯을 선택해 주세요.</p>

      {created ? (
        <ReferralProgress created={created} />
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-3">
            <TextInput
              id="referral-patient-name"
              label="환자 이름"
              placeholder="예: 홍길동"
              autoComplete="off"
              data-autofocus
              required
              maxLength={PATIENT_NAME_MAX_LENGTH}
              value={patientName}
              disabled={pending || uncertain || sessionChanged}
              onChange={(e) => {
                setPatientName(e.target.value);
                setNameError(null);
              }}
              error={nameError ?? undefined}
            />
            <p className="flex items-start gap-1.5 text-xs text-gray-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              의뢰 목적은 서버에 저장하는 항목이 없어 입력받지 않습니다.
            </p>
          </div>

          {failure && (
            <div role="alert" className={`mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-[15px] ${uncertain && !sessionChanged ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700"}`}>
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p>{failure.message}</p>
                {uncertain && !sessionChanged && (
                  <p className="mt-1 text-sm">
                    같은 요청 키로 다시 보내므로 이미 접수된 의뢰가 있으면 새로 만들지 않고 그 의뢰를 확인합니다. 결과를 확인하기 전에는 입력을 바꿀 수 없습니다.
                  </p>
                )}
                {(failure.reason === "IDEMPOTENCY_CONFLICT" || uncertain) && (
                  <Link href={ROUTES.referring.referrals} className="mt-1 inline-block text-sm font-semibold underline underline-offset-4">
                    의뢰·예약 관리에서 확인
                  </Link>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="h-12 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uncertain ? "닫기" : "취소"}
            </button>
            <button
              type="submit"
              disabled={pending || sessionChanged}
              className="h-12 rounded-lg bg-primary px-6 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {pending ? "요청 중" : uncertain ? "같은 요청으로 다시 확인" : "의뢰·예약 요청"}
            </button>
          </div>
          <p className="mt-3 text-center text-sm text-gray-500 sm:text-right">요청이 접수된 뒤 슬롯 확보·검사기관 확정이 끝나야 예약이 확정됩니다.</p>
        </>
      )}
    </form>
  );
}

/** 접수 뒤 진행 상태: 자동 확인 최대 3회(2·5·10초 뒤), 그 뒤는 [상태 새로고침] */
function ReferralProgress({ created }: { created: Created }) {
  const [progress, setProgress] = useState<ReferralProgressResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [autoIndex, setAutoIndex] = useState(0);
  const stage = progress?.ok ? progress.stage : null;
  const isFinal = stage === "CONFIRMED" || stage === "FAILED" || stage === "OTHER";

  const check = async () => {
    setChecking(true);
    try {
      setProgress(await loadReferralProgressAction(created.referral.id));
    } catch {
      setProgress({ ok: false, reason: "ERROR", message: "서버에 연결할 수 없어 상태를 확인하지 못했습니다." });
    } finally {
      setChecking(false);
    }
  };

  // 제한된 자동 확인 (최종 상태가 되거나 3회가 끝나면 멈춘다)
  useEffect(() => {
    if (isFinal || autoIndex >= AUTO_CHECK_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      void check().then(() => setAutoIndex((index) => index + 1));
    }, AUTO_CHECK_DELAYS_MS[autoIndex]);
    return () => clearTimeout(timer);
    // check는 매 렌더 새로 만들어지지만 의뢰 ID만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoIndex, isFinal]);

  const tone = stage === "CONFIRMED" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : stage === "FAILED" ? "border-red-200 bg-red-50 text-red-800" : "border-info/30 bg-info-soft text-gray-900";
  const title = stage === "CONFIRMED" ? "예약 확정" : stage === "FAILED" ? "예약 실패" : stage === "OTHER" ? "상태 확인 필요" : "접수됨 · 처리 중";
  return (
    <section aria-labelledby="referral-progress-title" className={`mt-5 rounded-lg border px-4 py-4 ${tone}`}>
      <h3 id="referral-progress-title" className="flex items-center gap-2 text-[15px] font-bold">
        {stage === "CONFIRMED" ? <CheckCircle2 className="size-5" aria-hidden="true" /> : stage === "FAILED" ? <AlertTriangle className="size-5" aria-hidden="true" /> : <Loader2 className={`size-5 ${isFinal ? "" : "animate-spin"}`} aria-hidden="true" />}
        {title}
      </h3>
      <p role="status" className="mt-1 text-[15px]">
        {progress === null ? created.message : progress.message}
      </p>
      {progress?.ok && progress.reservation && (
        <p className="mt-1 text-sm text-gray-600">
          의뢰 상태 {progress.referralStatus} · 예약 상태 {progress.reservation.status}
          {progress.reservation.failureReason && ` · 사유 ${progress.reservation.failureReason}`}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          상태 새로고침
        </button>
        <Link href={ROUTES.referring.referrals} className="text-sm font-semibold text-primary underline underline-offset-4">
          의뢰·예약 관리에서 보기
        </Link>
        {!isFinal && autoIndex >= AUTO_CHECK_DELAYS_MS.length && <span className="text-xs text-gray-500">자동 확인을 마쳤습니다. 필요하면 상태 새로고침을 눌러 주세요.</span>}
      </div>
    </section>
  );
}
