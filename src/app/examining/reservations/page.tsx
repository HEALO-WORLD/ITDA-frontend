import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import ExaminingReservationsSection from "@/features/reservations/components/ExaminingReservationsSection";

/** 확정 예약 목록·상세는 검사기관 예약 API에서 조회한다. */
export default function ReservationsPage({ searchParams }: PageProps<"/examining/reservations">) {
  return (
    <>
      <PageHeader title="확정 예약 관리" description="검사기관에 접수된 검사 예약과 진행 상태를 확인합니다." />
      <Suspense fallback={<AdminLoading label="예약 목록을 불러오고 있습니다." />}>
        <ExaminingReservationsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
