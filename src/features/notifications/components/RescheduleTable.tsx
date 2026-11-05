import type { ReactNode } from "react";

import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import type { ReferralSummary } from "@/features/referrals/types";
import { formatDateTimeWithWeekday } from "@/lib/format/date";
import { MOCK_EXAM_TYPES } from "@/lib/dev/mockExamTypes";

import type { RescheduleCause } from "../types";

import { RescheduleSearchButton, RescheduleSearchProvider } from "./RescheduleSearchDialog";

interface RescheduleTableProps {
  referrals: readonly ReferralSummary[];
  /** 모든 대상이 장비 장애로 확인되었는지 (안내 문구 결정) */
  isEquipmentFailure: boolean;
  /** 의뢰별 재조정 원인 장애 장비 (대체 슬롯 검색에서 제외). 없으면 제외 없음 */
  failedEquipmentsByReferral?: Readonly<Record<string, RescheduleCause[]>>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * 예약 재조정 필요 목록 (Mock). API 목록(ApiRescheduleSection)과 같은 전체 너비 카드 목록이다.
 * [새 슬롯 검색]은 페이지를 옮기지 않고 대체 슬롯 검색 대화상자(Mock 재조정 모드 SlotSearch, 실제 요청 없음)를 연다.
 */
export default function RescheduleTable({ referrals, isEquipmentFailure, failedEquipmentsByReferral = {} }: RescheduleTableProps) {
  return (
    <RescheduleSearchProvider>
      <section aria-labelledby="reschedule-title" className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6">
        <h2 id="reschedule-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
          예약 재조정 필요
          <span className="ml-2 text-base font-semibold tabular-nums text-primary">{referrals.length}건</span>
        </h2>
        <p className="mb-5 mt-2 text-[15px] text-gray-600">
          {referrals.length > 0 &&
            (isEquipmentFailure
              ? "아래 예약 건은 검사기관의 장비 장애로 인해 재조정이 필요합니다."
              : "아래 예약 건은 재조정이 필요합니다.")}
        </p>

        {referrals.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-[15px] text-gray-500">
            재조정이 필요한 예약이 없습니다.
          </p>
        ) : (
          <ul aria-label="예약 재조정 필요 목록" className="flex flex-col gap-3">
            {referrals.map((referral) => (
              <li
                key={referral.id}
                className="flex flex-col gap-4 rounded-xl border border-line px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-6"
              >
                <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
                  <Field label="예약번호">
                    <span className="font-medium">{referral.referralNumber}</span>
                  </Field>
                  <Field label="검사기관">{referral.organizationName}</Field>
                  <Field label="검사유형">{referral.examType}</Field>
                  <Field label="기존 예약일시">{formatDateTimeWithWeekday(referral.scheduledAt)}</Field>
                  <Field label="상태">
                    <ReferralStatusBadge status={referral.status} />
                  </Field>
                </dl>
                <RescheduleSearchButton
                  label={`${referral.referralNumber} 새 슬롯 검색`}
                  entry={{
                    kind: "mock",
                    referral,
                    failedEquipments: failedEquipmentsByReferral[referral.id] ?? [],
                    summary: {
                      reservationNumber: referral.referralNumber,
                      copyable: false,
                      institution: referral.organizationName,
                      modality: referral.examType,
                      examTypeName: MOCK_EXAM_TYPES.find((type) => type.id === referral.examTypeId)?.name ?? null,
                      scheduledAt: referral.scheduledAt,
                    },
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </RescheduleSearchProvider>
  );
}
