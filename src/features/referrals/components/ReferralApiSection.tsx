import Link from "next/link";
import type { ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";

import { isExamTypeId, isPatientNameSearch, isReferralStatus, REFERRAL_STATUSES, type ReferralListSubject, type ReferralStatusDto } from "../remote";
import {
  loadExamTypes,
  loadReferralTablePage,
  type ExamTypeItem,
  type ExamTypeListLoadResult,
  type ReferralLoadFailure,
  type ReferralPageQuery,
} from "../server";

import ReferralApiFilter from "./ReferralApiFilter";
import ReferralApiTable, { toBadgeStatus } from "./ReferralApiTable";
import { REFERRAL_STATUS_LABELS } from "./ReferralStatusBadge";

interface ReferralApiSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 의뢰 목록 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 *
 * - 주소 조건: `?patientName=`(부분 일치)·`?status=`(백엔드 상태 값)·`?examTypeId=`(검사 유형 ID)·`?page=`(1부터)
 *   비어 있으면 조건 없음, 있는데 올바르지 않으면 다른 조건(전체 목록 등)으로 바꿔 조회하지 않고 안내만 한다 (요청하지 않는다)
 * - 검사 유형 이름은 검사 유형 API 전체 목록을 한 번 받아 바꾼다 (의뢰마다 부르지 않는다). 실패해도 의뢰 목록은 보여 준다
 * - 역할 확인·조회는 서버 로더가 한다 (의뢰기관 역할이 아니면 요청하지 않는다). 실패해도 Mock 데이터로 대체하지 않는다
 */
export default async function ReferralApiSection({ searchParams }: ReferralApiSectionProps) {
  const query = parseReferralListQuery(await searchParams);
  if (!query) return <ReferralFailureNotice failure={INVALID_QUERY} />;

  // 검사 유형 조건이 있으면 먼저 실제 유형인지 확인한다 (없는 유형으로 조회하지 않는다). 없으면 함께 조회한다
  let examTypes: ExamTypeListLoadResult;
  let result: Awaited<ReturnType<typeof loadReferralTablePage>>;
  if (query.examTypeId) {
    examTypes = await loadExamTypes();
    if (examTypes.ok && !examTypes.examTypes.some((type) => type.id.toLowerCase() === query.examTypeId!.toLowerCase())) {
      return <ReferralFailureNotice failure={UNKNOWN_EXAM_TYPE} />;
    }
    result = await loadReferralTablePage(query);
  } else {
    [examTypes, result] = await Promise.all([loadExamTypes(), loadReferralTablePage(query)]);
  }
  if (!result.ok) return <ReferralFailureNotice failure={result} />;

  const typeById = new Map((examTypes.ok ? examTypes.examTypes : []).map((type) => [type.id.toLowerCase(), type]));
  const rows = result.rows.map(({ referralId, patientName, referralStatus, examTypeId, examInstitution, examStartTime }) => {
    const type = typeById.get(examTypeId.toLowerCase());
    return {
      referralId,
      patientName,
      referralStatus,
      examInstitution,
      examStartTime,
      // 목록에 없는 ID(삭제된 유형 등)는 이름을 만들지 않는다
      examTypeLabel: type ? examTypeLabel(type) : examTypes.ok ? "알 수 없는 유형" : "확인 불가",
    };
  });
  const applied = { patientName: query.patientName ?? "", status: query.status ?? "", examTypeId: query.examTypeId ?? "" } as const;
  const pageQuery = Object.fromEntries(Object.entries(applied).filter(([, value]) => value !== ""));

  return (
    <div className="flex flex-col gap-4">
      <ReferralApiFilter
        // 주소(적용된 조건)가 바뀌면 입력 중인 값을 그 조건으로 다시 맞춘다
        key={JSON.stringify(applied)}
        applied={applied}
        statusOptions={STATUS_OPTIONS}
        examTypeOptions={examTypeOptions(examTypes.ok ? examTypes.examTypes : [])}
        examTypeNotice={
          !examTypes.ok
            ? { kind: "error", message: examTypes.message }
            : examTypes.examTypes.length === 0
              ? { kind: "empty" }
              : null
        }
      />
      <ReferralApiTable
        rows={rows}
        page={result.page}
        totalPages={result.totalPages}
        totalElements={result.totalElements}
        filtered={Object.keys(pageQuery).length > 0}
        query={pageQuery}
        detailIncomplete={result.detailIncomplete}
      />
    </div>
  );
}

/** 검사 유형 표시: 이름이 modality와 같으면 이름만, 아니면 "CT · 이름" (이름을 새로 만들지 않는다) */
export function examTypeLabel({ name, modality }: ExamTypeItem): string {
  return name.trim().toUpperCase() === modality ? name : `${modality} · ${name}`;
}

/**
 * 검사 유형 선택지 (값: examTypeId). 이름은 자유 입력이라 같은 "modality · 이름"이 여러 개일 수 있다:
 * 그때는 ID 끝 4자리를 덧붙여 구분한다 (이름을 바꾸거나 하나만 남기지 않는다)
 */
function examTypeOptions(types: readonly ExamTypeItem[]): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(examTypeLabel(type), (counts.get(examTypeLabel(type)) ?? 0) + 1);
  return types.map((type) => {
    const label = examTypeLabel(type);
    return { value: type.id, label: (counts.get(label) ?? 0) > 1 ? `${label} (#${type.id.slice(-4)})` : label };
  });
}

/** 상태 선택지: 백엔드 상태 5개와 배지 문구 */
const STATUS_OPTIONS = REFERRAL_STATUSES.map((value) => {
  const badge = toBadgeStatus(value);
  return { value, label: badge === "FAILED" ? "예약 실패" : REFERRAL_STATUS_LABELS[badge] };
});

const INVALID_QUERY: ReferralLoadFailure = {
  ok: false,
  reason: "INVALID",
  message: "검색어, 예약 상태, 검사 유형 또는 페이지 번호 값이 올바르지 않습니다.",
  code: null,
};

const UNKNOWN_EXAM_TYPE: ReferralLoadFailure = {
  ok: false,
  reason: "INVALID",
  message: "선택한 검사 유형을 찾을 수 없습니다. 삭제되었거나 올바르지 않은 검사 유형입니다.",
  code: null,
};

/**
 * URL 조회 조건 → 로더 조건. 빈 값(빈 입력·전체 선택)은 조건 없음, 값이 올바르지 않으면 null (다른 값으로 바꾸지 않는다).
 * 같은 이름이 여러 번 오면 올바르지 않은 값으로 본다.
 */
function parseReferralListQuery(params: Record<string, string | string[] | undefined>): ReferralPageQuery | null {
  const { page: rawPage, status, patientName, examTypeId } = params;
  if ([rawPage, status, patientName, examTypeId].some(Array.isArray)) return null;
  const query: ReferralPageQuery = { page: 0 };
  if (rawPage !== undefined) {
    if (typeof rawPage !== "string" || !/^[1-9]\d*$/.test(rawPage)) return null;
    query.page = Number(rawPage) - 1;
    if (!Number.isSafeInteger(query.page)) return null;
  }
  if (typeof status === "string" && status !== "") {
    if (!isReferralStatus(status)) return null;
    query.status = status as ReferralStatusDto;
  }
  // 공백만 입력한 검색어는 조건 없음
  if (typeof patientName === "string" && patientName.trim() !== "") {
    if (!isPatientNameSearch(patientName)) return null;
    query.patientName = patientName.trim();
  }
  if (typeof examTypeId === "string" && examTypeId !== "") {
    if (!isExamTypeId(examTypeId)) return null;
    query.examTypeId = examTypeId;
  }
  return query;
}

const titles = (subject: ReferralListSubject): Record<ReferralLoadFailure["reason"], string> => ({
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: `${subject}을 확인할 수 없는 계정입니다.`,
  INVALID: "조회 조건이 올바르지 않습니다.",
  NETWORK: "의뢰 서버에 연결할 수 없습니다.",
  ERROR: `${subject}을 불러오지 못했습니다.`,
});

/**
 * 의뢰 목록 조회 실패 안내. 401은 토큰을 지워야 다시 로그인할 수 있으므로 로그아웃(폼 POST) 후 로그인 화면으로 보낸다.
 * 안내 문구는 서버 로더가 만든 문구만 쓴다 (응답 본문·환자명·검색어를 보여 주지 않는다).
 */
export function ReferralFailureNotice({ failure, subject = "의뢰 목록" }: { failure: ReferralLoadFailure; subject?: ReferralListSubject }) {
  const isError = failure.reason === "NETWORK" || failure.reason === "ERROR" || failure.reason === "UNAUTHORIZED";
  const action: ReactNode =
    failure.reason === "SIGNED_OUT" ? (
      <Link href={ROUTES.login} className={actionClass}>
        로그인
      </Link>
    ) : failure.reason === "UNAUTHORIZED" ? (
      <form action="/auth/logout" method="post">
        <button type="submit" className={actionClass}>
          다시 로그인
        </button>
      </form>
    ) : failure.reason === "INVALID" ? (
      <Link href={ROUTES.referring.referrals} className={actionClass}>
        조건 초기화
      </Link>
    ) : null;
  const message =
    failure.reason === "SIGNED_OUT"
      ? `${subject}은 의뢰기관 계정으로 로그인한 뒤 확인할 수 있습니다.`
      : failure.reason === "UNAUTHORIZED"
        ? "다시 로그인해 주세요."
        : failure.message;

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center ${
        isError ? "border-red-200 bg-red-50 text-red-700" : "border-dashed border-line bg-white text-gray-600"
      }`}
    >
      <p className="text-[15px] font-semibold">{titles(subject)[failure.reason]}</p>
      <p className="text-sm">{message}</p>
      {action}
    </div>
  );
}

const actionClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50";
