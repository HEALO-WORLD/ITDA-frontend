"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, ListChecks, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import Modal from "@/components/ui/Modal";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import {
  AdminDetailButton,
  CloseButton,
  InfoCard,
  NETWORK_FAILURE,
  ShortId,
  TechInfo,
  useDetailResult,
  useUrlDetail,
} from "@/features/admin/components/AdminDetailParts";
import { DetailError, DetailLoading, Empty, Info, SectionNote } from "@/features/referrals/components/ReferralDetailParts";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadExaminingIncidentDetailAction, type ExaminingIncidentDetailResult } from "../detailActions";
import { INCIDENT_PROCESSING_STATUSES, type IncidentProcessingStatusDto, type IncidentReferralItem } from "../remote";
import type { IncidentLoadFailure } from "../server";
import { AUTO_PROCESSING_NOTE, getResultCodeLabel, PROCESSING_STATUS_LABELS as PROCESSING_LABELS } from "../processingLabels";

import ImpactWindowBadge from "./ImpactWindowBadge";
import { ManualReviewBadge, ManualReviewNotice } from "./ManualReviewNotice";

const PARAM = "incidentId";
const PROCESSING_TONE: Record<IncidentProcessingStatusDto, StatusTone> = { PENDING: "neutral", PROCESSING: "info", SUCCEEDED: "success", FAILED: "warning" };
const FAILURE_TITLES: Record<IncidentLoadFailure["reason"], string> = {
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: "장비 장애를 조회할 권한이 없습니다.",
  NOT_FOUND: "장애 정보를 표시할 수 없습니다.",
  NETWORK: "장비 장애 정보를 불러오지 못했습니다.",
  ERROR: "장비 장애 정보를 불러오지 못했습니다.",
};

/** 목록 행의 '상세' 버튼: 주소에 `?incidentId=`만 붙인다 (목록 검색 조건·페이지는 그대로) */
export function IncidentApiDetailButton({ incidentId, label }: { incidentId: string; label: string }) {
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
 * 검사기관 장비 장애 상세 대화상자 (`?incidentId=`, 영향 의뢰 조건 `?referralStatus=`·`?referralPage=`).
 * 이전 목록 아래 상세 패널과 같은 정보를 넓은 대화상자에 보여 준다 (관리자 장애 상세와 같은 구성).
 * - 열 때·영향 의뢰 조건을 바꿀 때만 Server Function으로 장애 단건 + 영향 의뢰를 조회한다
 * - 주소로 여닫는다: 뒤로/앞으로 가기·직접 접근을 지원하고, 닫으면 상세 쿼리만 뺀다 (목록 조건 유지)
 * - 다른 기관 장애·없는 장애는 백엔드 404 → 내용 없이 안내. lastError(ADMIN 전용)는 받지 않는다
 * - 장비 이름은 목록이 이미 받은 우리 기관 장비 목록으로 찾는다 (추가 요청 없음). 없으면 ID로 보인다
 */
export default function IncidentApiDetailModal({ equipmentNames }: { equipmentNames: Record<string, { name: string; modality: string }> | null }) {
  const { id, open, valid, close, searchParams, replaceParams } = useUrlDetail(PARAM, ["referralPage", "referralStatus"]);
  const page = parsePage(searchParams.get("referralPage"));
  const rawStatus = searchParams.get("referralStatus");
  const status = rawStatus && (INCIDENT_PROCESSING_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as IncidentProcessingStatusDto) : null;
  const conditionsValid = page !== null && (rawStatus === null || rawStatus === "" || status !== null);
  const key = valid && conditionsValid ? `${id}|${page}|${status ?? ""}` : null;
  const { value, retry } = useDetailResult<ExaminingIncidentDetailResult>(key, () => loadExaminingIncidentDetailAction(id!, page, status), NETWORK_FAILURE);
  const result: ExaminingIncidentDetailResult | null =
    open && !(valid && conditionsValid) ? { ok: false, reason: "ERROR", message: "장애 상세 조건이 올바르지 않습니다. 목록에서 다시 선택해 주세요.", code: null } : value;
  const incident = result?.ok ? result.incident : null;
  const equipment = incident ? equipmentNames?.[incident.equipmentId.toLowerCase()] : undefined;

  return (
    <Modal
      open={open}
      size="2xl"
      title="장비 장애 상세"
      titleAddon={
        valid && id ? (
          <>
            {incident && <ImpactWindowBadge startAt={incident.startAt} endAt={incident.endAt} />}
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
        <DetailError
          title={FAILURE_TITLES[result.reason]}
          message={result.message}
          // 주소 조건이 틀린 경우는 다시 시도해도 같으므로 버튼을 두지 않는다
          onRetry={key !== null && (result.reason === "NETWORK" || result.reason === "ERROR") ? retry : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <InfoCard icon={Wrench} title="장애 정보">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1">
                  <Info label="장비" strong>
                    {equipment ? (
                      <>
                        {equipment.name}
                        <span className="ml-1.5 text-sm font-normal text-gray-500">{equipment.modality}</span>
                      </>
                    ) : (
                      <ShortId id={incident!.equipmentId} label="장비 ID" />
                    )}
                  </Info>
                  <Info label="상태">
                    <ImpactWindowBadge startAt={incident!.startAt} endAt={incident!.endAt} />
                  </Info>
                  <Info label="장애 발생 시각">{formatDateTimeWithWeekday(incident!.occurredAt)}</Info>
                  <Info label="중단 기간 (시작~종료)">
                    {formatDateTimeWithWeekday(incident!.startAt)} ~ {formatDateTimeWithWeekday(incident!.endAt)}
                  </Info>
                  <Info label="장애 사유">{incident!.reason || <Empty reason="none" />}</Info>
                  <Info label="등록 · 수정 시각">
                    <span className="text-sm font-normal text-gray-600">
                      {formatDateTimeWithWeekday(incident!.createdAt)} · {formatDateTimeWithWeekday(incident!.updatedAt)}
                    </span>
                  </Info>
                </dl>
              </InfoCard>
              <InfoCard icon={ListChecks} title="후속 처리 현황">
                <ul aria-label="후속 처리 건수" className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3">
                  <Count label="전체" value={incident!.totalReferrals} />
                  <Count label={PROCESSING_LABELS.PENDING} value={incident!.pendingCount} />
                  <Count label={PROCESSING_LABELS.PROCESSING} value={incident!.processingCount} />
                  <Count label={PROCESSING_LABELS.SUCCEEDED} value={incident!.completedCount} />
                  <Count label={PROCESSING_LABELS.FAILED} value={incident!.failedCount} alert />
                </ul>
                <p className="mt-2.5 break-keep text-xs leading-relaxed text-gray-500">{AUTO_PROCESSING_NOTE}</p>
              </InfoCard>
            </div>
            <InfoCard icon={AlertTriangle} title="영향받은 의뢰 후속 처리" className="min-w-0 self-start">
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
  referrals: Extract<ExaminingIncidentDetailResult, { ok: true }>["referrals"];
  status: IncidentProcessingStatusDto | null;
  onPage: (page: number) => void;
}) {
  if (!referrals.ok) return <SectionNote>영향받은 의뢰를 불러오지 못했습니다. ({referrals.message})</SectionNote>;
  if (referrals.items.length === 0) return <SectionNote>{status ? "이 상태의 영향 의뢰가 없습니다." : "영향받은 의뢰가 없습니다."}</SectionNote>;
  return (
    <>
      <p className="text-sm text-gray-600">
        총 <span className="font-bold text-primary">{referrals.totalElements}</span>건
        {referrals.totalPages > 1 && <span className="text-gray-500"> · {referrals.page + 1}/{referrals.totalPages}페이지</span>}
      </p>
      <ul className="flex flex-col gap-2">
        {referrals.items.map((item) => (
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

/**
 * 영향 의뢰 1건 (이전 패널 표의 열: 의뢰 ID·예약 ID·처리 상태·결과 코드·재시도·다음 재시도·처리 완료)
 * 수동 확인 대상이면 처리 상태 배지 옆에 "수동 확인 필요" 배지와 카드 아래 안내를 더한다 (테스트에서 직접 렌더링하므로 export)
 */
export function AffectedItem({ item }: { item: IncidentReferralItem }) {
  const manualReview = item.manualReviewRequired === true;
  return (
    <li className={`rounded-lg border bg-white px-3.5 py-3 ${item.processingStatus === "FAILED" || manualReview ? "border-amber-200" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ShortId id={item.referralId} label="의뢰 ID" />
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={PROCESSING_TONE[item.processingStatus]}>{PROCESSING_LABELS[item.processingStatus]}</StatusBadge>
          {manualReview && <ManualReviewBadge />}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        <Small label="예약">
          <ShortId id={item.reservationId} label="예약 ID" />
        </Small>
        <Small label="처리 결과">{item.resultCode ? <ResultCode code={item.resultCode} /> : "없음"}</Small>
        <Small label="재시도">{item.retryCount}회</Small>
        <Small label="다음 재시도">{item.nextRetryAt ? formatDateTimeWithWeekday(item.nextRetryAt) : "없음"}</Small>
        <Small label="자동 처리 시각">{item.processedAt ? formatDateTimeWithWeekday(item.processedAt) : "없음"}</Small>
      </dl>
      {manualReview && <ManualReviewNotice />}
    </li>
  );
}

/** 결과 코드: 알려진 코드는 한글 문구(원래 코드는 title), 모르는 코드는 원래 값 그대로 (화면이 깨지지 않게) */
function ResultCode({ code }: { code: string }) {
  const label = getResultCodeLabel(code);
  return label ? <span title={code}>{label}</span> : <code className="font-mono text-xs">{code}</code>;
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
