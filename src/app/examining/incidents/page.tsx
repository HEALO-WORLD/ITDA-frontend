import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import IncidentApiSection from "@/features/incidents/components/IncidentApiSection";

export default function IncidentsPage({ searchParams }: PageProps<"/examining/incidents">) {
  return (
    <>
      <PageHeader title="장비 장애·재조정" description="우리 기관 장비의 장애 이력과 영향받은 의뢰 처리 현황을 확인합니다." />
      <Suspense fallback={<p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">장비 장애 목록을 불러오고 있습니다.</p>}>
        <IncidentApiSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
