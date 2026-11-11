import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import AdminUsersSection from "@/features/admin/components/AdminUsersSection";

/** 회원 관리 (관리자). 가입 승인 대기·승인 완료·전체 회원을 보고 승인 대기 회원을 승인한다 */
export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <>
      <PageHeader title="회원 관리" description="가입 신청한 회원을 확인하고 승인합니다." />
      <Suspense fallback={<AdminLoading label="회원 목록을 불러오고 있습니다." />}>
        <AdminUsersSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
