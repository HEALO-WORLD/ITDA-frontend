import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import PartnershipsSection from "@/features/partnerships/components/PartnershipsSection";

/**
 * 협력 검사기관 (의뢰기관). 우리 기관의 검사기관 협약을 보고, 새로 요청하거나 협약 중인 협약을 종료한다.
 * 실제 협약 API로 목록과 변경 요청을 처리한다.
 */
export default function ReferringPartnershipsPage({ searchParams }: PageProps<"/referring/partnerships">) {
  return (
    <>
      <PageHeader title="협력 검사기관" description="협약한 검사기관을 확인하고, 새 검사기관에 협약을 요청합니다." />
      <Suspense fallback={<AdminLoading label="협약 목록을 불러오고 있습니다." />}>
        <PartnershipsSection role="REFERRING" searchParams={searchParams} />
      </Suspense>
    </>
  );
}
