import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getScreenDataSource } from "@/lib/api/config";
import { getCurrentExaminingOrganizationId, IS_MOCK_DATA } from "@/features/equipment/api";
import EquipmentSlotWorkspace from "@/features/equipment/components/EquipmentSlotWorkspace";
import EquipmentSummary from "@/features/equipment/components/EquipmentSummary";

/**
 * 장비·슬롯 운영 (S05).
 * 장비 선택 → 날짜 확인 → 그날 슬롯 조회, 장비 등록·수정, 운영 시간 수정, 슬롯 생성·운영 중단(개발용 Mock).
 * 장비·슬롯 변경분은 브라우저 저장소에 있어 서버에서는 읽지 않고, 화면(Client Component)에서 원본과 합쳐 보여 준다.
 * API 모드: 장비·슬롯 API 연동이 아직 없어 준비 중으로 안내한다 (Mock 장비·브라우저 저장소 데이터를 쓰지 않는다).
 */
export default async function EquipmentPage() {
  if (getScreenDataSource(null) === "not-ready") {
    return (
      <>
        <PageHeader title="장비·슬롯 운영" description="장비를 고르고 날짜를 선택해 검사 슬롯을 확인합니다." />
        <FeatureNotReady />
      </>
    );
  }
  const organizationId = await getCurrentExaminingOrganizationId();

  return (
    <>
      <PageHeader
        title="장비·슬롯 운영"
        description="장비를 고르고 날짜를 선택해 검사 슬롯을 확인합니다."
      />
      {IS_MOCK_DATA && (
        <p className="-mt-3 mb-4 inline-block rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          개발용 예시 데이터
        </p>
      )}

      {organizationId ? (
        <div className="flex flex-col gap-5">
          <EquipmentSummary organizationId={organizationId} />
          <EquipmentSlotWorkspace organizationId={organizationId} />
        </div>
      ) : (
        <p role="status" className="rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500">
          검사기관 정보를 확인할 수 없습니다.
        </p>
      )}
    </>
  );
}
