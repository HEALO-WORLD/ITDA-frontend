import { Suspense } from "react";

import { isApiAuthMode } from "@/components/auth/ApiRoleGate";
import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import AdminReferralsSection from "@/features/admin/components/AdminReferralsSection";
import { AdminApiOnlyNotice, AdminLoading } from "@/features/admin/components/AdminNotices";
import { isApiFeature } from "@/lib/api/config";

/**
 * 의뢰 관리 (관리자). 전체 의뢰기관의 의뢰와 상태 변경 이력을 조회한다 (조회 전용).
 * 의뢰 API 연동 여부는 기존 `referrals` 기능 설정을 따른다 (꺼져 있으면 준비 중 안내).
 */
export default function AdminReferralsPage({ searchParams }: PageProps<"/admin/referrals">) {
  const header = <PageHeader title="의뢰 관리" description="전체 의뢰기관의 검사 의뢰와 상태 변경 이력을 확인합니다." />;
  if (!isApiAuthMode()) {
    return (
      <>
        {header}
        <AdminApiOnlyNotice />
      </>
    );
  }
  if (!isApiFeature("referrals")) {
    return (
      <>
        {header}
        <FeatureNotReady />
      </>
    );
  }
  return (
    <>
      {header}
      <Suspense fallback={<AdminLoading label="의뢰 목록을 불러오고 있습니다." />}>
        <AdminReferralsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
