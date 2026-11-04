"use client";

import { AlertTriangle, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { ROUTES } from "@/constants/navigation";
import ReferralCreateForm from "@/features/referrals/components/ReferralCreateForm";
import RescheduleSlotConfirm from "@/features/referrals/components/RescheduleSlotConfirm";
import type { ReferralDraft, ReferralSummary } from "@/features/referrals/types";
import { useSlotDataKey } from "@/features/equipment/useLiveEquipments";
import { useFailedEquipmentIds } from "@/features/incidents/useMockIncidents";
import type { RescheduleCause } from "@/features/notifications/types";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { IS_MOCK_DATA, searchSlots } from "../api";
import type { ExamSlot, PartnerOrganization, SlotSearchCriteria } from "../types";

import SlotSearchFilter, { INITIAL_SLOT_CRITERIA } from "./SlotSearchFilter";
import SlotSearchTable from "./SlotSearchTable";

interface SlotSearchProps {
  organizations: PartnerOrganization[];
  /**
   * 재조정 대상 예약. 있으면 신규 의뢰 대신 대체 슬롯 선택 모드로 동작한다.
   * 쿼리에 대상이 있었지만 찾지 못했거나 재조정 대상이 아니면 "INVALID"
   */
  rescheduleTarget?: ReferralSummary | "INVALID" | null;
  /** 재조정 대상 예약의 장애 장비. 재조정 모드에서만 검색·달력에서 제외한다 */
  failedEquipments?: RescheduleCause[];
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; slots: ExamSlot[] }
  | { status: "error" };

/** 제외 장비 없음 (렌더링마다 새 배열이 생기지 않도록 공유) */
const NO_EXCLUDED_EQUIPMENTS: RescheduleCause[] = [];

/** 예약 요청 모달을 열어 둔 슬롯의 장비가 장애 상태가 되어 모달을 닫았을 때의 안내 */
const INTERRUPTED_NOTICE = "장비 상태가 변경되어 예약 요청을 중단했습니다. 슬롯을 다시 검색해 주세요.";

const EMPTY_DRAFT: ReferralDraft = { virtualPatientId: "", purpose: "" };

const hasDraftInput = ({ virtualPatientId, purpose }: ReferralDraft) =>
  Boolean(virtualPatientId.trim() || purpose.trim());

/**
 * 검사 슬롯 검색(S02)의 클라이언트 경계.
 * 검색 조건 → 검색 실행 → 결과/상태 표시, 예약 요청 클릭 처리를 담당한다.
 *
 * 장애 장비가 바뀌면(이 탭 또는 다른 탭의 장애 등록·복구):
 * - 예약 요청 모달에 연 슬롯의 장비가 장애 상태가 되면 모달을 닫고 검색 결과를 비운 뒤 안내한다
 * - 그 밖의 경우(다른 장비 변경·복구)에는 모달을 그대로 두고, 표시 중인 검색 결과만 같은 조건으로 다시 불러온다
 *
 * 의뢰 입력 임시 보관: 장애로 모달이 자동 종료된 경우에만 작성 중이던 입력(가상 환자 ID·의뢰 목적)을
 * 이 컴포넌트 상태(메모리)에 보관하고, 다음에 다른 슬롯을 선택하면 복원한다 (새 슬롯 정보 재확인 필수).
 * 정상 취소·검색 조건 초기화·검증 완료 시 지운다. 브라우저 저장소에는 저장하지 않으며 새로고침하면 사라진다.
 */
export default function SlotSearch({
  organizations,
  rescheduleTarget = null,
  failedEquipments = NO_EXCLUDED_EQUIPMENTS,
}: SlotSearchProps) {
  const rescheduleReferral =
    rescheduleTarget && rescheduleTarget !== "INVALID" ? rescheduleTarget : null;
  // 일반 검색에는 제외 조건을 적용하지 않는다
  const excludedEquipments = rescheduleReferral ? failedEquipments : NO_EXCLUDED_EQUIPMENTS;
  const excludedEquipmentIds = useMemo(
    () => excludedEquipments.map(({ equipmentId }) => equipmentId),
    [excludedEquipments],
  );
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  /** 예약 요청을 누른 슬롯. 의뢰 생성 모달에 읽기 전용으로 표시한다 */
  const [requestedSlot, setRequestedSlot] = useState<ExamSlot | null>(null);
  const [interruptedNotice, setInterruptedNotice] = useState<string | null>(null);
  /** 모달에서 작성 중인 의뢰 입력 */
  const [draft, setDraft] = useState<ReferralDraft>(EMPTY_DRAFT);
  /** 장애로 중단된 요청의 입력 (다음 슬롯 선택 시 복원). 메모리에만 둔다 */
  const [preservedDraft, setPreservedDraft] = useState<ReferralDraft | null>(null);
  /** 지금 모달의 입력이 보관해 둔 입력을 복원한 것인지 */
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  /** 지금 모달에서 검증을 통과했는지 (완료된 입력은 보관하지 않는다) */
  const [isDraftCompleted, setIsDraftCompleted] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  /** 마지막으로 실행한 검색 조건 (장애 장비가 바뀌면 같은 조건으로 결과를 다시 불러온다) */
  const lastCriteriaRef = useRef<SlotSearchCriteria | null>(null);

  // 장애 장비 변경 감지: 열어 둔 슬롯의 장비가 장애가 되면 렌더링 중에 바로 모달을 닫는다
  // (예약 요청 버튼이 있던 행이 사라지므로 포커스는 아래 effect에서 안내로 옮긴다)
  const { ids: failedEquipmentIds, key: failedEquipmentKey } = useFailedEquipmentIds();
  const [seenFailureKey, setSeenFailureKey] = useState(failedEquipmentKey);
  if (seenFailureKey !== failedEquipmentKey) {
    setSeenFailureKey(failedEquipmentKey);
    if (requestedSlot && failedEquipmentIds.has(requestedSlot.equipmentId)) {
      // 신규 의뢰 모달에서 작성 중이던 입력만 보관한다 (재조정 모드에는 입력 항목이 없다)
      const shouldPreserve = !rescheduleReferral && !isDraftCompleted && hasDraftInput(draft);
      setPreservedDraft(shouldPreserve ? draft : null);
      setDraft(EMPTY_DRAFT);
      setRequestedSlot(null);
      setSearch({ status: "idle" });
      setInterruptedNotice(
        shouldPreserve
          ? `${INTERRUPTED_NOTICE} 작성 중이던 의뢰 정보는 다른 예약 가능 슬롯을 선택하면 다시 불러옵니다.`
          : INTERRUPTED_NOTICE,
      );
    }
  }

  // 그 밖의 변경(다른 장비 장애·복구, 검사기관의 슬롯 생성·운영 중단 등): 표시 중인 결과만 같은 조건으로
  // 다시 불러온다 (결과가 없거나 위에서 비웠으면 그대로)
  const slotDataKey = useSlotDataKey();
  const refreshedKeyRef = useRef(slotDataKey);
  useEffect(() => {
    if (refreshedKeyRef.current === slotDataKey) return;
    refreshedKeyRef.current = slotDataKey;
    const criteria = lastCriteriaRef.current;
    if (!criteria) return;
    let isCurrent = true;
    searchSlots(criteria, { excludedEquipmentIds })
      .then((slots) => {
        if (isCurrent) setSearch((prev) => (prev.status === "success" ? { status: "success", slots } : prev));
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [slotDataKey, excludedEquipmentIds]);

  // 모달(자식)이 닫힌 뒤 안내로 포커스를 옮긴다
  useEffect(() => {
    if (interruptedNotice) noticeRef.current?.focus();
  }, [interruptedNotice]);

  const handleSearch = async (criteria: SlotSearchCriteria) => {
    lastCriteriaRef.current = criteria;
    setInterruptedNotice(null);
    setSearch({ status: "loading" });
    try {
      const slots = await searchSlots(criteria, { excludedEquipmentIds });
      setSearch({ status: "success", slots });
    } catch {
      setSearch({ status: "error" });
    }
  };

  /**
   * 검색 결과에서 슬롯을 찾아 의뢰 생성 모달을 연다 (예약 가능 여부는 제출 시 다시 검증).
   * 장애로 중단된 요청의 입력이 있으면 복원한다
   */
  const handleRequestReservation = (slotId: string) => {
    if (search.status !== "success") return;
    const slot = search.slots.find((item) => item.id === slotId) ?? null;
    if (!slot) return;
    setDraft(preservedDraft ?? EMPTY_DRAFT);
    setIsDraftRestored(preservedDraft !== null);
    setIsDraftCompleted(false);
    setRequestedSlot(slot);
  };

  /**
   * 정상적으로 모달을 닫음(취소·닫기·Esc): 작성 중 입력과 보관한 입력을 모두 지운다.
   * 공통 Modal은 프로그램으로 닫을 때도 dialog close 이벤트로 onClose를 부르므로,
   * 장애로 이미 닫은 뒤(requestedSlot이 없을 때) 들어온 호출은 무시해 보관한 입력이 지워지지 않게 한다
   */
  const closeRequest = () => {
    if (!requestedSlot) return;
    setRequestedSlot(null);
    setDraft(EMPTY_DRAFT);
    setPreservedDraft(null);
    setIsDraftRestored(false);
  };

  return (
    <div className="flex flex-col gap-8">
      {rescheduleReferral && (
        <RescheduleBanner referral={rescheduleReferral} excludedEquipments={excludedEquipments} />
      )}
      {rescheduleTarget === "INVALID" && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl bg-red-50 px-6 py-4 text-[15px] text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            재조정 대상 예약을 찾을 수 없습니다. 일반 검사 슬롯 검색으로 표시합니다.
          </p>
          <Link
            href={ROUTES.referring.notifications}
            className="shrink-0 font-semibold underline underline-offset-4"
          >
            재조정·알림으로 이동
          </Link>
        </div>
      )}

      <SlotSearchFilter
        organizations={organizations}
        isSearching={search.status === "loading"}
        onSearch={handleSearch}
        onReset={() => {
          lastCriteriaRef.current = null;
          setInterruptedNotice(null);
          setPreservedDraft(null);
          setSearch({ status: "idle" });
        }}
        initialCriteria={
          rescheduleReferral ? { ...INITIAL_SLOT_CRITERIA, examType: rescheduleReferral.examType } : undefined
        }
        isExamTypeLocked={rescheduleReferral !== null}
        excludedEquipmentIds={excludedEquipmentIds}
      />

      <section
        aria-labelledby="slot-result-title"
        className="rounded-xl border border-line bg-white px-4 pb-5 pt-5 shadow-card sm:px-7 sm:pb-6 sm:pt-6"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 id="slot-result-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
              검색 결과
            </h2>
            {IS_MOCK_DATA && (
              <span className="rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                개발용 예시 데이터
              </span>
            )}
          </div>
          {search.status === "success" && (
            <p className="text-[15px] text-gray-600" aria-live="polite">
              총 {search.slots.length}건의 검색 결과가 있습니다.
            </p>
          )}
        </div>

        {interruptedNotice && (
          <div
            ref={noticeRef}
            tabIndex={-1}
            role="status"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[15px] text-amber-900 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              {interruptedNotice}
            </p>
            <button
              type="button"
              onClick={() => setInterruptedNotice(null)}
              aria-label="안내 닫기"
              className="rounded p-1 text-amber-800 hover:bg-amber-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {search.status === "idle" && (
          <ResultMessage>검색 조건을 선택한 후 검색 버튼을 눌러 주세요.</ResultMessage>
        )}
        {search.status === "loading" && (
          <ResultMessage>검사 슬롯을 검색하고 있습니다.</ResultMessage>
        )}
        {search.status === "error" && (
          <ResultMessage tone="error">
            검사 슬롯을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.
          </ResultMessage>
        )}
        {search.status === "success" &&
          (search.slots.length > 0 ? (
            <SlotSearchTable
              slots={search.slots}
              onRequestReservation={handleRequestReservation}
              actionLabel={rescheduleReferral ? "대체 슬롯 선택" : undefined}
            />
          ) : (
            <ResultMessage>
              {excludedEquipments.length > 0
                ? "장애 장비를 제외하면 선택한 조건에 해당하는 대체 슬롯이 없습니다. 날짜나 검사기관을 바꿔 다시 검색해 주세요."
                : "선택한 조건에 해당하는 검사 슬롯이 없습니다."}
            </ResultMessage>
          ))}
      </section>

      {rescheduleReferral ? (
        <Modal
          open={requestedSlot !== null}
          title="예약 변경 확인"
          description={`${rescheduleReferral.referralNumber} 예약을 변경할 새 슬롯을 확인합니다.`}
          onClose={closeRequest}
        >
          {requestedSlot && (
            <RescheduleSlotConfirm
              referral={rescheduleReferral}
              slot={requestedSlot}
              excludedEquipmentIds={excludedEquipmentIds}
              onCancel={closeRequest}
            />
          )}
        </Modal>
      ) : (
        <Modal
          open={requestedSlot !== null}
          title="새 검사 의뢰"
          description="선택한 검사 슬롯으로 의뢰 정보를 입력합니다."
          closeOnBackdrop={false}
          onClose={closeRequest}
        >
          {requestedSlot && (
            <ReferralCreateForm
              slot={requestedSlot}
              organizations={organizations}
              draft={draft}
              onDraftChange={setDraft}
              isRestored={isDraftRestored}
              onCompleted={() => {
                setIsDraftCompleted(true);
                setPreservedDraft(null);
              }}
              onCancel={closeRequest}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

/** 재조정 모드 안내: 신규 의뢰가 아니라 기존 예약 변경용 슬롯 선택임을 표시한다 */
function RescheduleBanner({
  referral,
  excludedEquipments,
}: {
  referral: ReferralSummary;
  excludedEquipments: RescheduleCause[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-soft px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-[17px] font-bold text-gray-900">
            기존 예약을 변경할 새로운 검사 슬롯을 선택해 주세요.
          </p>
          <p className="mt-1 text-[15px] text-gray-700">
            재조정 대상 {referral.referralNumber} · {referral.organizationName} · {referral.examType} ·
            기존 예약 {formatDateTimeWithWeekday(referral.scheduledAt)}
          </p>
          <p className="mt-0.5 text-sm text-gray-500">
            검사 유형은 기존 예약과 같게 고정됩니다. 기존 예약은 자동으로 삭제되지 않습니다.
          </p>
          {excludedEquipments.length > 0 && (
            <p className="mt-0.5 text-sm text-gray-500">
              장애 장비({referral.organizationName}{" "}
              {excludedEquipments.map(({ equipmentName }) => equipmentName).join(", ")})의 슬롯은 대체
              후보에서 제외됩니다.
            </p>
          )}
        </div>
      </div>
      <Link
        href={ROUTES.referring.notifications}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
      >
        재조정 화면으로 돌아가기
      </Link>
    </div>
  );
}

function ResultMessage({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] ${
        tone === "error" ? "text-red-600" : "text-gray-500"
      }`}
    >
      {children}
    </p>
  );
}
