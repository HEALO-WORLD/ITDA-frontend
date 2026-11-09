"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, ListChecks, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import { ROUTES } from "@/constants/navigation";
import { ManualReviewBadge, ManualReviewNotice } from "@/features/incidents/components/ManualReviewNotice";
import { INCIDENT_PROCESSING_STATUSES, type IncidentProcessingStatusDto } from "@/features/incidents/remote";
import { DetailLoading, Empty, Info, SectionNote } from "@/features/referrals/components/ReferralDetailParts";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadAdminIncidentDetailAction, type AdminIncidentDetailResult } from "../detailActions";
import type { AdminIncidentReferral } from "../incidents";

import { AdminDetailButton, AdminDetailError, CloseButton, InfoCard, NETWORK_FAILURE, ShortId, shortIdText, TechInfo, useDetailResult, useUrlDetail } from "./AdminDetailParts";

const PARAM = "incidentId";
const PROCESSING_LABELS: Record<IncidentProcessingStatusDto, string> = { PENDING: "대기", PROCESSING: "처리 중", SUCCEEDED: "처리 완료", FAILED: "실패" };
const PROCESSING_TONE: Record<IncidentProcessingStatusDto, StatusTone> = { PENDING: "neutral", PROCESSING: "info", SUCCEEDED: "success", FAILED: "warning" };

/** 목록 행의 '상세' 버튼 */
export function AdminIncidentDetailButton({ incidentId, label }: { incidentId: string; label: string }) {
  return <AdminDetailButton param={PARAM} id={incidentId} label={label} />;
}

/** 주소 `?referralPage=`(1부터) → 0부터. 올바르지 않으면 null */
function parsePage(raw: string | null): number | null {
  if (raw === null || raw === "") return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw) - 1;
  return Number.isSafeInteger(page) ? page : null;
}

/**
 * 관리자 장비 장애 상세 대화상자 (`?incidentId=`, 영향 의뢰 조건 `?referralStatus=`·`?referralPage=`).
 * 데스크톱 2단: 왼쪽 장애 정보·후속 처리 현황 / 오른쪽 영향받은 의뢰(상태 필터·페이지).
 * 영향 의뢰의 lastError는 관리자 로더에서만 오는 값이라 관리자 화면에서만 보인다 (검사기관 화면 로더는 그대로 버린다).
 */
export default function AdminIncidentDetailModal({ institutionNames }: { institutionNames: Record<string, string> }) {
  const { id, open, valid, close, searchParams, replaceParams } = useUrlDetail(PARAM, ["referralPage", "referralStatus"]);
  const page = parsePage(searchParams.get("referralPage"));
  const rawStatus = searchParams.get("referralStatus");
  const status = rawStatus && (INCIDENT_PROCESSING_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as IncidentProcessingStatusDto) : null;
  const conditionsValid = page !== null && (rawStatus === null || rawStatus === "" || status !== null);
  const key = valid && conditionsValid ? `${id}|${page}|${status ?? ""}` : null;
  const { value, retry } = useDetailResult<AdminIncidentDetailResult>(key, () => loadAdminIncidentDetailAction(id!, page, status), NETWORK_FAILURE);
  const result: AdminIncidentDetailResult | null =
    open && !(valid && conditionsValid) ? { ok: false, reason: "ERROR", message: "장애 상세 조건이 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null } : value;
  const incident = result?.ok ? result.incident : null;

  return (
    <Modal
      open={open}
      size="2xl"
      title="장비 장애 상세"
      titleAddon={
        valid && id ? (
          <>
            {incident && <StatusBadge tone={incident.status === "OCCURRED" ? "danger" : "neutral"}>{incident.status === "OCCURRED" ? "장애 발생" : incident.status}</StatusBadge>}
            <div className="basis-full sm:basis-auto">
              <ShortId id={id} label="장애 ID" />
            </div>
          </>
        ) : null
      }
      onClose={close}
      footer={<CloseButton onClose={close} />}
    >
      {!result ? (
        <DetailLoading />
      ) : !result.ok ? (
        <AdminDetailError failure={result} onRetry={retry} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <InfoCard icon={Wrench} title="장애 정보">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1">
                  <Info label="장애 발생 기관" strong>{institutionNames[incident!.institutionId.toLowerCase()] ?? <ShortId id={incident!.institutionId} label="기관 ID" />}</Info>
                  <Info label="장비">
                    <ShortId id={incident!.equipmentId} label="장비 ID" />
                    <span className="mt-1 block text-xs font-normal text-gray-500">장비 이름은 관리자 권한으로 조회할 수 없어 ID로 표시합니다.</span>
                  </Info>
                  <Info label="장애 사유">{incident!.reason || <Empty reason="none" />}</Info>
                  <Info label="장애 발생 시각">{formatDateTimeWithWeekday(incident!.occurredAt)}</Info>
                  <Info label="영향 구간 (시작~종료)">
                    {formatDateTimeWithWeekday(incident!.startAt)} ~ {formatDateTimeWithWeekday(incident!.endAt)}
                  </Info>
                  <Info label="등록 · 수정 시각">
                    <span className="text-sm font-normal text-gray-600">
                      {formatDateTimeWithWeekday(incident!.createdAt)} · {formatDateTimeWithWeekday(incident!.updatedAt)}
                    </span>
                  </Info>
                </dl>
              </InfoCard>
              <InfoCard icon={ListChecks} title="후속 처리 현황">
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3">
                  <Count label="전체" value={incident!.totalReferrals} />
                  <Count label="대기" value={incident!.pendingCount} />
                  <Count label="처리 중" value={incident!.processingCount} />
                  <Count label="처리 완료" value={incident!.completedCount} />
                  <Count label="실패" value={incident!.failedCount} alert />
                </ul>
              </InfoCard>
            </div>
            <InfoCard icon={AlertTriangle} title="영향받은 의뢰" className="min-w-0 self-start">
              <div className="flex flex-col gap-3">
                <div role="group" aria-label="후속 처리 상태 필터" className="flex flex-wrap gap-1.5">
                  {[null, ...INCIDENT_PROCESSING_STATUSES].map((value) => {
                    const active = value === status;
                    return (
                      <button
                        key={value ?? "ALL"}
                        type="button"
                        aria-pressed={active}
                        onClick={() => replaceParams({ referralStatus: value, referralPage: null })}
                        className={`inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors ${active ? "border-primary bg-primary text-white" : "border-line bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        {value ? PROCESSING_LABELS[value] : "전체"}
                      </button>
                    );
                  })}
                </div>
                <AffectedReferrals referrals={result.referrals} status={status} onPage={(next) => replaceParams({ referralPage: next > 0 ? String(next + 1) : null })} />
              </div>
            </InfoCard>
          </div>
          <TechInfo
            items={[
              ["장애 ID", incident!.incidentId],
              ["장비 ID", incident!.equipmentId],
              ["기관 ID", incident!.institutionId],
            ]}
          />
        </div>
      )}
    </Modal>
  );
}

function Count({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  const highlight = alert && value > 0;
  return (
    <li className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 ${highlight ? "border-amber-200 bg-amber-50" : "border-line bg-white"}`}>
      <span className={`text-xs font-medium ${highlight ? "text-amber-800" : "text-gray-500"}`}>{label}</span>
      <span className={`text-lg font-bold tabular-nums ${highlight ? "text-amber-900" : "text-gray-900"}`}>{value}</span>
    </li>
  );
}

function AffectedReferrals({
  referrals,
  status,
  onPage,
}: {
  referrals: Extract<AdminIncidentDetailResult, { ok: true }>["referrals"];
  status: IncidentProcessingStatusDto | null;
  onPage: (page: number) => void;
}) {
  if (!referrals.ok) return <SectionNote>영향받은 의뢰를 불러오지 못했습니다. ({referrals.message})</SectionNote>;
  if (referrals.referrals.length === 0) return <SectionNote>{status ? "이 상태의 영향 의뢰가 없습니다." : "영향받은 의뢰가 없습니다."}</SectionNote>;
  return (
    <>
      <p className="text-sm text-gray-600">
        총 <span className="font-bold text-primary">{referrals.totalElements}</span>건
        {referrals.totalPages > 1 && <span className="text-gray-500"> · {referrals.page + 1}/{referrals.totalPages}페이지</span>}
      </p>
      <ul className="flex flex-col gap-2">
        {referrals.referrals.map((item) => (
          <AffectedItem key={item.id} item={item} />
        ))}
      </ul>
      {referrals.totalPages > 1 && (
        <nav aria-label="영향 의뢰 페이지" className="flex items-center justify-end gap-1.5">
          <PageButton label="이전 페이지" disabled={referrals.page === 0} onClick={() => onPage(referrals.page - 1)} icon={ChevronLeft} />
          <PageButton label="다음 페이지" disabled={referrals.page + 1 >= referrals.totalPages} onClick={() => onPage(referrals.page + 1)} icon={ChevronRight} />
        </nav>
      )}
    </>
  );
}

// 수동 확인 대상이면 처리 상태 배지 옆에 "수동 확인 필요" 배지와 카드 아래 안내를 더한다 (테스트에서 직접 렌더링하므로 export)
export function AffectedItem({ item }: { item: AdminIncidentReferral }) {
  const manualReview = item.manualReviewRequired === true;
  return (
    <li className={`rounded-lg border bg-white px-3.5 py-3 ${item.processingStatus === "FAILED" || manualReview ? "border-amber-200" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ShortId id={item.referralId} label="의뢰 ID" />
          <Link href={`${ROUTES.admin.referrals}?referralId=${item.referralId}`} className="text-sm font-semibold text-primary hover:underline">
            의뢰 상세
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={PROCESSING_TONE[item.processingStatus]}>{PROCESSING_LABELS[item.processingStatus]}</StatusBadge>
          {manualReview && <ManualReviewBadge />}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
        <Small label="재시도">{item.retryCount}회</Small>
        <Small label="다음 재시도">{item.nextRetryAt ? formatDateTimeWithWeekday(item.nextRetryAt) : "없음"}</Small>
        <Small label="결과 코드">{item.resultCode ?? "없음"}</Small>
        <Small label="처리 시각">{item.processedAt ? formatDateTimeWithWeekday(item.processedAt) : "없음"}</Small>
        <Small label="예약">
          <span className="font-mono text-xs" title={item.reservationId}>
            {shortIdText(item.reservationId)}
          </span>
        </Small>
      </dl>
      {manualReview && <ManualReviewNotice />}
      {item.lastError && (
        <div className="mt-2.5">
          <p className="mb-1 text-xs font-semibold text-amber-800">마지막 오류 (관리자 전용)</p>
          <code className="block break-all rounded-md bg-amber-50 px-2 py-1.5 font-mono text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">{item.lastError}</code>
        </div>
      )}
    </li>
  );
}

function Small({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="truncate text-gray-800">{children}</dd>
    </div>
  );
}

function PageButton({ label, disabled, onClick, icon: Icon }: { label: string; disabled: boolean; onClick: () => void; icon: typeof ChevronLeft }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
