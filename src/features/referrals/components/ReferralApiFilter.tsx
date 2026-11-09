"use client";

import { RotateCcw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { controlClass, filterPanelClass, ghostButtonClass, primaryButtonClass } from "@/components/ui/styles";
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
 * 의뢰 목록 검색 조건 (API 모드): [환자명] [상태] [유형] [검색] [초기화].
 * 검색(버튼·Enter)을 누르면 주소를 바꿔 서버가 전체 의뢰에서 다시 조회한다 (현재 페이지 10건만 거르지 않는다).
 * 스크립트가 없어도 일반 GET 폼으로 같은 주소로 이동한다 (빈 값은 서버가 조건 없음으로 본다).
 * 상세 필터(검사기관·검사 기간)는 의뢰 목록 API가 지원하지 않아(동작 없는 비활성 버튼이었다) API 화면에서는 보이지 않는다.
 * 백엔드가 조건을 지원하면 이 자리에 버튼을 다시 둔다.
 * 배치: PC(xl)는 한 줄 [환자명 | 상태 · 유형 | 검색 · 초기화], 그보다 좁으면 환자명 한 줄 + 선택 2칸 + 버튼으로 줄바꿈
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
      className={filterPanelClass}
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative min-w-0 xl:flex-[1.4]">
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

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center xl:flex-[2]">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
            <select
              name="status"
              aria-label="예약 상태"
              value={draft.status}
              onChange={(event) => update({ status: event.target.value as ReferralStatusDto | "" })}
              className={`${controlClass} min-w-0 cursor-pointer`}
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
              className={`${controlClass} min-w-0 cursor-pointer disabled:bg-gray-50 disabled:text-gray-400`}
            >
              <option value="">전체 유형</option>
              {examTypeOptions.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* 주 동작(검색)은 네이비, 보조 동작(초기화)은 가벼운 버튼으로 위계를 나눈다 */}
          <div className="flex shrink-0 gap-2">
            <button type="submit" className={`${primaryButtonClass} min-w-[96px] flex-1 sm:flex-none`}>
              <Search className="size-4" aria-hidden="true" />
              검색
            </button>

            <button type="button" onClick={reset} className={ghostButtonClass}>
              <RotateCcw className="size-4" aria-hidden="true" />
              초기화
            </button>
          </div>
        </div>
      </div>

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
