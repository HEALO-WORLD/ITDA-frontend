import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import PartnershipsSection from "@/features/partnerships/components/PartnershipsSection";
import { getScreenDataSource } from "@/lib/api/config";

/**
 * 협약 관리 (검사기관). 우리 기관에 들어온 협약 요청을 승인·거절하고, 협약 중인 협약을 종료한다.
 * API 모드(partnerships)에서만 실제 협약 API를 쓴다. Mock 모드·기능 꺼짐은 준비 중으로 안내한다 (가짜 협약을 만들지 않는다).
 */
export default function ExaminingPartnershipsPage({ searchParams }: PageProps<"/examining/partnerships">) {
  const source = getScreenDataSource("partnerships");
  return (
    <>
      <PageHeader title="협약 관리" description="우리 기관에 들어온 협약 요청을 승인·거절하고, 협약 상태를 관리합니다." />
      {source === "api" ? (
        <Suspense fallback={<AdminLoading label="협약 목록을 불러오고 있습니다." />}>
          <PartnershipsSection role="EXAMINING" searchParams={searchParams} />
        </Suspense>
      ) : (
        <FeatureNotReady detail="협약 관리는 실제 API 연결(API 모드, partnerships 기능)에서만 제공됩니다." />
      )}
    </>
  );
}
