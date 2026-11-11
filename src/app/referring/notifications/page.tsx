import { Info } from "lucide-react";
import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import ApiNotificationSection from "@/features/notifications/components/ApiNotificationSection";
import ApiRescheduleSection, { ApiRescheduleAlert } from "@/features/notifications/components/ApiRescheduleSection";

/** 재조정 필요 목록과 알림을 각각 서버 API에서 조회한다. */
export default function NotificationsPage({ searchParams }: PageProps<"/referring/notifications">) {
  return (
    <>
      <PageHeader title="재조정·알림" />
      <div className="flex flex-col gap-6">
        <Suspense fallback={null}>
          <ApiRescheduleAlert searchParams={searchParams} />
        </Suspense>
        <div className="flex flex-col gap-6">
          <Suspense fallback={<p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">재조정 필요 목록을 불러오고 있습니다.</p>}>
            <ApiRescheduleSection searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={<p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">알림을 불러오고 있습니다.</p>}>
            <ApiNotificationSection variant="referring" searchParams={searchParams} />
          </Suspense>
        </div>
        <p className="flex items-center gap-3 rounded-xl bg-primary-soft px-6 py-4 text-[15px] text-gray-700">
          <Info className="size-6 shrink-0 text-primary" aria-hidden="true" />
          <span>[새 슬롯 검색]에서 같은 검사 유형의 대체 슬롯을 골라 예약 변경을 요청할 수 있습니다. 요청이 접수된 뒤 예약 확정은 순차적으로 처리됩니다.</span>
        </p>
      </div>
    </>
  );
}
