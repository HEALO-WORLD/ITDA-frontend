import Link from "next/link";
import { Suspense } from "react";

import PageHeader from "@/components/layout/PageHeader";
import FeatureNotReady from "@/components/ui/FeatureNotReady";
import { getNotifications } from "@/features/notifications/api";
import { getFailedEquipments } from "@/features/notifications/reschedule";
import { getReferralById } from "@/features/referrals/api";
import { RESCHEDULE_QUERY_KEY } from "@/features/referrals/reschedule";
import { loadApiRescheduleTarget } from "@/features/referrals/rescheduleTarget";
import type { ReferralSummary } from "@/features/referrals/types";
import { getPartnerOrganizations } from "@/features/slots/api";
import SlotSearch from "@/features/slots/components/SlotSearch";
import { isApiSlotSearchAvailable, loadApiSlotSearchOrganizations } from "@/features/slots/server";
import { ROUTES } from "@/constants/navigation";
import { getScreenDataSource, isApiFeature } from "@/lib/api/config";

/**
 * 검사 슬롯 검색 (S02).
 * `?rescheduleReferralId=`가 있으면 재조정 대체 슬롯 선택 모드로 동작한다.
 * API 모드: 협력 검사기관은 서버에서 조회하고, 검색·달력은 Client Component가 `/referring/slots/search`(GET Route Handler)로 조회한다.
 * API 재조정 모드: 대상 의뢰를 서버에서 조회(NEEDS_RESCHEDULE 확인)하고, 검사 유형을 의뢰 값으로 고정해 대체 슬롯을 고른다 (Mock 데이터를 쓰지 않는다).
 * 쿼리는 요청 시점 값이므로 검색 영역을 Suspense 안에서 렌더링한다.
 */
export default function SlotSearchPage({ searchParams }: PageProps<"/referring/slots">) {
  // itda-brand: ITDA 브랜드 디자인 시범 범위 (globals.css). 이 화면 안에서만 네이비·민트 색을 쓴다
  return (
    <div className="itda-brand">
      <PageHeader
        title="검사 슬롯 검색"
        description="협력 검사기관의 CT·MRI 검사 가능한 시간을 조회합니다."
      />
      <Suspense
        fallback={
          <p
            role="status"
            className="rounded-xl border border-line bg-white px-6 py-16 text-center text-[15px] text-gray-500 shadow-card"
          >
            검사 슬롯 검색 화면을 불러오고 있습니다.
          </p>
        }
      >
        <SlotSearchSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SlotSearchSection({ searchParams }: Pick<PageProps<"/referring/slots">, "searchParams">) {
  const rescheduleReferralId = (await searchParams)[RESCHEDULE_QUERY_KEY];
  const source = getScreenDataSource("slots");
  if (source !== "mock") {
    // API 모드: 검색에 필요한 기능(slots·partnerships·equipment)이 모두 켜져 있어야 한다. Mock 기관·슬롯·의뢰·알림을 쓰지 않는다
    if (source === "not-ready" || !isApiSlotSearchAvailable()) return <FeatureNotReady />;
    const isRescheduleRequested = rescheduleReferralId !== undefined && rescheduleReferralId !== "";
    // 재예약 Server Function은 referrals·slots·equipment가 모두 API 대상이어야 한다. 아니면 일반 검색 + 안내 (Mock 의뢰를 쓰지 않는다)
    const canReschedule = isRescheduleRequested && isApiFeature("referrals");
    const [result, reschedule] = await Promise.all([
      loadApiSlotSearchOrganizations(),
      canReschedule ? loadApiRescheduleTarget(rescheduleReferralId) : Promise.resolve(null),
    ]);
    if (!result.ok) return <ApiLoadFailure reason={result.reason} message={result.message} />;
    // 재조정 대상이 바뀌면 검색 상태를 초기화한다
    return (
      <SlotSearch
        key={reschedule?.ok ? reschedule.target.referralId : String(rescheduleReferralId ?? "")}
        dataSource="api"
        organizations={result.organizations}
        examTypeOptions={result.examTypes}
        apiReschedule={reschedule}
        isApiRescheduleRequested={isRescheduleRequested && !canReschedule}
      />
    );
  }
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

/** API 모드에서 검색 조건(협력 검사기관)을 불러오지 못했을 때 (Mock으로 채우지 않는다) */
function ApiLoadFailure({ reason, message }: { reason: string; message: string }) {
  const isSignedOut = reason === "SIGNED_OUT" || reason === "UNAUTHORIZED";
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-white px-6 py-16 text-center text-[15px] text-red-600 shadow-card"
    >
      <p>{isSignedOut ? "로그인 정보가 만료되었습니다. 다시 로그인해 주세요." : `협력 검사기관 정보를 불러오지 못했습니다. ${message}`}</p>
      {isSignedOut && (
        <Link href={ROUTES.login} className="font-semibold text-primary underline underline-offset-4">
          로그인 화면으로 이동
        </Link>
      )}
    </div>
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
