import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { IS_MOCK_DATA } from "@/features/examining-notifications/api";
import ExaminingNotificationBoard from "@/features/examining-notifications/components/ExaminingNotificationBoard";
import ApiNotificationSection from "@/features/notifications/components/ApiNotificationSection";
import { isApiFeature } from "@/lib/api/config";

/**
 * 검사기관 알림.
 * 알림 목록·읽음 상태는 검사기관 레이아웃의 Provider가 갖고 있어 헤더 알림 점과 공유한다.
 * 기존 예약·장애 사건에 대한 알림 조회 중심이며, 알림 발송은 하지 않는다.
 *
 * API 모드(examining-notifications): 알림 API로 조회하고 읽지 않은 알림 수는 레이아웃 조회 결과를 쓴다.
 */
export default function ExaminingNotificationsPage({ searchParams }: PageProps<"/examining/notifications">) {
  const header = <PageHeader title="알림" description="검사기관의 예약 및 장비 운영 관련 알림을 확인합니다." />;

  if (isApiFeature("examining-notifications")) {
    return (
      <>
        {header}
        <Suspense
          fallback={
            <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
              알림을 불러오고 있습니다.
            </p>
          }
        >
          <ApiNotificationSection variant="examining" searchParams={searchParams} />
        </Suspense>
      </>
    );
  }

  return (
    <>
      {header}
      {IS_MOCK_DATA && (
        <p className="-mt-3 mb-4 inline-block rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          개발용 예시 데이터
        </p>
      )}
      <ExaminingNotificationBoard />
    </>
  );
}
