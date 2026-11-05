import "server-only";

import { unstable_rethrow } from "next/navigation";

import { fetchEquipmentPage, EQUIPMENT_PAGE_MAX_SIZE } from "@/features/equipment/remote";
import { fetchMyPartnershipList } from "@/features/partnerships/remote";
import { EXAM_TYPE_MAX_PAGE_SIZE, fetchExamTypePage, type ExamTypeDto } from "@/features/referrals/remote";
import { isApiFeature, type ApiFeature } from "@/lib/api/config";
import { isApiError } from "@/lib/api/errors";
import { requireRoleAccess, toRoleAccessFailure } from "@/lib/auth/session";
import { addDays, getSeoulNow, type DateKey } from "@/lib/date/seoulDate";

import { API_SEARCH_MAX_LOOKAHEAD_DAYS } from "./apiSearchClient";
import {
  buildApiDateAvailability,
  buildSlotSearchMetadata,
  collectAllPages,
  collectSlicePages,
  mapApiSlots,
  mapWithConcurrency,
  splitSearchRange,
  toPartnerOrganizations,
  type ApiExamSlot,
  type SliceCollectResult,
  type SlotSearchWindow,
} from "./apiSlots";
import { getSlotSearchErrorMessage, getSlotSearchFailureReason, isSlotApiId, searchSlots, SLOT_SEARCH_MAX_SIZE, type SlotDetailDto } from "./remote";
import type { ExamType, PartnerOrganization } from "./types";

/**
 * 의뢰기관 슬롯 검색 데이터 (서버 전용, 조회만).
 * 화면(SlotSearch, Client Component)은 GET Route Handler `/referring/slots/search`(slots/searchRoute.ts)를 거쳐 이 함수를 쓴다.
 *
 * 순서: 기능 설정 → users/me로 REQUESTER 확인 → 입력 확인 → 협약(ACTIVE) → 검사 유형·장비(병렬) → 슬롯 검색(모든 페이지) → 매핑
 * - 기관 범위는 서버가 정한다. 브라우저가 보낸 institutionId는 ACTIVE 협력 기관일 때만 검색 조건으로 쓴다
 * - 장비는 협력 기관별 목록(GET /institutions/{id}/equipments)으로 받는다: 요청 수 = 기관 수 × 장비 페이지 수 (슬롯 수와 무관)
 * - 실패하면 Mock·빈 목록으로 대신하지 않고 실패 결과를 돌려준다. 로그에는 종류·상태·코드만 남긴다 (토큰·응답 본문 없음)
 * - 결과는 요청마다 새로 조회한다 (사용자 간 공유 캐시에 두지 않는다)
 */

/** 검색에 필요한 기능 (협약·장비·검사 유형 API가 함께 켜져 있어야 한다. 검사 유형 목록은 equipment 기능으로도 열린다) */
const REQUIRED_FEATURES: readonly ApiFeature[] = ["slots", "partnerships", "equipment"];
/** 한 검색 구간(31일)에서 받을 최대 슬롯 페이지 (100건 × 10). 넘으면 일부만 보여 주지 않고 조건을 좁히라고 안내한다 */
const MAX_SLOT_PAGES = 10;
/** 검사 유형·기관별 장비 목록 최대 페이지 (100건 단위) */
const MAX_LIST_PAGES = 20;
/** 기관별 장비 목록 동시 요청 수 */
const EQUIPMENT_CONCURRENCY = 4;

/** 검색에 필요한 API 기능이 모두 켜져 있는지 (화면이 '준비 중'과 실제 검색을 고를 때 쓴다) */
export function isApiSlotSearchAvailable(): boolean {
  return REQUIRED_FEATURES.every((feature) => isApiFeature(feature));
}

/**
 * 검색 조건 선택지(ACTIVE 협력 검사기관)만 조회 (화면 첫 렌더링용). 요청 1건: GET /partnerships/me?status=ACTIVE
 * 순서는 loadApiSlotSearch와 같다: 기능 설정 → users/me로 REQUESTER 확인 → 조회
 */
export async function loadApiSlotSearchOrganizations(): Promise<
  { ok: true; organizations: PartnerOrganization[] } | SlotSearchLoadFailure
> {
  if (!isApiSlotSearchAvailable()) {
    return { ok: false, reason: "NOT_AVAILABLE", message: "슬롯 검색 API가 아직 연결되지 않았습니다." };
  }
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };
  try {
    const partnerships = await fetchMyPartnershipList({ status: "ACTIVE" }, { headers: access.headers });
    return { ok: true, organizations: toPartnerOrganizations(partnerships) };
  } catch (error) {
    unstable_rethrow(error);
    return toSlotSearchFailure(error);
  }
}

export type SlotSearchLoadFailureReason =
  | "NOT_AVAILABLE"
  | "SIGNED_OUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_REQUEST"
  | "CONFLICT"
  | "NETWORK"
  | "TIMEOUT"
  | "SERVER_ERROR"
  | "INVALID_RESPONSE"
  | "METADATA_MISSING"
  | "METADATA_MISMATCH"
  | "INVALID_TIME"
  | "TOO_MANY_RESULTS"
  | "ERROR";

export type SlotSearchLoadFailure = { ok: false; reason: SlotSearchLoadFailureReason; message: string };

export interface ApiSlotSearchInput {
  /** 서울 날짜 `YYYY-MM-DD` (포함) */
  startDate: DateKey;
  /** 서울 날짜 `YYYY-MM-DD` (제외). startDate부터 최대 31일 */
  endDateExclusive: DateKey;
  /** 검사기관 UUID (ACTIVE 협력 기관만) */
  institutionId?: string;
  /** 검사 유형 UUID (서버 검색 조건) */
  examTypeId?: string;
  /** 화면의 CT/MRI 조건. 서버 검색 조건이 아니라 받은 결과를 검사 유형의 modality로 거른다 */
  modality?: ExamType;
}

export type ApiSlotSearchResult =
  | {
      ok: true;
      /** 검색 조건 선택지: ACTIVE 협력 검사기관 (이름순) */
      organizations: PartnerOrganization[];
      /** 검색 조건 선택지: 검사 유형 전체 (UUID·이름·modality) */
      examTypes: ExamTypeDto[];
      /** 조건에 맞는 예약 가능 슬롯 전체 (모든 페이지, 서울 시작 시각순) */
      slots: ApiExamSlot[];
      /** 날짜별 예약 가능 슬롯 수 (없는 날짜 = 예약 가능한 슬롯 없음. 마감과 슬롯 없음은 구분하지 않는다) */
      availability: Record<DateKey, number>;
      window: SlotSearchWindow;
      /** 이번 조회의 Gateway 요청 수 (users/me 제외) */
      requestCount: number;
    }
  | SlotSearchLoadFailure;

/** 슬롯 검색 (31일 이하 한 구간). 긴 달력 범위는 splitSearchRange로 나눠 구간마다 부른다 */
export async function loadApiSlotSearch(input: ApiSlotSearchInput): Promise<ApiSlotSearchResult> {
  if (!REQUIRED_FEATURES.every((feature) => isApiFeature(feature))) {
    return { ok: false, reason: "NOT_AVAILABLE", message: "슬롯 검색 API가 아직 연결되지 않았습니다." };
  }
  const access = await requireRoleAccess("REFERRING");
  if (!access.ok) return { ok: false, ...toRoleAccessFailure(access) };

  const windows = splitSearchRange(input?.startDate, input?.endDateExclusive);
  if (!windows) return invalidInput("검색 기간이 올바르지 않습니다.");
  if (windows.length !== 1) return invalidInput("검색 기간은 최대 31일입니다.");
  const [window] = windows;
  const today = getSeoulNow().dateKey;
  if (window.startDate < addDays(today, -1)) return invalidInput("지난 날짜는 검색할 수 없습니다.");
  if (window.endDateExclusive > addDays(today, API_SEARCH_MAX_LOOKAHEAD_DAYS)) {
    return invalidInput("검색할 수 있는 기간을 벗어났습니다. 1년 이내의 날짜를 선택해 주세요.");
  }
  if (input.institutionId !== undefined && !isSlotApiId(input.institutionId)) return invalidInput("검사기관 ID 형식이 올바르지 않습니다.");
  if (input.examTypeId !== undefined && !isSlotApiId(input.examTypeId)) return invalidInput("검사 유형 ID 형식이 올바르지 않습니다.");
  if (input.modality !== undefined && input.modality !== "CT" && input.modality !== "MRI") return invalidInput("검사 종류가 올바르지 않습니다.");

  const options = { headers: access.headers };
  let requestCount = 0;
  try {
    requestCount++;
    const organizations = toPartnerOrganizations(await fetchMyPartnershipList({ status: "ACTIVE" }, options));
    const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (input.institutionId !== undefined && !organizations.some((item) => sameId(item.id, input.institutionId!))) {
      return invalidInput("협약 중인 검사기관이 아닙니다. 검사기관을 다시 선택해 주세요.");
    }
    const targets = input.institutionId !== undefined ? organizations.filter((item) => sameId(item.id, input.institutionId!)) : organizations;

    const [examTypes, equipmentLists] = await Promise.all([
      collectAllPages((page) => {
        requestCount++;
        return fetchExamTypePage({ page, size: EXAM_TYPE_MAX_PAGE_SIZE }, options);
      }, MAX_LIST_PAGES),
      mapWithConcurrency(targets, EQUIPMENT_CONCURRENCY, (organization) =>
        collectAllPages((page) => {
          requestCount++;
          return fetchEquipmentPage(organization.id, { page, size: EQUIPMENT_PAGE_MAX_SIZE }, options);
        }, MAX_LIST_PAGES),
      ),
    ]);
    // 기관별 장비 목록에 다른 기관 장비가 섞이면 계약 위반 (기관 ID를 잘못 연결하지 않는다)
    if (targets.some((organization, index) => equipmentLists[index].some((item) => !sameId(item.institutionId, organization.id)))) {
      return logged({ ok: false, reason: "METADATA_MISMATCH", message: "검사기관과 장비 정보가 맞지 않습니다. 잠시 후 다시 시도해 주세요." });
    }

    if (input.examTypeId !== undefined) {
      const examType = examTypes.find((item) => sameId(item.id, input.examTypeId!));
      if (!examType) return invalidInput("검사 유형을 찾을 수 없습니다. 검사 유형을 다시 선택해 주세요.");
      if (input.modality !== undefined && examType.modality !== input.modality) return invalidInput("검사 종류와 검사 유형이 맞지 않습니다.");
    }

    const built = buildSlotSearchMetadata({ organizations, examTypes, equipments: equipmentLists.flat() });
    if (!built.ok) return logged(built);

    // 협력 기관이 없으면 서버 검색 결과도 비어 있다 (서버가 협약 기관 장비로 제한한다). 요청하지 않는다
    let found: SliceCollectResult<SlotDetailDto> = { ok: true, items: [], pages: 0 };
    if (organizations.length > 0) {
      found = await collectSlicePages((page) => {
        requestCount++;
        return searchSlots(
          { from: window.from, to: window.to, institutionId: input.institutionId, examTypeId: input.examTypeId, page, size: SLOT_SEARCH_MAX_SIZE },
          options,
        );
      }, MAX_SLOT_PAGES);
    }
    if (!found.ok) {
      return { ok: false, reason: "TOO_MANY_RESULTS", message: "검색 결과가 너무 많아 모두 불러오지 못했습니다. 기간이나 조건을 좁혀 주세요." };
    }

    const mapped = mapApiSlots(found.items, built.metadata);
    if (!mapped.ok) return logged(mapped);
    const slots = input.modality ? mapped.slots.filter((slot) => slot.examType === input.modality) : mapped.slots;
    return {
      ok: true,
      organizations,
      examTypes,
      slots,
      availability: buildApiDateAvailability(slots, { examType: "", organizationId: "", timeOfDay: "" }),
      window,
      requestCount,
    };
  } catch (error) {
    unstable_rethrow(error);
    return toSlotSearchFailure(error);
  }
}

const invalidInput = (message: string): SlotSearchLoadFailure => ({ ok: false, reason: "INVALID_INPUT", message });

function logged(failure: SlotSearchLoadFailure): SlotSearchLoadFailure {
  console.error(`[slots] 검색 데이터 매핑 실패: ${failure.reason}`);
  return failure;
}

/** 조회 실패 → 화면 안내 (토큰·응답 본문은 담지 않는다) */
function toSlotSearchFailure(error: unknown): SlotSearchLoadFailure {
  const failure = getSlotSearchFailureReason(error);
  if (failure !== "UNAUTHORIZED") {
    console.error("[slots] 검색 데이터 조회 실패:", isApiError(error) ? `${error.kind} ${error.status ?? ""} ${error.code ?? ""}` : "unknown");
  }
  const reason: SlotSearchLoadFailureReason =
    failure === "NOT_SENT" ? "ERROR" : failure === "ABORTED" ? "NETWORK" : failure;
  const message =
    failure === "UNAUTHORIZED"
      ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요."
      : failure === "NOT_SENT"
        ? "슬롯 검색 조건을 처리하지 못했습니다."
        : getSlotSearchErrorMessage(error);
  return { ok: false, reason, message };
}
