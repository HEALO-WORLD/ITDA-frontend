import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import PartnershipsSection from "@/features/partnerships/components/PartnershipsSection";

/**
 * 협약 관리 (검사기관). 우리 기관에 들어온 협약 요청을 승인·거절하고, 협약 중인 협약을 종료한다.
 * 협약 API로 목록과 변경 요청을 처리한다.
 */
export default function ExaminingPartnershipsPage({ searchParams }: PageProps<"/examining/partnerships">) {
  return (
    <>
      <PageHeader title="협약 관리" description="우리 기관에 들어온 협약 요청을 승인·거절하고, 협약 상태를 관리합니다." />
      <Suspense fallback={<AdminLoading label="협약 목록을 불러오고 있습니다." />}>
        <PartnershipsSection role="EXAMINING" searchParams={searchParams} />
      </Suspense>
    </>
  );
}
