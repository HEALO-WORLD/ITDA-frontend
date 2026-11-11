import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import AdminExamTypesSection from "@/features/admin/components/AdminExamTypesSection";
import { AdminLoading } from "@/features/admin/components/AdminNotices";

/** 검사 유형 관리 (관리자). 공통 CT·MRI 검사 유형을 조회·등록하고 이름을 수정한다 */
export default function AdminExamTypesPage({ searchParams }: PageProps<"/admin/exam-types">) {
  return (
    <>
      <PageHeader title="검사 유형 관리" description="모든 기관이 함께 쓰는 CT·MRI 검사 유형을 등록하고 이름을 관리합니다." />
      <Suspense fallback={<AdminLoading label="검사 유형 목록을 불러오고 있습니다." />}>
        <AdminExamTypesSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
