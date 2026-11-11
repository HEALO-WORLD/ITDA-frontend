import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import AdminReferralsSection from "@/features/admin/components/AdminReferralsSection";
import { AdminLoading } from "@/features/admin/components/AdminNotices";

/**
 * 의뢰 관리 (관리자). 전체 의뢰기관의 의뢰와 상태 변경 이력을 조회한다 (조회 전용).
 */
export default function AdminReferralsPage({ searchParams }: PageProps<"/admin/referrals">) {
  const header = <PageHeader title="의뢰 관리" description="전체 의뢰기관의 검사 의뢰와 상태 변경 이력을 확인합니다." />;
  return (
    <>
      {header}
      <Suspense fallback={<AdminLoading label="의뢰 목록을 불러오고 있습니다." />}>
        <AdminReferralsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
