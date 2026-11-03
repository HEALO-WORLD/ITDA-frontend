import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import { getNotifications } from "@/features/notifications/api";
import { getFailedEquipments } from "@/features/notifications/reschedule";
import { getReferralById } from "@/features/referrals/api";
import { RESCHEDULE_QUERY_KEY } from "@/features/referrals/reschedule";
import type { ReferralSummary } from "@/features/referrals/types";
import { getPartnerOrganizations } from "@/features/slots/api";
import SlotSearch from "@/features/slots/components/SlotSearch";
import { isApiFeature } from "@/lib/api/config";

/**
 * 검사 슬롯 검색 (S02).
 * `?rescheduleReferralId=`가 있으면 재조정 대체 슬롯 선택 모드로 동작한다.
 * 쿼리는 요청 시점 값이므로 검색 영역을 Suspense 안에서 렌더링한다.
 */
export default function SlotSearchPage({ searchParams }: PageProps<"/referring/slots">) {
  return (
    <>
      <PageHeader
        title="검사 슬롯 검색"
        description="협력 검사기관의 CT·MRI 검사 가능한 시간을 조회합니다."
      />
      <Suspense
        fallback={
          <p
            role="status"
            className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500"
          >
            검사 슬롯 검색 화면을 불러오고 있습니다.
          </p>
        }
      >
        <SlotSearchSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SlotSearchSection({ searchParams }: Pick<PageProps<"/referring/slots">, "searchParams">) {
  const rescheduleReferralId = (await searchParams)[RESCHEDULE_QUERY_KEY];
  const [organizations, rescheduleTarget, notifications] = await Promise.all([
    getPartnerOrganizations(),
    resolveRescheduleTarget(rescheduleReferralId),
    // API 모드(notifications)에서는 알림 응답에 재조정 원인(장애 장비)이 없어 장비를 확인할 수 없다.
    // Mock 알림의 장비로 대신하지 않는다 (빈 목록 → 장애 장비 제외 없이 검색)
    isApiFeature("notifications") ? [] : getNotifications(),
  ]);
  // 재조정 대상 의뢰의 재조정 알림에 기록된 장애 장비 (장비 ID 기준)
  const failedEquipments =
    rescheduleTarget && rescheduleTarget !== "INVALID"
      ? getFailedEquipments(rescheduleTarget.id, notifications)
      : [];
  const modeKey = rescheduleTarget === null || rescheduleTarget === "INVALID" ? String(rescheduleTarget) : rescheduleTarget.id;

  // 재조정 대상이 바뀌면 검색 상태를 초기화한다
  return (
    <SlotSearch
      key={modeKey}
      organizations={organizations}
      rescheduleTarget={rescheduleTarget}
      failedEquipments={failedEquipments}
    />
  );
}

/** 쿼리의 의뢰 id가 재조정 필요 상태의 의뢰일 때만 재조정 모드로 쓴다 */
async function resolveRescheduleTarget(
  rawId: string | string[] | undefined,
): Promise<ReferralSummary | "INVALID" | null> {
  if (rawId === undefined || rawId === "") return null;
  if (typeof rawId !== "string") return "INVALID";
  const referral = await getReferralById(rawId);
  return referral?.status === "RESCHEDULE_REQUIRED" ? referral : "INVALID";
}
