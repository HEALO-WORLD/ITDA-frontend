import { Plus } from "lucide-react";
import Link from "next/link";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getScreenDataSource } from "@/lib/api/config";
import { ROUTES } from "@/constants/navigation";
import { getRecentReferrals, IS_MOCK_DATA } from "@/features/referrals/api";
import ReferralHistoryTable from "@/features/referrals/components/ReferralHistoryTable";

/**
 * 의뢰·예약 관리 (S03).
 * 의뢰·예약 목록이 메인 콘텐츠이며, 새 의뢰는 검사 슬롯 검색에서 슬롯을 고른 뒤 모달로 입력한다.
 * API 모드: 화면 표가 쓰는 값(검사기관·장비·검사 일시 등)을 채울 API 연동이 아직 없어 준비 중으로 안내한다 (Mock 데이터를 쓰지 않는다).
 */
export default async function ReferralsPage() {
  if (getScreenDataSource(null) === "not-ready") {
    return (
      <>
        <PageHeader title="의뢰·예약 관리" />
        <FeatureNotReady />
      </>
    );
  }
  const referrals = await getRecentReferrals();

  return (
    <>
      <PageHeader
        title="의뢰·예약 관리"
        actions={
          <Link
            href={ROUTES.referring.slots}
            className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-5 text-base font-bold text-white transition-colors hover:bg-primary-hover"
          >
            <Plus className="size-5" aria-hidden="true" />
            새 검사 의뢰
          </Link>
        }
      />

      <section
        aria-labelledby="referral-history-title"
        className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-8"
      >
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h2 id="referral-history-title" className="text-2xl font-bold text-gray-900">
            최근 의뢰·예약 내역
          </h2>
          {IS_MOCK_DATA && (
            <span className="rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              개발용 예시 데이터
            </span>
          )}
        </div>
        <ReferralHistoryTable referrals={referrals} />
      </section>
    </>
  );
}
