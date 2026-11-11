import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { AdminLoading } from "@/features/admin/components/AdminNotices";
import EquipmentApiSection from "@/features/equipment/components/EquipmentApiSection";

/** 검사기관 장비·슬롯 운영: 실제 API 데이터만 사용한다. */
export default function EquipmentPage({ searchParams }: PageProps<"/examining/equipment">) {
  return (
    <>
      <PageHeader title="장비·슬롯 운영" description="장비를 고르고 날짜를 선택해 검사 슬롯을 확인합니다." />
      <Suspense fallback={<AdminLoading label="장비 목록을 불러오고 있습니다." />}>
        <EquipmentApiSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}
