import { Suspense } from "react";

import { isApiAuthMode } from "@/components/auth/ApiRoleGate";
import PageHeader from "@/components/layout/PageHeader";
import AdminInstitutionManager from "@/features/admin/components/AdminInstitutionManager";
import { AdminApiOnlyNotice, AdminFailureNotice, AdminLoading } from "@/features/admin/components/AdminNotices";
import { loadInstitutions } from "@/features/admin/server";

/** 기관 관리 (관리자). 의뢰기관·검사기관을 등록하고 이름·주소를 수정하거나 삭제한다 */
export default function AdminInstitutionsPage() {
  return (
    <>
      <PageHeader title="기관 관리" description="플랫폼에 등록된 의뢰기관·검사기관을 관리합니다." />
      {isApiAuthMode() ? (
        <Suspense fallback={<AdminLoading label="기관 목록을 불러오고 있습니다." />}>
          <InstitutionsSection />
        </Suspense>
      ) : (
        <AdminApiOnlyNotice />
      )}
    </>
  );
}

/** 쿠키를 읽으므로 Suspense 안에서 조회한다. 관리자 역할 확인·조회는 서버 로더가 한다 */
async function InstitutionsSection() {
  const result = await loadInstitutions();
  if (!result.ok) return <AdminFailureNotice failure={result} />;
  return <AdminInstitutionManager institutions={result.institutions} />;
}
