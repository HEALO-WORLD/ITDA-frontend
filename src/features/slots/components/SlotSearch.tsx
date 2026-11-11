"use client";

import { AlertTriangle, ArrowRight, Building2, CalendarClock, CheckCircle2, RefreshCw, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import { ROUTES } from "@/constants/navigation";
import ReferralCreateForm from "@/features/referrals/components/ReferralCreateForm";
import ApiReferralCreateForm from "@/features/referrals/components/ApiReferralCreateForm";
import ApiRescheduleConfirm from "@/features/referrals/components/ApiRescheduleConfirm";
import RescheduleSlotConfirm from "@/features/referrals/components/RescheduleSlotConfirm";
import RescheduleWizardSteps from "@/features/referrals/components/RescheduleWizardSteps";
import type { ApiRescheduleTarget, ApiRescheduleTargetResult } from "@/features/referrals/rescheduleTarget";
import type { ReferralDraft, ReferralSummary } from "@/features/referrals/types";
import { useSlotDataKey } from "@/features/equipment/useLiveEquipments";
import { useFailedEquipmentIds } from "@/features/incidents/useMockIncidents";
import type { RescheduleCause } from "@/features/notifications/types";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { addDays, getSeoulNow, type DateKey } from "@/lib/date/seoulDate";

import { IS_MOCK_DATA, searchSlots } from "../api";
import {
  API_SEARCH_RANGE_DAYS,
  createLatestGuard,
  fetchApiSlotSearch,
  filterApiSearchResults,
  getCriteriaSearchWindow,
  type SearchDateWindow,
  type SlotSearchClientFailure,
} from "../apiSearchClient";
import type { ApiExamSlot } from "../apiSlots";
import type { SlotExamTypeOption } from "../examTypeFilter";
import { useMockSlotExamTypes } from "../useMockSlotExamTypes";
import { isAutoSearchScreen, isPcViewport, scheduleInitialSearch } from "../initialSearch";
import { MOCK_EXAM_TYPES } from "@/lib/dev/mockExamTypes";
import type { ExamSlot, PartnerOrganization, SlotSearchCriteria } from "../types";
import {
  countAvailableSlotsByDate,
  getResultDateRange,
  groupSlotCards,
  resolveResultDate,
} from "../slotResultGroups";

import SlotSearchFilter, { INITIAL_SLOT_CRITERIA } from "./SlotSearchFilter";
import SlotResultCalendar from "./SlotResultCalendar";
import SlotSearchTable from "./SlotSearchTable";
import SlotTimeCards from "./SlotTimeCards";

interface SlotSearchProps {
  organizations: PartnerOrganization[];
  /**
   * 재조정 대상 예약. 있으면 신규 의뢰 대신 대체 슬롯 선택 모드로 동작한다.
   * 쿼리에 대상이 있었지만 찾지 못했거나 재조정 대상이 아니면 "INVALID"
   */
  rescheduleTarget?: ReferralSummary | "INVALID" | null;
  /** 재조정 대상 예약의 장애 장비. 재조정 모드에서만 검색·달력에서 제외한다 */
  failedEquipments?: RescheduleCause[];
  /**
   * 데이터 출처. mock(기본): 기존 Mock 데모. api: 실제 슬롯 검색 (Route Handler `/referring/slots/search` 경유).
   * API 모드에서는 Mock 검색·Mock 의뢰 생성(ReferralCreateForm)을 쓰지 않는다
   */
  dataSource?: "mock" | "api";
  /** API 모드에서 재조정 대상(?rescheduleReferralId)이 있었지만 재예약 기능(referrals)이 API 대상이 아닐 때: 연결되지 않았다고 안내한다 */
  isApiRescheduleRequested?: boolean;
  /**
   * API 재조정 모드: 서버가 조회한 대상 의뢰(NEEDS_RESCHEDULE 확인) 또는 조회 실패. null이면 일반 검색.
   * 대상이 있으면 검사 유형을 의뢰 값으로 고정하고, 슬롯 선택 시 ApiRescheduleConfirm(후보 확인 → 재예약 요청)을 연다
   */
  apiReschedule?: ApiRescheduleTargetResult | null;
  /** API 모드 세부 검사 항목 선택지 (서버가 조회한 협력 기관 장비의 지원 검사 유형). null = 조회 실패. Mock 모드는 개발용 장비에서 계산한다 */
  examTypeOptions?: SlotExamTypeOption[] | null;
  /**
   * 재조정·알림 화면의 대화상자 안에서 쓸 때: 페이지용 재조정 안내 배너(다른 화면으로 가는 링크 포함)를 숨긴다
   * (대화상자가 기존 예약 정보를 따로 보여 준다). 검색·선택·확인·재예약 동작은 같다
   */
  embedded?: boolean;
  /**
   * PC(xl) 예약 재조정 모달 (재조정·알림 대화상자, embedded + 재조정 대상): 한 모달 안에서 3단계로 진행한다.
   * 1·2단계: 왼쪽 기존 예약(existing) + 선택한 대체 슬롯, 오른쪽 조건 칩·달력·시간 카드 (열면 기본 조건으로 한 번 자동 검색)
   * 3단계: 같은 모달에서 변경 내용 비교·재조정 요청·상태 확인 (ApiRescheduleConfirm inline)
   * 모달을 열 때 PC가 아니면(모바일) 기존 구조(전체 폼·표 + 확인 모달)를 그대로 쓴다
   */
  rescheduleWizard?: {
    existing: ReactNode;
    /** 모달 닫기 (취소·닫기 버튼) */
    onClose: () => void;
    /** 재조정 요청 중에는 모달이 닫히지 않게 상위에 알린다 */
    onBusyChange: (busy: boolean) => void;
  };
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  /** examTypeSelected: 이 결과를 세부 검사 항목을 골라 검색했는지 (빈 결과 안내용) */
  /** criteria: 이 결과를 만든 검색 조건 (PC 결과 요약 표시용, 검색 동작에는 쓰지 않는다) */
  | { status: "success"; slots: ExamSlot[]; window?: SearchDateWindow; examTypeSelected?: boolean; criteria?: SlotSearchCriteria }
  /** failure: API 모드 실패 구분 (Mock 모드는 없음) */
  | { status: "error"; failure?: SlotSearchClientFailure };

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
  dataSource = "mock",
  isApiRescheduleRequested = false,
  apiReschedule = null,
  examTypeOptions: apiExamTypeOptions = null,
  embedded = false,
  rescheduleWizard,
}: SlotSearchProps) {
  const isApi = dataSource === "api";
  const mockExamTypeOptions = useMockSlotExamTypes(organizations, !isApi);
  const examTypeOptions = isApi ? apiExamTypeOptions : mockExamTypeOptions;
  /** API 재조정 대상 (조회 성공일 때만) */
  const latestApiTarget = isApi && apiReschedule?.ok ? apiReschedule.target : null;
  /**
   * 이 화면에서 확인한 재조정 대상을 유지한다: 재조정 요청이 접수되면(결과 불명 포함) Server Function의 refresh()로 대상을 다시 조회하는데,
   * 의뢰가 더 이상 재조정 필요 상태가 아니라 조회가 실패해도 일반 검색(새 검사 의뢰)으로 바꾸지 않고 진행 상태 확인 화면을 이어서 보여 준다.
   * 같은 의뢰(key)일 때만 유지된다. 이 대상으로 다시 요청해도 서버가 후보 확인에서 다시 막는다(REFERRAL_NOT_RESCHEDULABLE)
   */
  const [heldApiTarget, setHeldApiTarget] = useState(latestApiTarget);
  if (latestApiTarget && latestApiTarget !== heldApiTarget) setHeldApiTarget(latestApiTarget);
  const apiTarget = latestApiTarget ?? heldApiTarget;
  /**
   * 재조정 시 고정할 세부 검사 항목: API는 의뢰의 examTypeId(서버 검색 조건으로도 고정), Mock은 Mock 의뢰의 항목.
   * Mock 의뢰에 항목이 없으면 기존처럼 CT·MRI만 고정한다
   */
  const mockRescheduleItem =
    !isApi && rescheduleTarget && rescheduleTarget !== "INVALID" && rescheduleTarget.examTypeId
      ? MOCK_EXAM_TYPES.find((type) => type.id === rescheduleTarget.examTypeId)
      : undefined;
  const lockedExamTypeItem = apiTarget
    ? { id: apiTarget.examTypeId, name: apiTarget.examTypeName ?? "기존 의뢰의 검사 항목" }
    : mockRescheduleItem
      ? { id: mockRescheduleItem.id, name: mockRescheduleItem.name }
      : null;
  /** API 검색: 가장 최근 요청만 반영 (이전 요청은 취소) */
  const [apiGuard] = useState(createLatestGuard);
  useEffect(() => () => apiGuard.cancel(), [apiGuard]);
  const rescheduleReferral =
    rescheduleTarget && rescheduleTarget !== "INVALID" ? rescheduleTarget : null;
  // 일반 검색에는 제외 조건을 적용하지 않는다
  const excludedEquipments = rescheduleReferral ? failedEquipments : NO_EXCLUDED_EQUIPMENTS;
  const excludedEquipmentIds = useMemo(
    () => excludedEquipments.map(({ equipmentId }) => equipmentId),
    [excludedEquipments],
  );
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  /**
   * PC 결과 달력에서 고른 날짜 (화면 상태, 요청 없음). 새 검색이 성공할 때만 첫 예약 가능 날짜(날짜 지정 검색이면 그 날짜)로 정하고,
   * 예약 접수 뒤 같은 조건 재검색·Mock 데이터 갱신으로 결과가 바뀌어도 그대로 둔다 (그날 슬롯이 없어지면 빈 결과 안내)
   */
  const [resultDate, setResultDate] = useState<DateKey | "">("");
  /**
   * PC(xl) 슬롯 검색 화면: 처음 검색이 성공하면 검색 조건을 '조건 칩 줄'로 줄인다 (칩을 눌러 바로 고치고 [검색 적용]).
   * 칩과 전체 입력 폼은 SlotSearchFilter의 같은 입력 상태를 쓴다 (따로 상태를 두지 않음). [초기화]하면 다시 전체 폼.
   * 대화상자(embedded)·xl 미만에서는 항상 전체 폼
   */
  /**
   * 기본 조건 자동 검색 화면 (검색 화면의 일반 검색). PC에서는 처음부터 조건 칩 줄로 시작하고 마운트 시 기본 조건으로 한 번 검색한다.
   * 재조정 모드·대화상자는 기존처럼 전체 폼 + [슬롯 검색]. 모바일은 칩 줄이 xl에서만 보이므로 기존 전체 폼 그대로
   */
  const isAutoSearchMode = isAutoSearchScreen({ embedded, isRescheduleMode: rescheduleReferral !== null || apiTarget !== null });
  const [isFilterCompact, setFilterCompact] = useState(isAutoSearchMode);
  /**
   * PC 재조정 단계 모달인지: 열 때(마운트 시) 화면 폭으로 정하고 진행 중에는 바꾸지 않는다 (창 크기를 바꿔도 단계 진행이 끊기지 않게)
   */
  const [isWizard] = useState(
    () => embedded && Boolean(rescheduleWizard) && (rescheduleReferral !== null || apiTarget !== null) && isPcViewport(),
  );
  const [wizardStep, setWizardStep] = useState<"select" | "confirm">("select");
  /** 2단계에서 고른 대체 슬롯 (원본 슬롯 그대로, 3단계 확인·요청에 slot.id를 넘긴다). 새 검색을 하면 비운다 */
  const [wizardSlot, setWizardSlot] = useState<ExamSlot | null>(null);
  /** 3단계를 열 때마다 늘려 확인·요청 상태를 처음부터 시작한다 */
  const [confirmRound, setConfirmRound] = useState(0);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const focusNextOnSelectRef = useRef(false);
  /** Mock 검색: 가장 최근 검색만 반영 (자동 검색·검색 적용·초기화가 겹쳐도 오래된 결과가 덮어쓰지 않게) */
  const [mockGuard] = useState(createLatestGuard);
  useEffect(() => () => mockGuard.cancel(), [mockGuard]);
  /** API 재조정 확인 대화상자의 회차 (슬롯을 고를 때마다 늘려 확인 상태를 새로 시작한다) */
  const [rescheduleRound, setRescheduleRound] = useState(0);
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
    if (!isApi && requestedSlot && failedEquipmentIds.has(requestedSlot.equipmentId)) {
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
    // API 모드: Mock 저장소 변경으로 실제 결과를 Mock 검색 결과로 바꾸지 않는다
    if (isApi) return;
    const criteria = lastCriteriaRef.current;
    if (!criteria) return;
    let isCurrent = true;
    searchSlots(criteria, { excludedEquipmentIds })
      .then((slots) => {
        if (isCurrent) setSearch((prev) => (prev.status === "success" ? { ...prev, slots } : prev));
      })
      .catch(() => { });
    return () => {
      isCurrent = false;
    };
  }, [slotDataKey, excludedEquipmentIds, isApi]);

  // 모달(자식)이 닫힌 뒤 안내로 포커스를 옮긴다
  useEffect(() => {
    if (interruptedNotice) noticeRef.current?.focus();
  }, [interruptedNotice]);

  /**
   * API 모드 검색: 날짜를 고르면 그 날짜 하루, 없으면 오늘부터 31일 (서울 기준).
   * 검사기관·CT/MRI는 서버 조건으로 보내고, 시간대는 받은 결과에서 거른다. 실패하면 Mock 결과를 보이지 않는다
   */
  /** PC 슬롯 검색 화면에서만 조건 칩 줄로 바꾼다 (포커스는 SlotSearchFilter가 [검색 적용]으로 옮긴다) */
  const collapseFilter = () => {
    if (!embedded) setFilterCompact(true);
  };

  const runApiSearch = async (criteria: SlotSearchCriteria, isNewSearch: boolean) => {
    const { signal, isLatest } = apiGuard.start();
    setSearch({ status: "loading" });
    const window = getCriteriaSearchWindow(criteria.date, getSeoulNow().dateKey);
    const result = await fetchApiSlotSearch(
      {
        ...window,
        institutionId: criteria.organizationId || undefined,
        modality: criteria.examType || undefined,
        // 세부 검사 항목: 재조정은 의뢰의 항목으로 고정(같은 CT·MRI라도 다른 항목은 제외), 일반 검색은 고른 항목
        examTypeId: apiTarget?.examTypeId ?? (criteria.examTypeId || undefined),
      },
      { signal },
    );
    if (!isLatest()) return; // 더 최근 검색·초기화가 있으면 반영하지 않는다
    if (result.ok) {
      const slots = filterApiSearchResults(result.slots, criteria, getSeoulNow().dateTime);
      setSearch({ status: "success", slots, window, examTypeSelected: Boolean(criteria.examTypeId) && !apiTarget, criteria });
      setResultDate((previous) => resolveResultDate({ previous, isNewSearch, slots, range: window, criteriaDate: criteria.date }));
      if (isNewSearch) collapseFilter();
    } else if (result.reason !== "ABORTED") {
      setSearch({ status: "error", failure: result });
    }
  };

  /** 검색 조건의 처음 값 (재조정: 기존 예약의 검사 유형·세부 검사 항목 고정). 초기화·자동 검색도 이 값으로 */
  const filterInitialCriteria: SlotSearchCriteria | undefined = rescheduleReferral
    ? { ...INITIAL_SLOT_CRITERIA, examType: rescheduleReferral.examType, examTypeId: lockedExamTypeItem?.id ?? "" }
    : apiTarget
      ? { ...INITIAL_SLOT_CRITERIA, examType: apiTarget.modality ?? "", examTypeId: apiTarget.examTypeId }
      : undefined;

  const handleSearch = async (criteria: SlotSearchCriteria) => {
    lastCriteriaRef.current = criteria;
    // 재조정 단계 모달: 새 검색이면 고른 대체 슬롯을 비운다 (새 결과에서 다시 고른다)
    if (isWizard) setWizardSlot(null);
    setInterruptedNotice(null);
    if (isApi) return runApiSearch(criteria, true);
    const { isLatest } = mockGuard.start();
    setSearch({ status: "loading" });
    try {
      const slots = await searchSlots(criteria, { excludedEquipmentIds });
      if (!isLatest()) return; // 더 최근 검색·초기화가 있으면 반영하지 않는다
      setSearch({ status: "success", slots, examTypeSelected: Boolean(criteria.examTypeId) && !rescheduleReferral, criteria });
      setResultDate((previous) =>
        resolveResultDate({ previous, isNewSearch: true, slots, range: getResultDateRange(slots, { criteriaDate: criteria.date }), criteriaDate: criteria.date }),
      );
      collapseFilter();
    } catch {
      if (isLatest()) setSearch({ status: "error" });
    }
  };

  // PC 최초 자동 검색: 마운트 시 한 번만 기본 조건으로 (조건이 바뀌어도 다시 검색하지 않는다).
  // 최신 handleSearch는 ref로 읽는다. Strict Mode의 '실행 → 정리 → 재실행'에서도 요청은 한 번 (scheduleInitialSearch)
  const handleSearchRef = useRef(handleSearch);
  useEffect(() => {
    handleSearchRef.current = handleSearch;
  });
  // 재조정 단계 모달(PC): 대상 의뢰·검색 선택지 조회와 대상 검증이 끝난 뒤에만 이 컴포넌트가 그려지므로, 마운트 시 기존 예약 조건으로 한 번 검색한다
  // (모달을 닫으면 언마운트되어 다시 열 때 최신 슬롯을 새로 조회한다)
  useEffect(() => {
    if (isWizard) return scheduleInitialSearch(() => void handleSearchRef.current(filterInitialCriteria ?? INITIAL_SLOT_CRITERIA));
    if (!isAutoSearchMode || !isPcViewport()) return;
    return scheduleInitialSearch(() => void handleSearchRef.current(INITIAL_SLOT_CRITERIA));
    // 마운트 시 한 번만 (재조정 대상이 바뀌면 상위가 key로 새로 마운트한다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (wizardStep !== "select" || !focusNextOnSelectRef.current) return;
    focusNextOnSelectRef.current = false;
    nextButtonRef.current?.focus();
  }, [wizardStep]);

  /** 재조정 단계 모달: 시간 버튼 = 대체 슬롯 고르기 (확인 모달을 바로 열지 않는다) */
  const selectWizardSlot = (slotId: string) => {
    if (search.status !== "success") return;
    const slot = search.slots.find((item) => item.id === slotId);
    if (slot?.isAvailable) setWizardSlot(slot);
  };

  /**
   * 검색 결과에서 슬롯을 찾아 의뢰 생성 모달을 연다 (예약 가능 여부는 제출 시 다시 검증).
   * 장애로 중단된 요청의 입력이 있으면 복원한다
   */
  const handleRequestReservation = (slotId: string) => {
    if (search.status !== "success") return;
    // API 모드: 실제 슬롯을 실제 의뢰 생성(ApiReferralCreateForm)으로 넘긴다 (Mock 입력 복원은 쓰지 않는다)
    if (isApi) {
      const apiSlot = search.slots.find((item) => item.id === slotId) ?? null;
      if (apiSlot) {
        apiRequestCreatedRef.current = false;
        setRescheduleRound((round) => round + 1);
        setRequestedSlot(apiSlot);
      }
      return;
    }
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
  /** API 모드 의뢰 모달: 요청 중이면 닫지 않는다. 접수됐으면 닫을 때 같은 조건으로 다시 검색한다 (그 슬롯은 더는 예약 가능이 아닐 수 있다) */
  const apiRequestBusyRef = useRef(false);
  const apiRequestCreatedRef = useRef(false);
  const closeApiRequest = () => {
    if (!requestedSlot || apiRequestBusyRef.current) return;
    setRequestedSlot(null);
    const criteria = lastCriteriaRef.current;
    // 접수 뒤 같은 조건 재검색: 새 검색이 아니므로 고른 날짜를 유지한다
    if (apiRequestCreatedRef.current && criteria) void runApiSearch(criteria, false);
  };

  const closeRequest = () => {
    if (!requestedSlot) return;
    setRequestedSlot(null);
    setDraft(EMPTY_DRAFT);
    setPreservedDraft(null);
    setIsDraftRestored(false);
  };

  const filterElement = (
    <SlotSearchFilter
      id="slot-search-filter"
      // PC 슬롯 검색 화면: 협력 검사기관부터, 검색 뒤에는 조건 칩 줄 (칩 수정은 [검색 적용]을 눌러야 결과에 반영)
      orgFirst={!embedded || isWizard}
      compact={isWizard || (!embedded && isFilterCompact)}
      surface={isWizard ? "wizard" : "default"}
      appliedCriteria={search.status === "success" ? search.criteria : undefined}
      organizations={organizations}
      isSearching={search.status === "loading"}
      onSearch={handleSearch}
      onReset={() => {
        setPreservedDraft(null);
        // PC 자동 검색 화면·재조정 단계 모달: 기본 조건으로 되돌린 뒤 바로 다시 검색한다 (칩 줄 유지, 새 검색이라 첫 예약 가능 날짜를 고른다)
        if (isWizard) {
          void handleSearch(filterInitialCriteria ?? INITIAL_SLOT_CRITERIA);
          return;
        }
        if (isAutoSearchMode && isPcViewport()) {
          void handleSearch(INITIAL_SLOT_CRITERIA);
          return;
        }
        if (isApi) apiGuard.cancel();
        mockGuard.cancel();
        lastCriteriaRef.current = null;
        setInterruptedNotice(null);
        setSearch({ status: "idle" });
        setResultDate("");
        setFilterCompact(false);
      }}
      initialCriteria={filterInitialCriteria}
      isExamTypeLocked={rescheduleReferral !== null || apiTarget !== null}
      excludedEquipmentIds={excludedEquipmentIds}
      dataSource={dataSource}
      apiExamTypeId={apiTarget?.examTypeId}
      examTypeOptions={examTypeOptions}
      lockedExamTypeItem={lockedExamTypeItem}
    />
  );

  if (isWizard && rescheduleWizard) {
    const retrySearch = () => void handleSearch(lastCriteriaRef.current ?? filterInitialCriteria ?? INITIAL_SLOT_CRITERIA);
    return (
      <div className="flex flex-col gap-4">
        {/* 진행 단계 (본문 맨 위에 고정) */}
        <div className="sticky top-0 z-20 -mx-5 border-b border-line bg-white px-5 pb-3 sm:-mx-7 sm:px-7">
          <RescheduleWizardSteps current={wizardStep === "select" ? 2 : 3} />
        </div>

        {wizardStep === "select" ? (
          <>
            <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-5">
              {/* 1단계 정보: 슬롯을 고르는 동안에도 계속 보이는 기존 예약 + 고른 대체 슬롯 */}
              <aside aria-label="기존 예약과 선택한 대체 슬롯" className="sticky top-14 flex flex-col gap-3">
                {rescheduleWizard.existing}
                <SelectedSlotCard slot={wizardSlot} />
              </aside>

              <div className="flex min-w-0 flex-col gap-4">
                {filterElement}
                <section aria-labelledby="slot-result-title" className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id="slot-result-title" className="flex items-center gap-2.5 text-base font-semibold text-gray-900">
                      <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-mint" />
                      대체 슬롯 선택
                      {IS_MOCK_DATA && !isApi && (
                        <span className="rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                          개발용 예시 데이터
                        </span>
                      )}
                    </h3>
                    {search.status === "success" && (
                      <p className="rounded-full bg-brand-mint-soft px-3 py-1 text-sm font-medium text-brand-navy" aria-live="polite">
                        총 {search.slots.length}건의 검색 결과가 있습니다.
                      </p>
                    )}
                  </div>
                  {(search.status === "idle" || search.status === "loading") && (
                    <ResultMessage>기존 예약과 같은 검사 항목의 대체 슬롯을 검색하고 있습니다.</ResultMessage>
                  )}
                  {search.status === "error" && (
                    <div className="flex flex-col items-center gap-3">
                      {search.failure ? (
                        <ApiFailureMessage failure={search.failure} />
                      ) : (
                        <ResultMessage tone="error">검사 슬롯을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</ResultMessage>
                      )}
                      <button
                        type="button"
                        onClick={retrySearch}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 hover:border-line-strong"
                      >
                        <RotateCcw className="size-4" aria-hidden="true" />
                        다시 검색
                      </button>
                    </div>
                  )}
                  {search.status === "success" && isApi && search.window && (
                    <p className="text-sm text-gray-500">
                      검색 기간: {formatSearchWindow(search.window)} (한국 시간 기준, 예약 가능한 슬롯만 표시)
                    </p>
                  )}
                  {search.status === "success" &&
                    (search.slots.length > 0 ? (
                      <PcSlotResults
                        slots={search.slots}
                        window={search.window}
                        criteriaDate={search.criteria?.date ?? ""}
                        selectedDate={resultDate}
                        onSelectDate={setResultDate}
                        onRequestReservation={selectWizardSlot}
                        actionLabel="대체 슬롯으로 선택"
                        selectedSlotId={wizardSlot?.id}
                        variant="wizard"
                      />
                    ) : (
                      <ResultMessage>
                        {excludedEquipments.length > 0
                          ? "장애 장비를 제외하면 선택한 조건에 해당하는 대체 슬롯이 없습니다. 날짜나 검사기관을 바꿔 다시 검색해 주세요."
                          : isApi
                            ? "검색 기간에 선택한 조건으로 예약 가능한 검사 슬롯이 없습니다."
                            : "선택한 조건에 해당하는 검사 슬롯이 없습니다."}
                      </ResultMessage>
                    ))}
                </section>
              </div>
            </div>

            <WizardFooter>
              <button type="button" onClick={rescheduleWizard.onClose} className={wizardSecondaryButtonClass}>
                취소
              </button>
              <button
                ref={nextButtonRef}
                type="button"
                disabled={!wizardSlot}
                aria-describedby={wizardSlot ? undefined : "wizard-next-hint"}
                onClick={() => {
                  if (!wizardSlot) return;
                  setConfirmRound((round) => round + 1);
                  setWizardStep("confirm");
                }}
                className={wizardPrimaryButtonClass}
              >
                다음: 변경 내용 확인
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
              {!wizardSlot && (
                <span id="wizard-next-hint" className="sr-only">
                  대체 슬롯의 시간을 먼저 선택해 주세요.
                </span>
              )}
            </WizardFooter>
          </>
        ) : wizardSlot && isApi && apiTarget ? (
          // 3단계: 같은 모달 안에서 비교·요청·상태 확인 (상태 판단·요청·재조회는 기존 ApiRescheduleConfirm 그대로)
          <ApiRescheduleConfirm
            key={confirmRound}
            inline
            open
            target={apiTarget}
            slot={wizardSlot as ApiExamSlot}
            organizations={organizations}
            onCancel={rescheduleWizard.onClose}
            onBack={() => {
              focusNextOnSelectRef.current = true;
              setWizardStep("select");
            }}
            onBusyChange={rescheduleWizard.onBusyChange}
            onAccepted={() => {
              apiRequestCreatedRef.current = true;
            }}
          />
        ) : wizardSlot && rescheduleReferral ? (
          // Mock: 기존 확인 화면 그대로 (실제 요청 없음) + 슬롯 다시 선택
          <section aria-labelledby="mock-confirm-title" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="mock-confirm-title" className="text-lg font-bold text-gray-900">
                예약 변경 확인
              </h3>
              <button
                type="button"
                onClick={() => {
                  focusNextOnSelectRef.current = true;
                  setWizardStep("select");
                }}
                className={wizardSecondaryButtonClass}
              >
                ← 슬롯 다시 선택
              </button>
            </div>
            <RescheduleSlotConfirm
              referral={rescheduleReferral}
              slot={wizardSlot}
              excludedEquipmentIds={excludedEquipmentIds}
              onCancel={rescheduleWizard.onClose}
              inline
            />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className={embedded ? "flex flex-col gap-5" : "flex flex-col gap-8"}>
      {rescheduleReferral && !embedded && (
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

      {apiTarget && !embedded && <ApiRescheduleBanner target={apiTarget} />}
      {isApi && apiReschedule && !apiReschedule.ok && !heldApiTarget && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl bg-red-50 px-6 py-4 text-[15px] text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {apiReschedule.message} 일반 검사 슬롯 검색으로 표시합니다.
          </p>
          {apiReschedule.reason === "SIGNED_OUT" || apiReschedule.reason === "UNAUTHORIZED" ? (
            <Link href={ROUTES.login} className="shrink-0 font-semibold underline underline-offset-4">
              로그인 화면으로 이동
            </Link>
          ) : (
            <Link href={ROUTES.referring.notifications} className="shrink-0 font-semibold underline underline-offset-4">
              재조정·알림으로 이동
            </Link>
          )}
        </div>
      )}

      {isApiRescheduleRequested && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-6 py-4 text-[15px] text-amber-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            재조정 대체 슬롯 선택(재예약 요청)은 아직 이 화면에 연결되지 않았습니다. 일반 검사 슬롯 검색으로 표시합니다.
          </p>
          <Link
            href={ROUTES.referring.notifications}
            className="shrink-0 font-semibold underline underline-offset-4"
          >
            재조정·알림으로 이동
          </Link>
        </div>
      )}

      {/* PC(xl) 슬롯 검색 화면: 검색 조건(위) + 검색 결과(아래)를 하나의 카드로. xl 미만·대화상자는 기존처럼 두 카드 */}
      <div
        className={`flex flex-col ${embedded ? "gap-5" : "gap-8"} itda:xl:gap-0 itda:xl:rounded-xl itda:xl:border itda:xl:border-line itda:xl:bg-white itda:xl:shadow-card`}
      >
      {filterElement}

      <section
        aria-labelledby="slot-result-title"
        className="rounded-xl border border-line bg-white px-4 pb-5 pt-5 shadow-card sm:px-7 sm:pb-6 sm:pt-6 itda:xl:rounded-t-none itda:xl:border-0 itda:xl:shadow-none"
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 itda:gap-2.5">
            {/* 브랜드 범위에서만 보이는 민트 강조 막대 (장식) */}
            <span aria-hidden="true" className="hidden h-5 w-1 rounded-full bg-brand-mint itda:block" />
            <h2 id="slot-result-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
              검색 결과
            </h2>
            {IS_MOCK_DATA && !isApi && (
              <span className="rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                개발용 예시 데이터
              </span>
            )}
          </div>
          {search.status === "success" && (
            <p
              className="text-[15px] text-gray-600 itda:rounded-full itda:bg-brand-mint-soft itda:px-3 itda:py-1 itda:text-sm itda:font-medium itda:text-brand-navy"
              aria-live="polite"
            >
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
          // PC 자동 검색 화면: 첫 검색이 시작되기 전(하이드레이션 직후)에도 '검색 중'으로 보여 안내 문구가 깜빡이지 않게 한다 (xl에서만)
          <ResultMessage className={isAutoSearchMode ? "itda:xl:hidden" : undefined}>
            검색 조건을 선택한 후 검색 버튼을 눌러 주세요.
            {isApi && ` 날짜를 선택하지 않으면 오늘부터 ${API_SEARCH_RANGE_DAYS}일 동안의 슬롯을 검색합니다.`}
          </ResultMessage>
        )}
        {search.status === "idle" && isAutoSearchMode && (
          <ResultMessage className="hidden itda:xl:block">기본 조건으로 검사 슬롯을 검색하고 있습니다.</ResultMessage>
        )}
        {search.status === "loading" && (
          <ResultMessage>검사 슬롯을 검색하고 있습니다.</ResultMessage>
        )}
        {search.status === "error" &&
          (search.failure ? (
            <ApiFailureMessage failure={search.failure} />
          ) : (
            <ResultMessage tone="error">
              검사 슬롯을 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.
            </ResultMessage>
          ))}
        {search.status === "success" && ((isApi && search.window) || (!embedded && search.criteria)) && (
          // 결과 요약: 검색 기간(API) + PC(xl, 이 화면)에서만 실제 검색에 쓴 조건 칩. 좁은 화면·대화상자는 기존 기간 문구만
          <div className={`-mt-3 mb-4 flex-col gap-2 ${isApi && search.window ? "flex" : "hidden"} itda:xl:mt-0 itda:xl:mb-5 itda:xl:flex-row itda:xl:flex-wrap itda:xl:items-center itda:xl:gap-x-5 itda:xl:rounded-lg itda:xl:border itda:xl:border-line itda:xl:flex itda:xl:bg-brand-canvas itda:xl:px-4 itda:xl:py-3`}>
            {isApi && search.window && (
              <p className="text-sm text-gray-500 itda:xl:text-gray-600">
                검색 기간: {formatSearchWindow(search.window)} (한국 시간 기준, 예약 가능한 슬롯만 표시)
              </p>
            )}
            {/* 결과 요약: 마지막으로 검색을 실행한 조건 (위 조건 칩을 고쳐도 [검색 적용] 전까지 그대로) */}
            {!embedded && search.criteria && (
              <span className="hidden shrink-0 text-[13px] font-semibold text-gray-500 itda:xl:inline">적용된 조건</span>
            )}
            {!embedded && search.criteria && (
              <AppliedCriteria
                criteria={search.criteria}
                organizations={organizations}
                examTypeOptions={examTypeOptions}
                lockedExamTypeItem={lockedExamTypeItem}
                isApi={isApi}
              />
            )}
          </div>
        )}
        {search.status === "success" &&
          (search.slots.length > 0 ? (
            <>
              {!embedded && (
                // PC(xl ≥1280px) 슬롯 검색 화면: 왼쪽 결과 달력 + 오른쪽 선택한 날짜의 시간 카드 (xl 미만·대화상자는 아래 기존 표·카드)
                <PcSlotResults
                  slots={search.slots}
                  window={search.window}
                  criteriaDate={search.criteria?.date ?? ""}
                  selectedDate={resultDate}
                  onSelectDate={setResultDate}
                  onRequestReservation={handleRequestReservation}
                  actionLabel={rescheduleReferral || apiTarget ? "대체 슬롯 선택" : "예약 요청"}
                />
              )}
              <SlotSearchTable
                slots={search.slots}
                onRequestReservation={handleRequestReservation}
                actionLabel={rescheduleReferral || apiTarget ? "대체 슬롯 선택" : undefined}
                hideOnPc={!embedded}
              />
            </>
          ) : (
            <ResultMessage>
              {search.examTypeSelected
                ? "선택한 검사 항목으로 예약 가능한 검사 슬롯이 없습니다. 다른 검사 항목이나 날짜를 선택해 주세요."
                : excludedEquipments.length > 0
                ? "장애 장비를 제외하면 선택한 조건에 해당하는 대체 슬롯이 없습니다. 날짜나 검사기관을 바꿔 다시 검색해 주세요."
                : isApi
                  ? "검색 기간에 선택한 조건으로 예약 가능한 검사 슬롯이 없습니다."
                  : "선택한 조건에 해당하는 검사 슬롯이 없습니다."}
            </ResultMessage>
          ))}
      </section>
      </div>

      {isApi && apiTarget ? (
        // 대화상자(제목·하단 버튼 포함)는 ApiRescheduleConfirm이 그린다. 닫을 때도 같은 대화상자를 닫아 포커스를 돌려주고,
        // 슬롯을 새로 고를 때마다 key로 상태(확인·요청·상태 재조회)를 처음부터 시작한다
        <ApiRescheduleConfirm
          key={rescheduleRound}
          open={requestedSlot !== null}
          target={apiTarget}
          slot={requestedSlot as ApiExamSlot | null}
          organizations={organizations}
          onCancel={closeApiRequest}
          onBusyChange={(busy) => {
            apiRequestBusyRef.current = busy;
          }}
          onAccepted={() => {
            apiRequestCreatedRef.current = true;
          }}
        />
      ) : isApi ? (
        <Modal
          open={requestedSlot !== null}
          title="새 검사 의뢰"
          description="선택한 검사 슬롯으로 의뢰 정보를 입력합니다."
          closeOnBackdrop={false}
          onClose={closeApiRequest}
        >
          {requestedSlot && (
            // 일반 검색의 새 검사 의뢰 (재조정 모드는 위의 ApiRescheduleConfirm: 서로 다른 Server Function을 쓴다)
            <ApiReferralCreateForm
              slot={requestedSlot as ApiExamSlot}
              onCancel={closeApiRequest}
              onCreated={() => {
                apiRequestCreatedRef.current = true;
              }}
              onBusyChange={(busy) => {
                apiRequestBusyRef.current = busy;
              }}
            />
          )}
        </Modal>
      ) : rescheduleReferral ? (
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

/** API 재조정 모드 안내 (Mock RescheduleBanner와 같은 모양, 서버가 조회한 대상 의뢰 값만 쓴다) */
function ApiRescheduleBanner({ target }: { target: ApiRescheduleTarget }) {
  const current = target.currentReservation;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-soft px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-[17px] font-bold text-gray-900">기존 예약을 변경할 새로운 검사 슬롯을 선택해 주세요.</p>
          <p className="mt-1 text-[15px] text-gray-700">
            재조정 대상 · {target.examTypeName ?? "검사 유형 확인 불가"}
            {target.modality ? ` (${target.modality})` : ""}
            {current?.startTime ? ` · 기존 예약 ${formatDateTimeWithWeekday(current.startTime.slice(0, 16))}` : ""}
          </p>
          <p className="mt-0.5 text-sm text-gray-500">
            검사 유형은 기존 의뢰와 같게 고정됩니다. 슬롯을 고르면 서버에서 예약 가능 여부·장비 상태를 다시 확인합니다.
          </p>
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

/**
 * PC 결과: 받은 검색 결과를 날짜별로 나눠 달력에 건수를 보이고, 고른 날짜의 슬롯만 카드로 보인다 (추가 요청 없음).
 * 결과 전체를 카드로 한 번에 그리지 않는다. xl 미만에서는 숨긴다
 */
function PcSlotResults({
  slots,
  window,
  criteriaDate,
  selectedDate,
  onSelectDate,
  onRequestReservation,
  actionLabel,
  selectedSlotId,
  variant = "page",
}: {
  slots: ExamSlot[];
  window?: SearchDateWindow;
  criteriaDate: DateKey | "";
  selectedDate: DateKey | "";
  onSelectDate: (date: DateKey) => void;
  onRequestReservation: (slotId: string) => void;
  actionLabel: string;
  /** 재조정 모달: 고른 대체 슬롯 (시간 버튼에 선택 표시) */
  selectedSlotId?: string;
  /** page: 슬롯 검색 화면(xl에서만 보임). wizard: PC 재조정 모달 (모달을 PC에서 열었을 때만 그려지므로 항상 보이고, 모달 폭에 맞춰 작게) */
  variant?: "page" | "wizard";
}) {
  const range = useMemo(() => getResultDateRange(slots, { window, criteriaDate }), [slots, window, criteriaDate]);
  const availableCounts = useMemo(() => countAvailableSlotsByDate(slots), [slots]);
  const cards = useMemo(() => (selectedDate ? groupSlotCards(slots, selectedDate) : []), [slots, selectedDate]);
  if (!range || !selectedDate) return null;
  return (
    <div
      className={
        variant === "wizard"
          ? "grid grid-cols-[260px_minmax(0,1fr)] items-start gap-4"
          : "hidden xl:grid xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start xl:gap-6"
      }
    >
      <div className={variant === "wizard" ? "" : "xl:sticky xl:top-6"}>
        {/* 검색 기간이 바뀌면(새 검색) 달력 표시 월·키보드 위치를 새로 시작한다 */}
        <SlotResultCalendar
          key={`${range.startDate}~${range.endDateExclusive}`}
          range={range}
          availableCounts={availableCounts}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          isDateLocked={Boolean(criteriaDate)}
          compact={variant === "wizard"}
        />
      </div>
      <SlotTimeCards
        date={selectedDate}
        cards={cards}
        onRequestReservation={onRequestReservation}
        actionLabel={actionLabel}
        lockedDate={criteriaDate}
        selectedSlotId={selectedSlotId}
      />
    </div>
  );
}

const wizardPrimaryButtonClass =
  "inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-5 text-[15px] font-bold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400";
const wizardSecondaryButtonClass =
  "inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-white px-5 text-[15px] font-semibold text-gray-700 hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60";

/** PC 재조정 모달 하단 버튼 줄 (모달 본문 아래에 고정) */
function WizardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-5 -mb-5 mt-1 flex items-center justify-end gap-2 border-t border-line bg-white px-5 py-3 sm:-mx-7 sm:-mb-6 sm:px-7">
      {children}
    </div>
  );
}

/** PC 재조정 모달: 고른 대체 슬롯 (기존 예약 카드 아래). 고르기 전에는 안내만 */
function SelectedSlotCard({ slot }: { slot: ExamSlot | null }) {
  if (!slot) {
    return (
      <section
        aria-label="선택한 대체 슬롯"
        aria-live="polite"
        className="rounded-xl border border-dashed border-line-strong bg-brand-canvas px-4 py-4 text-sm text-gray-500"
      >
        <p className="font-semibold text-gray-600">선택한 대체 슬롯 <span className="font-normal text-gray-500">· 아직 선택하지 않음</span></p>
        <p className="mt-1">오른쪽 달력에서 날짜를 고르고 시간을 선택해 주세요.</p>
      </section>
    );
  }
  return (
    <section aria-label="선택한 대체 슬롯" aria-live="polite" className="rounded-xl border-2 border-brand-mint bg-brand-mint-soft px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-sm font-bold text-brand-mint-strong">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        선택한 대체 슬롯
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-lg font-bold leading-snug tabular-nums text-gray-900">
        <CalendarClock className="size-4 shrink-0 text-brand-navy/70" aria-hidden="true" />
        {formatDateTimeWithWeekday(slot.startAt)}
      </p>
      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 whitespace-nowrap text-gray-500">검사기관</dt>
          <dd className="min-w-0 text-gray-800 [overflow-wrap:anywhere]">{slot.organizationName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 whitespace-nowrap text-gray-500">검사 항목</dt>
          <dd className="min-w-0 text-gray-800 [overflow-wrap:anywhere]">
            {slot.examType} {slot.examTypeName ?? ""}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 whitespace-nowrap text-gray-500">장비</dt>
          <dd className="flex min-w-0 items-center gap-1 text-gray-800 [overflow-wrap:anywhere]">
            <Building2 className="size-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            {slot.equipmentName}
          </dd>
        </div>
      </dl>
    </section>
  );
}

const TIME_OF_DAY_TEXT = { AM: "오전", PM: "오후" } as const;

/**
 * PC 결과 요약: 이 결과를 만든 검색 조건 (화면의 현재 선택이 아니라 검색 버튼을 눌렀을 때의 값).
 * 이름은 이미 받은 협력 기관·세부 검사 항목 목록에서만 찾는다 (추가 요청 없음). xl 미만에서는 숨긴다
 */
function AppliedCriteria({
  criteria,
  organizations,
  examTypeOptions,
  lockedExamTypeItem,
  isApi,
}: {
  criteria: SlotSearchCriteria;
  organizations: PartnerOrganization[];
  examTypeOptions: readonly SlotExamTypeOption[] | null;
  lockedExamTypeItem: { id: string; name: string } | null;
  isApi: boolean;
}) {
  const examItemName = lockedExamTypeItem?.name
    ?? (criteria.examTypeId ? examTypeOptions?.find((option) => option.id === criteria.examTypeId)?.name : undefined);
  const items: { label: string; value: string }[] = [
    // 검색 조건 칩과 같은 순서 (협력 검사기관 → 검사 유형 → 세부 검사 항목 → 날짜 → 시간대)
    {
      label: "협력 검사기관",
      value: criteria.organizationId
        ? (organizations.find((org) => org.id === criteria.organizationId)?.name ?? "선택한 기관")
        : "전체",
    },
    { label: "검사 유형", value: criteria.examType || "전체" },
    { label: "세부 검사 항목", value: examItemName ?? "전체" },
    { label: "검사 날짜", value: criteria.date || (isApi ? `오늘부터 ${API_SEARCH_RANGE_DAYS}일` : "전체 기간") },
    { label: "시간대", value: criteria.timeOfDay ? TIME_OF_DAY_TEXT[criteria.timeOfDay] : "전체" },
  ];
  return (
    <dl aria-label="적용한 검색 조건" className="hidden flex-wrap items-center gap-2 itda:xl:flex">
      {items.map(({ label, value }) => (
        <div key={label} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-[13px]">
          <dt className="text-gray-500">{label}</dt>
          <dd className="font-semibold text-gray-900">{value}</dd>
        </div>
      ))}
      {criteria.availableOnly && (
        <div className="inline-flex items-center rounded-md border border-brand-mint bg-brand-mint-soft px-2.5 py-1 text-[13px]">
          <dt className="sr-only">보기</dt>
          <dd className="font-semibold text-brand-mint-strong">예약 가능만</dd>
        </div>
      )}
    </dl>
  );
}

/** 검색 기간 표시: 종료일(제외)의 전날까지 */
function formatSearchWindow({ startDate, endDateExclusive }: SearchDateWindow): string {
  const lastDate = addDays(endDateExclusive, -1);
  return lastDate === startDate ? startDate : `${startDate} ~ ${lastDate}`;
}

/** API 모드 검색 실패 안내 (로그인 만료면 로그인 화면 링크) */
function ApiFailureMessage({ failure }: { failure: SlotSearchClientFailure }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] text-red-600 itda:border-red-200 itda:bg-red-50/40"
    >
      <p>{failure.message}</p>
      {failure.reason === "UNAUTHORIZED" && (
        <Link href={ROUTES.login} className="font-semibold text-primary underline underline-offset-4">
          로그인 화면으로 이동
        </Link>
      )}
    </div>
  );
}

function ResultMessage({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "error";
  /** 화면 폭별 표시 (예: PC에서만 숨김) */
  className?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] ${tone === "error" ? "text-red-600 itda:border-red-200 itda:bg-red-50/40" : "text-gray-500 itda:bg-brand-canvas itda:text-gray-600"
        }${className ? ` ${className}` : ""}`}
    >
      {children}
    </p>
  );
}
