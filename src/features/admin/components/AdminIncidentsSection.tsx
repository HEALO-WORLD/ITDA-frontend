import Link from "next/link";
import type { ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import {
  INCIDENT_PROCESSING_STATUSES,
  INCIDENT_STATUSES,
  isUuid,
  type EquipmentIncidentDto,
  type IncidentProcessingStatusDto,
} from "@/features/incidents/remote";
import { formatDateTime } from "@/lib/format/date";

import { loadAdminIncidentDetail, loadAdminIncidentPage, loadAdminIncidentReferrals, type AdminIncidentListQuery } from "../incidents";
import type { InstitutionDto } from "../remote";
import { loadInstitutions } from "../server";

import { AdminFailureNotice } from "./AdminNotices";

interface AdminIncidentsSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PROCESSING_LABELS: Record<IncidentProcessingStatusDto, string> = { PENDING: "대기", PROCESSING: "처리 중", SUCCEEDED: "처리 완료", FAILED: "실패" };

/**
 * 장비 장애 관리 (관리자, API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 * - 목록: `?institutionId=`(검사기관)·`?equipmentId=`(장비 ID)·`?status=`(OCCURRED, 주소로만: 상태가 하나뿐이라 선택 상자 없음)·`?page=`(1부터). 백엔드가 지원하는 조건만 쓴다
 *   값이 올바르지 않으면 다른 조건으로 바꿔 조회하지 않고 안내만 한다 (요청하지 않는다)
 * - 상세: `?incidentId=`면 장애 정보·처리 현황·영향 의뢰(`?referralStatus=`·`?referralPage=`)를 함께 보여 준다.
 *   영향 의뢰의 lastError(ADMIN에게만 오는 후속 처리 실패 진단)를 보여 준다
 * - 기관명은 관리자 기관 목록으로 찾는다 (실패해도 장애 목록은 보여 준다). 장비 이름은 ADMIN이 조회할 수 있는 장비 API가 없어 ID로 보인다
 * - 백엔드에 없는 재처리·수동 복구는 두지 않는다
 */
export default async function AdminIncidentsSection({ searchParams }: AdminIncidentsSectionProps) {
  const params = await searchParams;
  const query = parseQuery(params);
  if (!query) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "검색 조건(기관·장비 ID·상태·페이지) 값이 올바르지 않습니다. 조건을 다시 선택해 주세요.", code: null }} />;
  }
  const [institutions, list] = await Promise.all([loadInstitutions(), loadAdminIncidentPage(query.list)]);
  if (!list.ok) return <AdminFailureNotice failure={list} />;
  const nameById = new Map((institutions.ok ? institutions.institutions : []).map((item) => [item.id.toLowerCase(), item.name]));
  const examInstitutions = institutions.ok ? institutions.institutions.filter((item) => item.type === "EXAM") : [];

  const listQuery: Record<string, string> = {
    ...(query.list.institutionId ? { institutionId: query.list.institutionId } : {}),
    ...(query.list.equipmentId ? { equipmentId: query.list.equipmentId } : {}),
    ...(query.list.status ? { status: query.list.status } : {}),
  };
  const pageQuery = { ...listQuery, ...(query.list.page > 0 ? { page: String(query.list.page + 1) } : {}) };
  const detailHref = (incidentId: string) => toHref({ ...pageQuery, incidentId });

  return (
    <div className="flex flex-col gap-5">
      <IncidentFilter query={query.list} institutions={examInstitutions} institutionsFailed={!institutions.ok} />

      <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
        총 <span className="font-bold text-primary">{list.totalElements}</span>건의 장비 장애
        {list.totalPages > 0 && <span className="text-gray-500"> · {list.page + 1}/{list.totalPages}페이지</span>}
      </p>

      {list.incidents.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-line px-6 py-16 text-center text-[15px] text-gray-500">
          {list.page > 0 ? "이 페이지에 장비 장애가 없습니다." : Object.keys(listQuery).length ? "검색 조건에 맞는 장비 장애가 없습니다." : "등록된 장비 장애가 없습니다."}
        </div>
      ) : (
        <IncidentTable rows={list.incidents} selectedId={query.incidentId ?? null} detailHref={detailHref} institutionName={(id) => nameById.get(id.toLowerCase())} />
      )}
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="장비 장애 목록 페이지" />

      {query.incidentId && (
        <IncidentDetailPanel
          incidentId={query.incidentId}
          referralPage={query.referralPage}
          referralStatus={query.referralStatus}
          baseQuery={{ ...pageQuery, incidentId: query.incidentId }}
          institutionName={(id) => nameById.get(id.toLowerCase())}
        />
      )}
    </div>
  );
}

/** 상세: 장애 정보 + 처리 현황 + 영향 의뢰(lastError 포함) */
async function IncidentDetailPanel({
  incidentId,
  referralPage,
  referralStatus,
  baseQuery,
  institutionName,
}: {
  incidentId: string;
  referralPage: number;
  referralStatus?: IncidentProcessingStatusDto;
  baseQuery: Record<string, string>;
  institutionName: (id: string) => string | undefined;
}) {
  const [detail, referrals] = await Promise.all([loadAdminIncidentDetail(incidentId), loadAdminIncidentReferrals(incidentId, referralPage, referralStatus)]);
  const closeQuery = Object.fromEntries(Object.entries(baseQuery).filter(([key]) => key !== "incidentId"));
  return (
    <section aria-labelledby="admin-incident-detail-title" className="flex flex-col gap-4 rounded-xl border border-line bg-white px-5 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-incident-detail-title" className="text-xl font-bold text-gray-900">
          장애 상세
        </h2>
        <Link href={toHref(closeQuery)} className={smallLinkClass}>
          닫기
        </Link>
      </div>
      {!detail.ok ? (
        <AdminFailureNotice failure={detail} />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-[15px] sm:grid-cols-2">
            <Field label="장애 ID"><code className="font-mono text-sm">{detail.incident.incidentId}</code></Field>
            <Field label="장애 상태"><StatusBadge status={detail.incident.status} /></Field>
            <Field label="검사기관">{institutionName(detail.incident.institutionId) ?? <code className="font-mono text-sm">{detail.incident.institutionId}</code>}</Field>
            <Field label="장비 ID"><code className="font-mono text-sm">{detail.incident.equipmentId}</code></Field>
            <Field label="장애 발생일시">{formatDateTime(detail.incident.occurredAt)}</Field>
            <Field label="영향 구간">{formatDateTime(detail.incident.startAt)} ~ {formatDateTime(detail.incident.endAt)}</Field>
            <Field label="장애 사유" wide>{detail.incident.reason || <Dash />}</Field>
            <Field label="등록·수정 시각" wide>{formatDateTime(detail.incident.createdAt)} · {formatDateTime(detail.incident.updatedAt)}</Field>
          </dl>
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-gray-800">후속 처리 현황</h3>
            <ul className="flex flex-wrap gap-2 text-sm">
              <CountChip label="전체" value={detail.incident.totalReferrals} />
              <CountChip label="대기" value={detail.incident.pendingCount} />
              <CountChip label="처리 중" value={detail.incident.processingCount} />
              <CountChip label="처리 완료" value={detail.incident.completedCount} />
              <CountChip label="실패" value={detail.incident.failedCount} />
            </ul>
          </div>
        </>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold text-gray-800">영향받은 의뢰</h3>
        <nav aria-label="후속 처리 상태 필터" className="flex flex-wrap gap-2">
          {[undefined, ...INCIDENT_PROCESSING_STATUSES].map((value) => {
            const active = value === referralStatus;
            const label = value ? PROCESSING_LABELS[value] : "전체";
            return active ? (
              <span key={label} aria-current="true" className={`${chipClass} border-primary bg-primary text-white`}>{label}</span>
            ) : (
              <Link key={label} href={toHref({ ...baseQuery, ...(value ? { referralStatus: value } : {}) })} className={`${chipClass} border-line bg-white text-gray-700 hover:bg-gray-50`}>
                {label}
              </Link>
            );
          })}
        </nav>
        {!referrals.ok ? (
          <AdminFailureNotice failure={referrals} />
        ) : referrals.referrals.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-[15px] text-gray-500">
            {referralStatus ? "이 상태의 영향 의뢰가 없습니다." : "영향받은 의뢰가 없습니다."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[1080px] border-collapse">
              <thead className="bg-gray-100/80">
                <tr>
                  <th scope="col" className={thClass}>의뢰 ID</th>
                  <th scope="col" className={thClass}>예약 ID</th>
                  <th scope="col" className={`${thClass} text-center`}>처리 상태</th>
                  <th scope="col" className={`${thClass} text-center`}>재시도</th>
                  <th scope="col" className={thClass}>다음 재시도</th>
                  <th scope="col" className={thClass}>결과 코드</th>
                  <th scope="col" className={thClass}>처리 시각</th>
                  <th scope="col" className={thClass}>마지막 오류 (관리자 전용)</th>
                </tr>
              </thead>
              <tbody>
                {referrals.referrals.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className={tdClass}><code className="font-mono text-xs" title={item.referralId}>{short(item.referralId)}</code></td>
                    <td className={tdClass}><code className="font-mono text-xs" title={item.reservationId}>{short(item.reservationId)}</code></td>
                    <td className={`${tdClass} text-center`}>
                      <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${PROCESSING_CLASS[item.processingStatus]}`}>
                        {PROCESSING_LABELS[item.processingStatus]}
                      </span>
                    </td>
                    <td className={`${tdClass} text-center tabular-nums`}>{item.retryCount}</td>
                    <td className={`${tdClass} whitespace-nowrap text-sm`}>{item.nextRetryAt ? formatDateTime(item.nextRetryAt) : <Dash />}</td>
                    <td className={`${tdClass} text-sm`}>{item.resultCode ?? <Dash />}</td>
                    <td className={`${tdClass} whitespace-nowrap text-sm`}>{item.processedAt ? formatDateTime(item.processedAt) : <Dash />}</td>
                    <td className={`${tdClass} max-w-[320px]`}>
                      {item.lastError ? <code className="block break-all font-mono text-xs text-red-700">{item.lastError}</code> : <Dash />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {referrals.ok && (
          <NotificationPagination
            page={referrals.page}
            totalPages={referrals.totalPages}
            query={Object.fromEntries(Object.entries({ ...baseQuery, ...(referralStatus ? { referralStatus } : {}) }))}
            pageParam="referralPage"
            label="영향 의뢰 페이지"
          />
        )}
      </div>
    </section>
  );
}

/** 검색 조건 (일반 GET 폼: 검색하면 첫 페이지로 간다) */
function IncidentFilter({ query, institutions, institutionsFailed }: { query: AdminIncidentListQuery; institutions: InstitutionDto[]; institutionsFailed: boolean }) {
  return (
    <form role="search" aria-label="장비 장애 검색 조건" action={ROUTES.admin.incidents} method="get" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select name="institutionId" aria-label="검사기관" defaultValue={query.institutionId ?? ""} disabled={institutionsFailed} className={`${controlClass} min-w-[180px] flex-[1_1_180px] disabled:bg-gray-50 disabled:text-gray-400`}>
          <option value="">전체 검사기관</option>
          {institutions.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <input
          name="equipmentId"
          defaultValue={query.equipmentId ?? ""}
          placeholder="장비 ID (UUID)"
          aria-label="장비 ID (전체 UUID)"
          autoComplete="off"
          className={`${controlClass} min-w-[240px] flex-[2_1_280px] font-mono`}
        />
        {/* 장애 상태는 백엔드 EquipmentIncidentStatus가 OCCURRED 하나뿐이라 선택 상자를 두지 않는다.
            주소로 받은 ?status=는 검색해도 유지한다 (백엔드 status 조건 지원은 그대로) */}
        {query.status && <input type="hidden" name="status" value={query.status} />}
        <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-bold text-white hover:bg-primary-hover">
          검색
        </button>
        <Link href={ROUTES.admin.incidents} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
          초기화
        </Link>
      </div>
      {institutionsFailed && (
        <p role="status" className="text-sm text-amber-700">기관 목록을 불러오지 못해 검사기관 조건을 쓸 수 없고, 기관은 ID로 표시합니다. 장애 목록은 그대로 확인할 수 있습니다.</p>
      )}
    </form>
  );
}

function IncidentTable({
  rows,
  selectedId,
  detailHref,
  institutionName,
}: {
  rows: EquipmentIncidentDto[];
  selectedId: string | null;
  detailHref: (incidentId: string) => string;
  institutionName: (id: string) => string | undefined;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[1040px] border-collapse">
        <thead className="bg-gray-100/80">
          <tr>
            <th scope="col" className={thClass}>장애 발생일시</th>
            <th scope="col" className={thClass}>검사기관</th>
            <th scope="col" className={thClass}>장비 ID</th>
            <th scope="col" className={thClass}>장애 사유</th>
            <th scope="col" className={thClass}>영향 구간</th>
            <th scope="col" className={`${thClass} text-center`}>장애 상태</th>
            <th scope="col" className={`${thClass} text-center`}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((incident) => {
            const isSelected = incident.incidentId.toLowerCase() === selectedId?.toLowerCase();
            return (
              <tr key={incident.incidentId} className={`border-t border-line transition-colors ${isSelected ? "bg-primary-soft" : "hover:bg-gray-50"}`}>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(incident.occurredAt)}</td>
                <td className={tdClass}>
                  {institutionName(incident.institutionId) ?? <code className="font-mono text-xs" title={incident.institutionId}>{short(incident.institutionId)}</code>}
                </td>
                <td className={tdClass}>
                  <code className="font-mono text-xs text-gray-700" title={incident.equipmentId}>{short(incident.equipmentId)}</code>
                </td>
                <td className={`${tdClass} max-w-[280px] truncate`} title={incident.reason}>{incident.reason || <Dash />}</td>
                <td className={`${tdClass} whitespace-nowrap text-sm tabular-nums`}>{formatDateTime(incident.startAt)} ~ {formatDateTime(incident.endAt)}</td>
                <td className={`${tdClass} text-center`}><StatusBadge status={incident.status} /></td>
                <td className={`${tdClass} text-center`}>
                  <Link
                    href={detailHref(incident.incidentId)}
                    aria-label={`${formatDateTime(incident.occurredAt)} 장애 상세 보기`}
                    aria-current={isSelected ? "true" : undefined}
                    className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-primary bg-white px-3.5 text-sm font-semibold text-primary hover:bg-primary-soft"
                  >
                    상세
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 주소 조건 → 조회 조건. 빈 값은 조건 없음, 올바르지 않은 값은 null (다른 값으로 바꾸지 않는다) */
function parseQuery(params: Record<string, string | string[] | undefined>):
  | { list: AdminIncidentListQuery; incidentId?: string; referralPage: number; referralStatus?: IncidentProcessingStatusDto }
  | null {
  const keys = ["page", "institutionId", "equipmentId", "status", "incidentId", "referralPage", "referralStatus"] as const;
  if (keys.some((key) => Array.isArray(params[key]))) return null;
  const get = (key: (typeof keys)[number]) => (typeof params[key] === "string" ? (params[key] as string).trim() : "");
  const page = parsePage(get("page"));
  const referralPage = parsePage(get("referralPage"));
  if (page === null || referralPage === null) return null;
  const list: AdminIncidentListQuery = { page };
  for (const key of ["institutionId", "equipmentId"] as const) {
    const value = get(key);
    if (value) {
      if (!isUuid(value)) return null;
      list[key] = value;
    }
  }
  const status = get("status");
  if (status) {
    if (!(INCIDENT_STATUSES as readonly string[]).includes(status)) return null;
    list.status = status as (typeof INCIDENT_STATUSES)[number];
  }
  const incidentId = get("incidentId");
  if (incidentId && !isUuid(incidentId)) return null;
  const referralStatus = get("referralStatus");
  if (referralStatus && !(INCIDENT_PROCESSING_STATUSES as readonly string[]).includes(referralStatus)) return null;
  return {
    list,
    incidentId: incidentId || undefined,
    referralPage,
    referralStatus: (referralStatus || undefined) as IncidentProcessingStatusDto | undefined,
  };
}

/** 주소 `?page=`(1부터) → 0부터. 없으면 0, 올바르지 않으면 null */
function parsePage(raw: string): number | null {
  if (raw === "") return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw) - 1;
  return Number.isSafeInteger(page) ? page : null;
}

function toHref(query: Record<string, string>): string {
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== "")).toString();
  return search ? `${ROUTES.admin.incidents}?${search}` : ROUTES.admin.incidents;
}

const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

function StatusBadge({ status }: { status: string }) {
  const isOccurred = status === "OCCURRED";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${isOccurred ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-700"}`}>
      <span className={`size-1.5 rounded-full ${isOccurred ? "bg-red-500" : "bg-gray-400"}`} aria-hidden="true" />
      {isOccurred ? "장애 발생" : status}
    </span>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-900">{children}</dd>
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-md bg-gray-100 px-3 py-1.5 text-gray-700">
      {label} <span className="font-semibold tabular-nums text-gray-900">{value}</span>
    </li>
  );
}

function Dash() {
  return <span className="text-gray-400">-</span>;
}

const PROCESSING_CLASS: Record<IncidentProcessingStatusDto, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  PROCESSING: "bg-primary-soft text-primary",
  SUCCEEDED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-600",
};

// 검사기관 장애 화면(IncidentApiSection)과 같은 표 모양
const thClass = "whitespace-nowrap px-4 py-3.5 text-left text-sm font-semibold text-gray-700";
const tdClass = "px-4 py-3.5 text-[15px] text-gray-900";
const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const chipClass = "inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium";
const smallLinkClass = "inline-flex h-8 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50";
