import Link from "next/link";
import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { ROUTES } from "@/constants/navigation";
import { RESCHEDULE_QUERY_KEY } from "@/features/referrals/reschedule";
import { loadApiRescheduleTarget } from "@/features/referrals/rescheduleTarget";
import SlotSearch from "@/features/slots/components/SlotSearch";
import { isApiSlotSearchAvailable, loadApiSlotSearchOrganizations } from "@/features/slots/server";

/** 협약 검사기관의 가용 슬롯과 재조정 후보를 실제 API에서 검색한다. */
export default function SlotSearchPage({ searchParams }: PageProps<"/referring/slots">) {
  return (
    <div className="itda-brand">
      <PageHeader title="검사 슬롯 검색" description="협력 검사기관의 CT·MRI 검사 가능한 시간을 조회합니다." />
      <Suspense fallback={<p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500 shadow-card">검사 슬롯 검색 화면을 불러오고 있습니다.</p>}>
        <SlotSearchSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SlotSearchSection({ searchParams }: Pick<PageProps<"/referring/slots">, "searchParams">) {
  const rescheduleReferralId = (await searchParams)[RESCHEDULE_QUERY_KEY];
  if (!isApiSlotSearchAvailable()) return <FeatureNotReady />;
  const isRescheduleRequested = rescheduleReferralId !== undefined && rescheduleReferralId !== "";
  const [result, reschedule] = await Promise.all([
    loadApiSlotSearchOrganizations(),
    isRescheduleRequested ? loadApiRescheduleTarget(rescheduleReferralId) : Promise.resolve(null),
  ]);
  if (!result.ok) return <ApiLoadFailure reason={result.reason} message={result.message} />;
  return (
    <SlotSearch
      key={reschedule?.ok ? reschedule.target.referralId : String(rescheduleReferralId ?? "")}
      organizations={result.organizations}
      examTypeOptions={result.examTypes}
      apiReschedule={reschedule}
    />
  );
}

function ApiLoadFailure({ reason, message }: { reason: string; message: string }) {
  const isSignedOut = reason === "SIGNED_OUT" || reason === "UNAUTHORIZED";
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-white px-6 py-16 text-center text-[15px] text-red-600 shadow-card">
      <p>{isSignedOut ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." : `협력 검사기관 정보를 불러오지 못했습니다. ${message}`}</p>
      {isSignedOut && <Link href={ROUTES.login} className="font-semibold text-primary underline underline-offset-4">로그인 화면으로 이동</Link>}
    </div>
  );
}
