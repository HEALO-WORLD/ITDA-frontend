"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ROUTES } from "@/constants/navigation";

import { PATIENT_NAME_SEARCH_MAX_LENGTH, type ReferralStatusDto } from "../remote";

export interface ReferralApiFilterValues {
  patientName: string;
  status: ReferralStatusDto | "";
  examTypeId: string;
}

interface ReferralApiFilterProps {
  /** 지금 적용된 조건 (주소 기준) */
  applied: ReferralApiFilterValues;
  /** 상태 선택지 (백엔드 상태 값과 화면 문구) */
  statusOptions: readonly { value: ReferralStatusDto; label: string }[];
  /** 검사 유형 선택지 (검사 유형 API의 실제 ID·이름) */
  examTypeOptions: readonly { value: string; label: string }[];
  /**
   * 검사 유형 필터를 쓸 수 없는 이유 (없으면 null).
   * - empty: 검사 유형 API가 정상 응답했지만 등록된 유형이 0건
   * - error: 검사 유형 API 조회 실패 (message: 권한·연결·응답 형식·서버 오류 구분 문구)
   */
  examTypeNotice: { kind: "empty" } | { kind: "error"; message: string } | null;
}

// Mock 의뢰 검색 조건(ReferralFilter)과 같은 모양
const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/** 조건 → 주소. 빈 값은 넣지 않고, 조건이 바뀌면 첫 페이지로 간다 (page를 넣지 않는다) */
export function referralListHref({ patientName, status, examTypeId }: ReferralApiFilterValues): string {
  const params = new URLSearchParams();
  if (patientName.trim()) params.set("patientName", patientName.trim());
  if (status) params.set("status", status);
  if (examTypeId) params.set("examTypeId", examTypeId);
  const query = params.toString();
  return query ? `${ROUTES.referring.referrals}?${query}` : ROUTES.referring.referrals;
}

/**
 * 의뢰 목록 검색 조건 (API 모드). 배치·모양은 Mock 의뢰 검색 조건과 같다: [환자명] [상태] [유형] [상세 필터] [검색] [초기화].
 * 검색(버튼·Enter)을 누르면 주소를 바꿔 서버가 전체 의뢰에서 다시 조회한다 (현재 페이지 10건만 거르지 않는다).
 * 스크립트가 없어도 일반 GET 폼으로 같은 주소로 이동한다 (빈 값은 서버가 조건 없음으로 본다).
 * 상세 필터(검사기관·검사 기간)는 의뢰 목록 API가 지원하지 않아 쓸 수 없게 둔다.
 */
export default function ReferralApiFilter({ applied, statusOptions, examTypeOptions, examTypeNotice }: ReferralApiFilterProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ReferralApiFilterValues>(applied);
  const update = (patch: Partial<ReferralApiFilterValues>) => setDraft((prev) => ({ ...prev, ...patch }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(referralListHref(draft));
  };
  const reset = () => {
    setDraft({ patientName: "", status: "", examTypeId: "" });
    router.push(ROUTES.referring.referrals);
  };

  return (
    <form
      role="search"
      aria-label="의뢰 검색 조건"
      action={ROUTES.referring.referrals}
      method="get"
      onSubmit={submit}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[190px] flex-[2_1_230px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            name="patientName"
            value={draft.patientName}
            onChange={(event) => update({ patientName: event.target.value })}
            maxLength={PATIENT_NAME_SEARCH_MAX_LENGTH}
            placeholder="환자명 검색"
            aria-label="환자명 검색 (일부만 입력해도 찾습니다)"
            className={`${controlClass} pl-9`}
          />
        </div>

        <select
          name="status"
          aria-label="예약 상태"
          value={draft.status}
          onChange={(event) => update({ status: event.target.value as ReferralStatusDto | "" })}
          className={`${controlClass} min-w-[125px] flex-[1_1_125px]`}
        >
          <option value="">전체 상태</option>
          {statusOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          name="examTypeId"
          aria-label="검사 유형"
          value={draft.examTypeId}
          onChange={(event) => update({ examTypeId: event.target.value })}
          disabled={examTypeNotice !== null}
          aria-describedby={examTypeNotice ? "referral-exam-type-unavailable" : undefined}
          className={`${controlClass} min-w-[110px] flex-[1_1_110px] disabled:bg-gray-50 disabled:text-gray-400`}
        >
          <option value="">전체 유형</option>
          {examTypeOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            aria-describedby="referral-detail-filter-unavailable"
            title="검사기관·검사 기간 조건은 의뢰 목록 API에서 아직 지원하지 않습니다."
            className="inline-flex h-10 cursor-not-allowed items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-gray-400"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            상세 필터
          </button>

          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-hover"
          >
            <Search className="size-4" aria-hidden="true" />
            검색
          </button>

          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            초기화
          </button>
        </div>
      </div>

      <p id="referral-detail-filter-unavailable" className="sr-only">
        상세 필터(검사기관·검사 기간)는 의뢰 목록 API에서 아직 지원하지 않아 사용할 수 없습니다.
      </p>
      {examTypeNotice?.kind === "empty" && (
        <p id="referral-exam-type-unavailable" role="status" className="text-sm text-gray-600">
          등록된 검사 유형이 없어 선택할 수 있는 검사 유형이 없습니다. 의뢰 목록은 그대로 확인할 수 있습니다.
        </p>
      )}
      {examTypeNotice?.kind === "error" && (
        <p id="referral-exam-type-unavailable" role="status" className="text-sm text-amber-700">
          검사 유형 목록을 불러오지 못해 검사 유형 조건을 쓸 수 없습니다. ({examTypeNotice.message}) 의뢰 목록은 그대로 확인할 수 있습니다.
        </p>
      )}
    </form>
  );
}
