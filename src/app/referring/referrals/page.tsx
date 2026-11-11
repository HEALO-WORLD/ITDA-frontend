import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import ReferralApiSection from "@/features/referrals/components/ReferralApiSection";

export default function ReferralsPage({ searchParams }: PageProps<"/referring/referrals">) {
  return (
    <>
      <PageHeader title="의뢰·예약 관리" />
      <section aria-labelledby="referral-list-title" className="rounded-xl border border-line bg-white px-4 pb-5 pt-5 shadow-card sm:px-7 sm:pb-6 sm:pt-6">
        <h2 id="referral-list-title" className="mb-5 text-lg font-semibold text-gray-900 sm:text-xl">의뢰·예약 목록</h2>
        <Suspense fallback={<p role="status" className="px-6 py-16 text-center text-[15px] text-gray-500">의뢰 목록을 불러오고 있습니다.</p>}>
          <ReferralApiSection searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  );
}
