import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import ExaminationApiSection from "@/features/examinations/components/ExaminationApiSection";

export default function ExaminationsPage({ searchParams }: PageProps<"/examining/examinations">) {
  return (
    <>
      <PageHeader title="검사 진행·결과" description="우리 기관에 배정된 검사의 진행 상태를 확인하고 결과를 등록합니다." />
      <Suspense fallback={<p role="status" className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">검사 목록을 불러오고 있습니다.</p>}>
        <ExaminationApiSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
