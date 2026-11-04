import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getScreenDataSource, isApiFeature } from "@/lib/api/config";
import { ROUTES } from "@/constants/navigation";
import { getRecentReferrals, IS_MOCK_DATA } from "@/features/referrals/api";
import ReferralApiSection from "@/features/referrals/components/ReferralApiSection";
import ReferralHistoryTable from "@/features/referrals/components/ReferralHistoryTable";

/**
 * 의뢰·예약 관리 (S03).
 * 의뢰·예약 목록이 메인 콘텐츠이며, 새 의뢰는 검사 슬롯 검색에서 슬롯을 고른 뒤 모달로 입력한다.
 * API 모드(referrals): 의뢰 목록 API로 의뢰 ID·환자명·예약 상태를 보여 준다 (응답에 없는 검사기관·검사 일시는 표시하지 않는다).
 * 의뢰 생성 API는 아직 연동하지 않아 새 의뢰 버튼은 두지 않는다.
 * API 모드인데 referrals가 API 대상이 아니면 준비 중으로 안내한다 (Mock 데이터를 쓰지 않는다).
 */
export default async function ReferralsPage({ searchParams }: PageProps<"/referring/referrals">) {
  if (isApiFeature("referrals")) {
    return (
      <>
        <PageHeader title="의뢰·예약 관리" />
        <section
          aria-labelledby="referral-list-title"
          className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-8"
        >
          <h2 id="referral-list-title" className="mb-6 text-2xl font-bold text-gray-900">
            최근 의뢰·예약 내역
          </h2>
          <Suspense
            fallback={
              <p role="status" className="px-6 py-16 text-center text-[15px] text-gray-500">
                의뢰 목록을 불러오고 있습니다.
              </p>
            }
          >
            <ReferralApiSection searchParams={searchParams} />
          </Suspense>
        </section>
      </>
    );
  }
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
