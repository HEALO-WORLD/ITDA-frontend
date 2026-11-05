import { Info } from "lucide-react";
import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getNotifications, IS_MOCK_DATA } from "@/features/notifications/api";
import ApiNotificationSection from "@/features/notifications/components/ApiNotificationSection";
import ApiRescheduleSection, { ApiRescheduleAlert } from "@/features/notifications/components/ApiRescheduleSection";
import NotificationList from "@/features/notifications/components/NotificationList";
import RescheduleAlert from "@/features/notifications/components/RescheduleAlert";
import RescheduleTable from "@/features/notifications/components/RescheduleTable";
import { getEquipmentFailureExamTypes } from "@/features/notifications/reschedule";
import { getRescheduleRequiredReferrals } from "@/features/referrals/api";
import { getScreenDataSource } from "@/lib/api/config";

/**
 * 재조정·알림 (S04).
 * 재조정 필요 여부는 의뢰·예약 상태로, 읽음 여부는 알림 상태로 따로 관리한다.
 * 알림을 읽어도 재조정 필요 목록은 바뀌지 않는다.
 *
 * API 모드(notifications): 알림 내역은 알림 API로 조회한다.
 * API 응답에는 재조정 원인(장애 장비)이 없으므로 원인을 표시하지 않는다 (Mock 알림의 장비로 대신하지 않는다).
 * API 모드(referrals): 재조정 필요 목록은 의뢰 목록 API(status=NEEDS_RESCHEDULE)로 조회한다 (ApiRescheduleSection, Mock 목록을 쓰지 않는다).
 *   대체 슬롯 선택(재예약)은 슬롯 조회·재예약 연결 전이라 버튼을 비활성으로 둔다. 기능이 꺼져 있으면 준비 중으로 안내한다.
 */
export default async function NotificationsPage({ searchParams }: PageProps<"/referring/notifications">) {
  // 영역마다 데이터 출처를 정한다: Mock 모드 → Mock, API 모드 → 연결된 API 또는 준비 중 (API 모드에서는 Mock을 쓰지 않는다)
  const rescheduleSource = getScreenDataSource("referrals");
  const notificationSource = getScreenDataSource("notifications");
  const [rescheduleReferrals, notifications] = await Promise.all([
    rescheduleSource === "mock" ? getRescheduleRequiredReferrals() : [],
    notificationSource === "mock" ? getNotifications() : [],
  ]);
  const failureExamTypes = getEquipmentFailureExamTypes(rescheduleReferrals, notifications);

  return (
    <>
      <PageHeader title="재조정·알림" />
      <div className="flex flex-col gap-6">
        {rescheduleSource === "mock" && (
          <RescheduleAlert
            count={rescheduleReferrals.length}
            failureExamTypes={failureExamTypes}
            isMockData={IS_MOCK_DATA}
          />
        )}
        {rescheduleSource === "api" && (
          <Suspense fallback={null}>
            <ApiRescheduleAlert searchParams={searchParams} />
          </Suspense>
        )}

        <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
          {rescheduleSource === "mock" ? (
            <RescheduleTable referrals={rescheduleReferrals} isEquipmentFailure={failureExamTypes !== null} />
          ) : rescheduleSource === "api" ? (
            <Suspense
              fallback={
                <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
                  재조정 필요 목록을 불러오고 있습니다.
                </p>
              }
            >
              <ApiRescheduleSection searchParams={searchParams} />
            </Suspense>
          ) : (
            <FeatureNotReady detail="예약 재조정 필요 목록" />
          )}
          {notificationSource === "api" ? (
            <Suspense
              fallback={
                <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
                  알림을 불러오고 있습니다.
                </p>
              }
            >
              <ApiNotificationSection variant="referring" searchParams={searchParams} />
            </Suspense>
          ) : notificationSource === "mock" ? (
            <NotificationList />
          ) : (
            <FeatureNotReady detail="알림 내역" />
          )}
        </div>

        <p className="flex items-center gap-3 rounded-xl bg-primary-soft px-6 py-4 text-[15px] text-gray-700">
          <Info className="size-6 shrink-0 text-primary" aria-hidden="true" />
          {rescheduleSource !== "mock" ? (
            <span>새 슬롯 선택과 예약 변경 요청은 서버 기능이 준비된 뒤 이용할 수 있습니다.</span>
          ) : (
            <span>
              새 슬롯을 선택하면 예약 변경을 요청할 수 있습니다.
              {IS_MOCK_DATA && (
                <span className="text-gray-500"> (현재는 개발용 화면으로 실제 변경 요청은 처리되지 않습니다.)</span>
              )}
            </span>
          )}
        </p>
      </div>
    </>
  );
}
