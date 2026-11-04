import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getCurrentExaminingOrganizationId } from "@/features/equipment/api";
import { getIncidentRecords, IS_MOCK_DATA } from "@/features/incidents/api";
import IncidentApiSection from "@/features/incidents/components/IncidentApiSection";
import IncidentBoard from "@/features/incidents/components/IncidentBoard";
import { getReceivedReservations } from "@/features/reservations/api";
import { getScreenDataSource, isApiFeature } from "@/lib/api/config";

/**
 * 장비 장애·재조정 (S07).
 * 현재 검사기관(개발용 세션 매핑)의 장애 이력·장비·예약을 서버에서 기관 ID로 골라 넘기고,
 * 검색·상세·장애 등록·복구(개발용 Mock)는 클라이언트에서 한다. 예약 재조정·알림 발송은 API 연동 후 제공한다.
 *
 * API 모드(incidents): 장비 장애 조회 API 3종(목록·상세·영향 의뢰 처리 현황)만 쓴다.
 * Mock 기관 ID·장비·예약을 쓰지 않고, 백엔드에 없는 장애 등록·복구·요약은 표시하지 않는다.
 */
export default async function IncidentsPage({ searchParams }: PageProps<"/examining/incidents">) {
  if (isApiFeature("incidents")) {
    return (
      <>
        <PageHeader title="장비 장애·재조정" description="우리 기관 장비의 장애 이력과 영향받은 의뢰 처리 현황을 확인합니다." />
        <Suspense
          fallback={
            <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
              장비 장애 목록을 불러오고 있습니다.
            </p>
          }
        >
          <IncidentApiSection searchParams={searchParams} />
        </Suspense>
      </>
    );
  }

  // API 모드인데 이 기능이 API 대상이 아니면 Mock으로 채우지 않고 준비 중으로 안내한다
  if (getScreenDataSource("incidents") === "not-ready") {
    return (
      <>
        <PageHeader title="장비 장애·재조정" description="우리 기관 장비의 장애 이력과 영향받은 의뢰 처리 현황을 확인합니다." />
        <FeatureNotReady />
      </>
    );
  }

  const organizationId = await getCurrentExaminingOrganizationId();
  const [incidents, reservations] = organizationId
    ? await Promise.all([getIncidentRecords(organizationId), getReceivedReservations(organizationId)])
    : [[], []];

  return (
    <>
      <PageHeader title="장비 장애·재조정" description="우리 기관 장비의 장애 이력과 영향받은 예약을 확인합니다." />
      {IS_MOCK_DATA && (
        <p className="-mt-3 mb-4 inline-block rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          개발용 예시 데이터
        </p>
      )}
      {organizationId ? (
        <IncidentBoard
          organizationId={organizationId}
          baseIncidents={incidents}
          rescheduleRequiredCount={reservations.filter(({ status }) => status === "RESCHEDULE_REQUIRED").length}
        />
      ) : (
        <p role="status" className="rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
          검사기관 정보를 확인할 수 없습니다.
        </p>
      )}
    </>
  );
}
