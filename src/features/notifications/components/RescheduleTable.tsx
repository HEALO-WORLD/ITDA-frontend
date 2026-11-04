import Link from "next/link";

import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { getRescheduleSearchHref } from "@/features/referrals/reschedule";
import type { ReferralSummary } from "@/features/referrals/types";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

interface RescheduleTableProps {
  referrals: readonly ReferralSummary[];
  /** 모든 대상이 장비 장애로 확인되었는지 (안내 문구 결정) */
  isEquipmentFailure: boolean;
}

const thClass = "whitespace-nowrap border-b border-line px-3 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-3 py-3.5 text-sm text-gray-700";

/** 예약 재조정 필요 목록 */
export default function RescheduleTable({ referrals, isEquipmentFailure }: RescheduleTableProps) {
  return (
    <section
      aria-labelledby="reschedule-title"
      className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6"
    >
      <h2 id="reschedule-title" className="text-lg font-semibold text-gray-900 sm:text-xl">
        예약 재조정 필요
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
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[680px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>예약번호</th>
                <th scope="col" className={thClass}>검사기관</th>
                <th scope="col" className={thClass}>검사유형</th>
                <th scope="col" className={thClass}>기존 예약일시</th>
                <th scope="col" className={`${thClass} text-center!`}>상태</th>
                <th scope="col" className={`${thClass} text-center!`}>작업</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((referral) => (
                <tr key={referral.id} className="border-t border-line">
                  <td className={`${tdClass} whitespace-nowrap font-medium`}>{referral.referralNumber}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{referral.organizationName}</td>
                  <td className={tdClass}>{referral.examType}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateTimeWithWeekday(referral.scheduledAt)}
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <ReferralStatusBadge status={referral.status} />
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <Link
                      href={getRescheduleSearchHref(referral.id)}
                      aria-label={`${referral.referralNumber} 새 슬롯 검색`}
                      className="inline-flex h-10 items-center whitespace-nowrap rounded-lg bg-primary px-4 text-[15px] font-semibold text-white transition-colors hover:bg-primary-hover"
                    >
                      새 슬롯 검색
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
