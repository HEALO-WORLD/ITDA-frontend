import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getScreenDataSource, isApiFeature } from "@/lib/api/config";
import { getCurrentExaminingOrganizationId, getEquipments } from "@/features/equipment/api";
import { getReceivedReservations, IS_MOCK_DATA } from "@/features/reservations/api";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import ExaminingReservationsSection from "@/features/reservations/components/ExaminingReservationsSection";
import ReservationBoard from "@/features/reservations/components/ReservationBoard";

/**
 * 확정 예약 관리 (S06) — 조회 중심.
 * 현재 검사기관(개발용 세션 매핑)으로 접수된 예약만 서버에서 골라 넘기고, 검색·선택은 클라이언트에서 한다.
 * 자동 확정 정책이므로 승인·거절·상태 변경 기능은 두지 않는다.
 * API 모드(`reservations` 기능): 실제 예약 목록·상세를 조회한다 (ExaminingReservationsSection, 검사기관 역할 확인은 서버 로더에서).
 * API 모드인데 기능이 꺼져 있으면 준비 중으로 안내한다 (Mock 데이터·Mock 기관 ID를 쓰지 않는다).
 */
export default async function ReservationsPage({ searchParams }: PageProps<"/examining/reservations">) {
  if (isApiFeature("reservations")) {
    return (
      <>
        <PageHeader title="확정 예약 관리" description="검사기관에 접수된 검사 예약과 진행 상태를 확인합니다." />
        <Suspense fallback={<AdminLoading label="예약 목록을 불러오고 있습니다." />}>
          <ExaminingReservationsSection searchParams={searchParams} />
        </Suspense>
      </>
    );
  }
  if (getScreenDataSource(null) === "not-ready") {
    return (
      <>
        <PageHeader title="확정 예약 관리" description="검사기관에 접수된 검사 예약과 진행 상태를 확인합니다." />
        <FeatureNotReady />
      </>
    );
  }
  const organizationId = await getCurrentExaminingOrganizationId();
  const [reservations, equipments] = organizationId
    ? await Promise.all([getReceivedReservations(organizationId), getEquipments(organizationId)])
    : [[], []];

  return (
    <>
      <PageHeader title="확정 예약 관리" description="검사기관에 접수된 검사 예약과 진행 상태를 확인합니다." />
      {IS_MOCK_DATA && (
        <p className="-mt-3 mb-4 inline-block rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          개발용 예시 데이터
        </p>
      )}
      {organizationId ? (
        <ReservationBoard
          reservations={reservations}
          equipments={equipments.map(({ id, name, examType }) => ({ id, name, examType }))}
        />
      ) : (
        <p role="status" className="rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
          검사기관 정보를 확인할 수 없습니다.
        </p>
      )}
    </>
  );
}
