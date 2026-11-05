import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getCurrentExaminingOrganizationId } from "@/features/equipment/api";
import { getExaminations, IS_MOCK_DATA } from "@/features/examinations/api";
import ExaminationApiSection from "@/features/examinations/components/ExaminationApiSection";
import ExaminationBoard from "@/features/examinations/components/ExaminationBoard";
import { getScreenDataSource, isApiFeature } from "@/lib/api/config";

/**
 * 검사 진행·결과 (S08).
 * - Mock 모드: 현재 검사기관(개발용 세션 매핑)의 검사를 서버에서 기관 ID로 골라 넘기고,
 *   검색·상세·결과 등록(Mock)은 클라이언트에서 처리한다.
 * - API 모드(examinations 선택): 로그인 세션으로 검사 목록 API를 조회하고 (`?page=`, 1부터), 행마다 상태 변경·결과 등록 API를 호출한다.
 *   세션·쿼리는 요청 시점 값이라 Suspense 안에서 렌더링한다. Mock 데이터·Mock 기관 ID를 쓰지 않는다.
 */
export default async function ExaminationsPage({ searchParams }: PageProps<"/examining/examinations">) {
  if (isApiFeature("examinations")) {
    return (
      <>
        <PageHeader title="검사 진행·결과" description="우리 기관에 배정된 검사의 진행 상태를 확인하고 결과를 등록합니다." />
        <Suspense
          fallback={
            <p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
              검사 목록을 불러오고 있습니다.
            </p>
          }
        >
          <ExaminationApiSection searchParams={searchParams} />
        </Suspense>
      </>
    );
  }

  // API 모드인데 이 기능이 API 대상이 아니면 Mock으로 채우지 않고 준비 중으로 안내한다
  if (getScreenDataSource("examinations") === "not-ready") {
    return (
      <>
        <PageHeader title="검사 진행·결과" description="우리 기관에 배정된 검사의 진행 상태를 확인하고 결과를 등록합니다." />
        <FeatureNotReady />
      </>
    );
  }

  const organizationId = await getCurrentExaminingOrganizationId();
  const examinations = organizationId ? await getExaminations(organizationId) : [];

  return (
    <>
      <PageHeader title="검사 진행·결과" description="우리 기관에 배정된 검사의 진행 상태를 확인하고 결과를 등록합니다." />
      {IS_MOCK_DATA && (
        <p className="-mt-3 mb-4 inline-block rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          개발용 예시 데이터
        </p>
      )}
      {organizationId ? (
        <ExaminationBoard examinations={examinations} />
      ) : (
        <p role="status" className="rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
          검사기관 정보를 확인할 수 없습니다.
        </p>
      )}
    </>
  );
}
