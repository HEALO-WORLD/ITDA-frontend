import { Suspense } from "react";

import { isApiAuthMode } from "@/components/auth/ApiRoleGate";
import PageHeader from "@/components/layout/PageHeader";
import AdminSlotHistorySection from "@/features/admin/components/AdminSlotHistorySection";
import { AdminApiOnlyNotice, AdminLoading } from "@/features/admin/components/AdminNotices";

/**
 * 슬롯 상태 이력 (관리자, 조회 전용). 슬롯 ID로 상태 변경 이력을 추적한다.
 * 슬롯 강제 해제는 의뢰·예약 상태를 함께 바꾸지 않아 이번 범위에서 두지 않는다.
 */
export default function AdminSlotsPage({ searchParams }: PageProps<"/admin/slots">) {
  const header = <PageHeader title="슬롯 상태 이력" description="슬롯 ID로 슬롯 상태가 언제, 왜 바뀌었는지 확인합니다." />;
  if (!isApiAuthMode()) {
    return (
      <>
        {header}
        <AdminApiOnlyNotice />
      </>
    );
  }
  return (
    <>
      {header}
      <Suspense fallback={<AdminLoading label="슬롯 상태 이력을 불러오고 있습니다." />}>
        <AdminSlotHistorySection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
