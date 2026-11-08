"use client";

import { AlertTriangle, Loader2, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { ROUTES } from "@/constants/navigation";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import type { ReferralSummary } from "@/features/referrals/types";
import type { ApiRescheduleTargetResult } from "@/features/referrals/rescheduleTarget";
import SlotSearch from "@/features/slots/components/SlotSearch";
import type { SlotExamTypeOption } from "@/features/slots/examTypeFilter";
import type { PartnerOrganization } from "@/features/slots/types";
import type { RescheduleCause } from "@/features/notifications/types";
import { formatDateTimeWithWeekday } from "@/lib/format/date";
import { MOCK_PARTNER_ORGANIZATIONS } from "@/lib/dev/mockSlots";
import { isPcViewport } from "@/features/slots/initialSearch";

import { loadRescheduleSearchAction } from "../rescheduleSearchActions";

/**
 * 재조정·알림 화면의 '대체 검사 슬롯 검색' 대화상자 (페이지 이동 없음).
 * - 대화상자 상태는 목록 전체를 감싼 Provider가 갖는다: 재예약이 접수되면 서버 목록이 다시 그려져 그 행이 사라져도
 *   대화상자(접수·상태 확인 안내)는 그대로 남는다
 * - 검색·선택·확인·재예약은 슬롯 검색 화면과 같은 SlotSearch(재조정 모드)를 그대로 쓴다 (검색 조건·결과·오류 처리 공유)
 *   API: 서버 로더(협력 기관·지원 장비·대상 의뢰)를 Server Function으로 받아 SlotSearch(dataSource="api", apiReschedule)
 *   Mock: 기존 Mock 재조정 모드 SlotSearch(rescheduleTarget, RescheduleSlotConfirm — 실제 요청 없음)
 * - 닫으면 공통 Modal이 연 버튼으로 포커스를 돌려준다
 */

/** 대화상자 위에 보여 줄 기존 예약 (목록이 이미 받은 값. 추가 요청 없음) */
export interface RescheduleSummary {
  /** 예약번호 원본 (API: 현재 예약 ID, Mock: 예약번호). 없으면 null */
  reservationNumber: string | null;
  /** API 예약 ID는 축약·복사 버튼으로 보인다 */
  copyable: boolean;
  institution: string;
  /** 기존 검사 유형 (CT·MRI). 알 수 없으면 null */
  modality: string | null;
  /** 기존 세부 검사 항목 이름 (ExamType, 예: 뇌 MRI). 검사 유형 목록에서 찾지 못하면 null (임의 이름을 만들지 않는다) */
  examTypeName: string | null;
  /** `YYYY-MM-DDTHH:mm` (서울). 없으면 null */
  scheduledAt: string | null;
}

export type RescheduleSearchEntry =
  | { kind: "api"; referralId: string; summary: RescheduleSummary }
  | { kind: "mock"; referral: ReferralSummary; failedEquipments: RescheduleCause[]; summary: RescheduleSummary };

const Context = createContext<((entry: RescheduleSearchEntry) => void) | null>(null);

/** 재조정 단계 모달에 넘기는 PC 전용 연결 (모달 닫기·요청 중 닫기 막기) */
interface WizardBridge {
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}

export function RescheduleSearchProvider({ children }: { children: ReactNode }) {
  /** 열린 대상 + 열 때의 화면 폭 (PC면 한 모달 3단계, 아니면 기존 구조). 진행 중에는 바꾸지 않는다 */
  const [opened, setOpened] = useState<{ entry: RescheduleSearchEntry; pc: boolean } | null>(null);
  /** 재조정 요청 중: 모달을 닫지 않는다 (Esc·닫기·취소) */
  const [busy, setBusy] = useState(false);
  const entry = opened?.entry ?? null;
  const pc = opened?.pc ?? false;
  const close = () => {
    if (busy) return;
    setOpened(null);
  };
  const bridge: WizardBridge = { onClose: close, onBusyChange: setBusy };
  return (
    <Context.Provider value={(next) => setOpened({ entry: next, pc: isPcViewport() })}>
      {children}
      <Modal
        open={entry !== null}
        title={pc ? "예약 재조정" : "대체 검사 슬롯 검색"}
        description={
          pc
            ? "기존 예약을 확인하고, 같은 검사 항목의 대체 슬롯을 골라 예약 변경을 요청합니다."
            : "기존 예약과 같은 검사 유형의 대체 슬롯을 골라 예약 변경을 요청합니다."
        }
        size="3xl"
        closeOnBackdrop={false}
        preventClose={busy}
        onClose={close}
      >
        {entry && (
          // PC: 모달 안에만 ITDA 브랜드 색 (뒤 페이지의 공통 스타일·배경은 그대로)
          <div className={pc ? "itda-brand itda-brand--embedded flex flex-col gap-5" : "flex flex-col gap-5"} data-autofocus tabIndex={-1}>
            {entry.kind === "api" ? (
              <ApiRescheduleSearch key={entry.referralId} referralId={entry.referralId} summary={entry.summary} wizard={pc ? bridge : null} />
            ) : pc ? (
              <SlotSearch
                key={entry.referral.id}
                organizations={MOCK_PARTNER_ORGANIZATIONS}
                rescheduleTarget={entry.referral}
                failedEquipments={entry.failedEquipments}
                embedded
                rescheduleWizard={{
                  ...bridge,
                  existing: (
                    <ExistingReservationCard
                      summary={entry.summary}
                      equipmentName={entry.referral.equipmentName}
                      failedEquipmentNames={entry.failedEquipments.map(({ equipmentName }) => equipmentName)}
                    />
                  ),
                }}
              />
            ) : (
              <>
              <ExistingReservation summary={entry.summary} />
              <SlotSearch
                key={entry.referral.id}
                organizations={MOCK_PARTNER_ORGANIZATIONS}
                rescheduleTarget={entry.referral}
                failedEquipments={entry.failedEquipments}
                embedded
              />
              </>
            )}
          </div>
        )}
      </Modal>
    </Context.Provider>
  );
}

/** 재조정 행의 [새 슬롯 검색] (같은 화면에서 대화상자를 연다) */
export function RescheduleSearchButton({ entry, label }: { entry: RescheduleSearchEntry; label: string }) {
  const open = useContext(Context);
  return (
    <button
      type="button"
      onClick={() => open?.(entry)}
      disabled={!open}
      aria-haspopup="dialog"
      aria-label={label}
      className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-5 text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
    >
      <Search className="size-4" aria-hidden="true" />
      새 슬롯 검색
    </button>
  );
}

export function ExistingReservation({ summary }: { summary: RescheduleSummary }) {
  return (
    <section aria-label="기존 예약" className="rounded-lg border border-line px-4 py-4 sm:px-5">
      <h3 className="mb-3 text-[15px] font-bold text-gray-800">기존 예약</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[15px] sm:grid-cols-3 lg:grid-cols-6">
        <SummaryItem label="예약번호">
          {summary.reservationNumber ? (
            summary.copyable ? (
              <ReferralIdCopyButton referralId={summary.reservationNumber} label="예약번호" />
            ) : (
              summary.reservationNumber
            )
          ) : (
            "—"
          )}
        </SummaryItem>
        <SummaryItem label="기존 검사기관">{summary.institution}</SummaryItem>
        <SummaryItem label="기존 검사 유형">{summary.modality ?? "확인 불가"}</SummaryItem>
        <SummaryItem label="기존 세부 검사 항목">{summary.examTypeName ?? "확인 불가"}</SummaryItem>
        <SummaryItem label="기존 검사일시">{summary.scheduledAt ? formatDateTimeWithWeekday(summary.scheduledAt) : "—"}</SummaryItem>
        <SummaryItem label="현재 상태">
          <ReferralStatusBadge status="RESCHEDULE_REQUIRED" />
        </SummaryItem>
      </dl>
    </section>
  );
}

/**
 * PC 재조정 모달 왼쪽의 기존 예약 카드 (슬롯을 고르는 동안 계속 보인다). 목록·대상 조회로 이미 받은 값만 쓴다.
 * 장애 장비 표시는 Mock 재조정 알림의 장애 장비와 같을 때만 (API는 장애 장비를 응답으로 확인할 수 없어 표시하지 않는다)
 */
export function ExistingReservationCard({
  summary,
  equipmentName,
  failedEquipmentNames = [],
}: {
  summary: RescheduleSummary;
  equipmentName?: string | null;
  failedEquipmentNames?: readonly string[];
}) {
  const isFailedEquipment = Boolean(equipmentName && failedEquipmentNames.includes(equipmentName));
  return (
    <section aria-label="기존 예약" className="rounded-xl border border-line bg-white px-4 py-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-600">기존 예약</h3>
        <ReferralStatusBadge status="RESCHEDULE_REQUIRED" />
      </div>
      <p className="mt-2 text-base font-bold tabular-nums text-gray-900">
        {summary.scheduledAt ? formatDateTimeWithWeekday(summary.scheduledAt) : "검사일시 확인 불가"}
      </p>
      <dl className="mt-2 flex flex-col gap-1.5 text-sm">
        <CardItem label="검사기관">{summary.institution}</CardItem>
        <CardItem label="검사 항목">
          {summary.modality ?? "확인 불가"}
          {summary.examTypeName ? ` · ${summary.examTypeName}` : ""}
        </CardItem>
        {equipmentName !== undefined && (
          <CardItem label="검사 장비">
            {equipmentName ?? "—"}
            {isFailedEquipment && (
              <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                <AlertTriangle className="size-3" aria-hidden="true" />
                장비 장애
              </span>
            )}
          </CardItem>
        )}
        <CardItem label="예약번호">
          {summary.reservationNumber ? (
            summary.copyable ? (
              <ReferralIdCopyButton referralId={summary.reservationNumber} label="예약번호" />
            ) : (
              summary.reservationNumber
            )
          ) : (
            "—"
          )}
        </CardItem>
      </dl>
      <p className="mt-3 border-t border-line pt-2.5 text-xs text-gray-500">변경이 확정되기 전까지 기존 예약은 그대로 유지됩니다.</p>
    </section>
  );
}

function CardItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-900">{children}</dd>
    </div>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-900">{children}</dd>
    </div>
  );
}

type LoadState = { kind: "loading" } | Awaited<ReturnType<typeof loadRescheduleSearchAction>>;

/** API 모드: 대상 의뢰·검색 선택지를 받아 슬롯 검색 화면과 같은 SlotSearch(재조정 모드)를 보인다 */
function ApiRescheduleSearch({
  referralId,
  summary,
  wizard,
}: {
  referralId: string;
  summary: RescheduleSummary;
  /** PC: 한 모달 3단계 연결. null이면 기존 구조 */
  wizard: WizardBridge | null;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** 불러오기 실패 뒤 [다시 시도] 회차 */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    loadRescheduleSearchAction(referralId).then(
      (result) => current && setState(result),
      () => current && setState({ ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." }),
    );
    return () => {
      current = false;
    };
  }, [referralId, attempt]);

  const existing = <ExistingReservation summary={summary} />;

  if ("kind" in state) {
    return (
      <>
      {existing}
      <p role="status" className="flex items-center justify-center gap-2 rounded-xl border border-line bg-white px-6 py-12 text-[15px] text-gray-500">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        대체 슬롯 검색 조건을 불러오고 있습니다.
      </p>
      </>
    );
  }
  if (!state.ok) {
    const signedOut = state.reason === "SIGNED_OUT" || state.reason === "UNAUTHORIZED";
    return (
      <>
      {existing}
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-red-50 px-6 py-10 text-center text-[15px] text-red-700">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
        {signedOut ? (
          <Link href={ROUTES.login} className="font-semibold underline underline-offset-4">
            로그인 화면으로 이동
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((value) => value + 1);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            다시 시도
          </button>
        )}
      </div>
      </>
    );
  }
  // 대상 조회 실패면 SlotSearch가 실패 안내를 보여 준다. 대화상자에서는 일반 검색으로 넘어가지 않도록 안내만 한다
  if (!state.reschedule.ok) {
    return (
      <>
      {existing}
      <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-6 py-6 text-[15px] text-red-700">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p>{state.reschedule.message}</p>
      </div>
      </>
    );
  }
  if (wizard) {
    // PC: 대상 조회·검증이 끝났으므로 한 모달 3단계로 (열면 기존 예약 조건으로 자동 검색)
    return (
      <ApiRescheduleSlotSearch
        organizations={state.organizations}
        examTypeOptions={state.examTypes}
        reschedule={state.reschedule}
        wizard={{
          ...wizard,
          existing: <ExistingReservationCard summary={summary} equipmentName={state.reschedule.target.currentReservation?.equipmentName ?? null} />,
        }}
      />
    );
  }
  return (
    <>
      {existing}
      {/* 일반 슬롯 검색과 같은 SlotSearch: 검사 유형·세부 검사 항목 고정 + 협력 검사기관·날짜·시간대 */}
      <ApiRescheduleSlotSearch organizations={state.organizations} examTypeOptions={state.examTypes} reschedule={state.reschedule} />
    </>
  );
}

/** 테스트에서도 같은 구성을 그릴 수 있게 분리 (대화상자 안 재조정 검색) */
export function ApiRescheduleSlotSearch({
  organizations,
  examTypeOptions,
  reschedule,
  wizard,
}: {
  organizations: PartnerOrganization[];
  examTypeOptions: SlotExamTypeOption[] | null;
  reschedule: ApiRescheduleTargetResult;
  /** PC 한 모달 3단계 (없으면 기존 구조) */
  wizard?: WizardBridge & { existing: ReactNode };
}) {
  return (
    <SlotSearch
      dataSource="api"
      organizations={organizations}
      examTypeOptions={examTypeOptions}
      apiReschedule={reschedule}
      embedded
      rescheduleWizard={wizard}
    />
  );
}
