import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import AdminIncidentsSection from "@/features/admin/components/AdminIncidentsSection";
import { AdminLoading } from "@/features/admin/components/AdminNotices";

/**
 * 장비 장애 관리 (관리자). 전체 검사기관의 장비 장애와 영향받은 의뢰 후속 처리 현황을 확인한다.
 */
export default function AdminIncidentsPage({ searchParams }: PageProps<"/admin/incidents">) {
  const header = <PageHeader title="장비 장애 관리" description="전체 검사기관의 장비 장애와 영향받은 의뢰 처리 현황을 확인합니다." />;
  return (
    <>
      {header}
      <Suspense fallback={<AdminLoading label="장비 장애 목록을 불러오고 있습니다." />}>
        <AdminIncidentsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
