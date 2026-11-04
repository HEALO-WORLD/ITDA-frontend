import { Suspense } from "react";

import { isApiAuthMode } from "@/components/auth/ApiRoleGate";
import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import AdminIncidentsSection from "@/features/admin/components/AdminIncidentsSection";
import { AdminApiOnlyNotice, AdminLoading } from "@/features/admin/components/AdminNotices";
import { isApiFeature } from "@/lib/api/config";

/**
 * 장비 장애 관리 (관리자). 전체 검사기관의 장비 장애와 영향받은 의뢰 후속 처리 현황을 확인한다.
 * 장애 API 연동 여부는 기존 `incidents` 기능 설정을 따른다 (꺼져 있으면 준비 중 안내).
 */
export default function AdminIncidentsPage({ searchParams }: PageProps<"/admin/incidents">) {
  const header = <PageHeader title="장비 장애 관리" description="전체 검사기관의 장비 장애와 영향받은 의뢰 처리 현황을 확인합니다." />;
  if (!isApiAuthMode()) {
    return (
      <>
        {header}
        <AdminApiOnlyNotice />
      </>
    );
  }
  if (!isApiFeature("incidents")) {
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
      <Suspense fallback={<AdminLoading label="장비 장애 목록을 불러오고 있습니다." />}>
        <AdminIncidentsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
