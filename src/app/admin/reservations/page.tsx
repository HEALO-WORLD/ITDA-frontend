import { Suspense } from "react";

import { isApiAuthMode } from "@/components/auth/ApiRoleGate";
import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import AdminReservationsSection from "@/features/admin/components/AdminReservationsSection";
import { AdminApiOnlyNotice, AdminLoading } from "@/features/admin/components/AdminNotices";
import { isApiFeature } from "@/lib/api/config";

/**
 * 예약 관리 (관리자). 전체 검사기관의 예약 처리 상태와 실패 원인을 조회한다 (취소·삭제·강제 변경 없음).
 * 예약 API(referral-service) 연동 여부는 기존 `referrals` 기능 설정을 따른다 (꺼져 있으면 준비 중 안내).
 */
export default function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  const header = <PageHeader title="예약 관리" description="전체 검사기관의 예약 처리 상태와 실패 원인을 확인합니다." />;
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
      <Suspense fallback={<AdminLoading label="예약 목록을 불러오고 있습니다." />}>
        <AdminReservationsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
