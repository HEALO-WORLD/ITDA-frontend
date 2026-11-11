import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import ApiNotificationSection from "@/features/notifications/components/ApiNotificationSection";

export default function ExaminingNotificationsPage({ searchParams }: PageProps<"/examining/notifications">) {
  return (
    <>
      <PageHeader title="알림" description="검사기관의 예약 및 장비 운영 관련 알림을 확인합니다." />
      <Suspense fallback={<p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">알림을 불러오고 있습니다.</p>}>
        <ApiNotificationSection variant="examining" searchParams={searchParams} />
      </Suspense>
    </>
  );
}
