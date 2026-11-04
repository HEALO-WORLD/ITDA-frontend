import Link from "next/link";
import type { ReactNode } from "react";

import { parsePageParam } from "@/features/examinations/server";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { ROUTES } from "@/constants/navigation";
import { formatDateTime } from "@/lib/format/date";

import {
  INCIDENT_PROCESSING_STATUSES,
  isUuid,
  type EquipmentIncidentDetailDto,
  type EquipmentIncidentDto,
  type IncidentProcessingStatusDto,
  type IncidentReferralDto,
} from "../remote";
import {
  loadIncidentDetail,
  loadIncidentPage,
  loadIncidentReferralPage,
  type IncidentLoadFailure,
} from "../server";

type SearchParams = Record<string, string | string[] | undefined>;

interface IncidentApiSectionProps {
  searchParams: Promise<SearchParams>;
}

/** 화면 주소 쿼리 이름 */
const Q = {
  page: "page",
  equipmentId: "equipmentId",
  incidentId: "incidentId",
  referralStatus: "referralStatus",
  referralPage: "referralPage",
} as const;

const PROCESSING_LABELS: Record<IncidentProcessingStatusDto, string> = {
  PENDING: "대기",
  PROCESSING: "처리 중",
  SUCCEEDED: "처리 완료",
  FAILED: "실패",
};

/**
 * 장비 장애·재조정 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 *
 * - 목록: `?page=`(1부터) 백엔드 페이지, `?equipmentId=` 장비 필터 (백엔드 지원 필터. 장애 상태는 OCCURRED 하나뿐이라 필터를 두지 않는다)
 * - 상세: `?incidentId=`면 장애 상세와 영향 의뢰 처리 현황(`?referralStatus=`·`?referralPage=`)을 함께 보여 준다
 * - 접근 제어는 Gateway(토큰·역할)와 백엔드(기관 범위)가 한다. 프론트는 역할을 추정하지 않고 결과(401·403·404)를 안내한다
 * - 백엔드에 없는 기능·정보는 두지 않는다: 장애 등록·복구, 요약, 발생일 기간 검색, 장애번호·장비명, 영향 예약의 의뢰번호·예약 일시
 * - 실패해도 Mock 데이터로 대체하지 않는다
 */
export default async function IncidentApiSection({ searchParams }: IncidentApiSectionProps) {
  const params = await searchParams;
  const page = parsePageParam(params[Q.page]);
  const rawEquipmentId = first(params[Q.equipmentId]);
  const equipmentId = isUuid(rawEquipmentId) ? rawEquipmentId : undefined;
  const rawIncidentId = first(params[Q.incidentId]);
  const rawReferralStatus = first(params[Q.referralStatus]);
  const referralStatus = INCIDENT_PROCESSING_STATUSES.find((status) => status === rawReferralStatus);
  const referralPage = parsePageParam(params[Q.referralPage]);

  const [list, detail] = await Promise.all([
    loadIncidentPage(page, equipmentId),
    rawIncidentId === undefined
      ? null
      : isUuid(rawIncidentId)
        ? Promise.all([
            loadIncidentDetail(rawIncidentId),
            loadIncidentReferralPage(rawIncidentId, referralPage, referralStatus),
          ])
        : ("INVALID_ID" as const),
  ]);

  if (!list.ok) return <FailureNotice failure={list} />;

  const listQuery: Record<string, string> = equipmentId ? { [Q.equipmentId]: equipmentId } : {};

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="incident-api-list-title"
        className="min-w-0 rounded-xl border border-line bg-white px-4 pb-4 pt-5 sm:px-6"
      >
        <h2 id="incident-api-list-title" className="mb-3 text-lg font-bold text-gray-900">
          장애 목록
          <span className="ml-2 text-base font-semibold tabular-nums text-primary">{list.totalElements}건</span>
        </h2>

        {rawEquipmentId !== undefined && (
          <p role="status" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-700">
            {equipmentId ? (
              <>
                <span>
                  장비 <code className="font-mono text-xs">{equipmentId}</code>의 장애만 표시합니다.
                </span>
              </>
            ) : (
              <span className="text-red-600">장비 ID 형식이 올바르지 않아 전체 장애를 표시합니다.</span>
            )}
            <Link href={toHref({})} className={smallLinkClass}>
              장비 필터 해제
            </Link>
          </p>
        )}

        {list.items.length === 0 ? (
          <p
            role="status"
            className="rounded-lg border border-dashed border-line px-6 py-14 text-center text-[15px] text-gray-500"
          >
            {page > 0 ? "이 페이지에 장애가 없습니다." : equipmentId ? "이 장비의 장애 이력이 없습니다." : "장애 이력이 없습니다."}
          </p>
        ) : (
          <IncidentApiTable
            rows={list.items}
            selectedId={isUuid(rawIncidentId) ? rawIncidentId : null}
            detailHref={(incidentId) => `${toHref({ ...listQuery, [Q.page]: String(page + 1), [Q.incidentId]: incidentId })}#incident-detail`}
            equipmentHref={(id) => toHref({ [Q.equipmentId]: id })}
          />
        )}

        <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="장애 목록 페이지" />
      </section>

      {detail !== null && (
        <section
          id="incident-detail"
          aria-labelledby="incident-detail-title"
          className="min-w-0 rounded-xl border border-line bg-white px-4 pb-4 pt-5 sm:px-6"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="incident-detail-title" className="text-lg font-bold text-gray-900">
              장애 상세
            </h2>
            <Link href={toHref({ ...listQuery, [Q.page]: String(page + 1) })} className={smallLinkClass}>
              상세 닫기
            </Link>
          </div>
          {detail === "INVALID_ID" ? (
            <InlineError>장애 ID 형식이 올바르지 않습니다.</InlineError>
          ) : (
            <IncidentApiDetail
              detail={detail[0]}
              referrals={detail[1]}
              referralStatus={referralStatus}
              baseQuery={{ ...listQuery, [Q.page]: String(page + 1), [Q.incidentId]: rawIncidentId as string }}
            />
          )}
        </section>
      )}
    </div>
  );
}

function IncidentApiTable({
  rows,
  selectedId,
  detailHref,
  equipmentHref,
}: {
  rows: EquipmentIncidentDto[];
  selectedId: string | null;
  detailHref: (incidentId: string) => string;
  equipmentHref: (equipmentId: string) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
      <table className="w-full min-w-[1000px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[160px]" />
          <col className="w-[330px]" />
          <col />
          <col className="w-[290px]" />
          <col className="w-[100px]" />
          <col className="w-[96px]" />
        </colgroup>
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>장애 발생일시</th>
            <th scope="col" className={thClass}>장비 ID</th>
            <th scope="col" className={thClass}>장애 사유</th>
            <th scope="col" className={thClass}>영향 구간</th>
            <th scope="col" className={`${thClass} text-center!`}>장애 상태</th>
            <th scope="col" className={`${thClass} text-center!`}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((incident) => {
            const isSelected = incident.incidentId.toLowerCase() === selectedId?.toLowerCase();
            return (
              <tr
                key={incident.incidentId}
                className={`border-t border-line transition-colors ${isSelected ? "bg-primary-soft" : "hover:bg-gray-50"}`}
              >
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(incident.occurredAt)}</td>
                <td className={tdClass}>
                  <code className="block truncate font-mono text-xs text-gray-700" title={incident.equipmentId}>
                    {incident.equipmentId}
                  </code>
                  <Link href={equipmentHref(incident.equipmentId)} className="text-xs font-medium text-primary hover:underline">
                    이 장비의 장애만 보기
                  </Link>
                </td>
                <td className={`${tdClass} truncate`} title={incident.reason}>
                  {incident.reason || <span className="text-gray-400">-</span>}
                </td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums text-sm`}>
                  {formatDateTime(incident.startAt)} ~ {formatDateTime(incident.endAt)}
                </td>
                <td className={`${tdClass} text-center`}>
                  <IncidentApiStatusBadge status={incident.status} />
                </td>
                <td className={`${tdClass} text-center`}>
                  <Link
                    href={detailHref(incident.incidentId)}
                    aria-label={`${formatDateTime(incident.occurredAt)} 장애 상세 보기`}
                    aria-current={isSelected ? "true" : undefined}
                    className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-primary bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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

function IncidentApiDetail({
  detail,
  referrals,
  referralStatus,
  baseQuery,
}: {
  detail: { ok: true; incident: EquipmentIncidentDetailDto } | IncidentLoadFailure;
  referrals: Awaited<ReturnType<typeof loadIncidentReferralPage>>;
  referralStatus: IncidentProcessingStatusDto | undefined;
  baseQuery: Record<string, string>;
}) {
  if (!detail.ok) return <FailureNotice failure={detail} />;
  const { incident } = detail;
  const referralQuery = referralStatus ? { ...baseQuery, [Q.referralStatus]: referralStatus } : baseQuery;

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
        <Field label="장애 ID">
          <code className="font-mono text-xs">{incident.incidentId}</code>
        </Field>
        <Field label="장비 ID">
          <code className="font-mono text-xs">{incident.equipmentId}</code>
        </Field>
        <Field label="장애 상태">
          <IncidentApiStatusBadge status={incident.status} />
        </Field>
        <Field label="장애 발생일시">{formatDateTime(incident.occurredAt)}</Field>
        <Field label="영향 구간">
          {formatDateTime(incident.startAt)} ~ {formatDateTime(incident.endAt)}
        </Field>
        <Field label="등록·수정 일시">
          {formatDateTime(incident.createdAt)} / {formatDateTime(incident.updatedAt)}
        </Field>
        <Field label="장애 사유" wide>
          {incident.reason || "-"}
        </Field>
      </dl>

      <div>
        <h3 className="mb-2 text-base font-bold text-gray-900">영향받은 의뢰 후속 처리</h3>
        <ul className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="후속 처리 건수">
          <CountChip label="전체" value={incident.totalReferrals} />
          <CountChip label={PROCESSING_LABELS.PENDING} value={incident.pendingCount} />
          <CountChip label={PROCESSING_LABELS.PROCESSING} value={incident.processingCount} />
          <CountChip label={PROCESSING_LABELS.SUCCEEDED} value={incident.completedCount} />
          <CountChip label={PROCESSING_LABELS.FAILED} value={incident.failedCount} />
        </ul>

        <nav aria-label="후속 처리 상태 필터" className="mb-3 flex flex-wrap gap-1.5">
          {[undefined, ...INCIDENT_PROCESSING_STATUSES].map((status) => {
            const active = status === referralStatus;
            return (
              <Link
                key={status ?? "ALL"}
                href={`${toHref(status ? { ...baseQuery, [Q.referralStatus]: status } : baseQuery)}#incident-detail`}
                aria-current={active ? "true" : undefined}
                className={`inline-flex h-9 items-center whitespace-nowrap rounded-lg border px-3.5 text-sm font-semibold transition-colors ${
                  active ? "border-primary bg-primary text-white" : "border-line bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {status ? PROCESSING_LABELS[status] : "전체"}
              </Link>
            );
          })}
        </nav>

        {!referrals.ok ? (
          <FailureNotice failure={referrals} />
        ) : referrals.items.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-[15px] text-gray-500">
            {referralStatus ? "이 상태의 영향 의뢰가 없습니다." : "영향받은 의뢰가 없습니다."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
              <table className="w-full min-w-[1000px] border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className={thClass}>의뢰 ID</th>
                    <th scope="col" className={thClass}>예약 ID</th>
                    <th scope="col" className={thClass}>처리 상태</th>
                    <th scope="col" className={thClass}>결과 코드</th>
                    <th scope="col" className={`${thClass} text-center!`}>재시도</th>
                    <th scope="col" className={thClass}>다음 재시도</th>
                    <th scope="col" className={thClass}>처리 완료</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.items.map((item: IncidentReferralDto) => (
                    <tr key={item.id} className="border-t border-line">
                      <td className={tdClass}>
                        <code className="font-mono text-xs">{item.referralId}</code>
                      </td>
                      <td className={tdClass}>
                        <code className="font-mono text-xs">{item.reservationId}</code>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>{PROCESSING_LABELS[item.processingStatus]}</td>
                      <td className={tdClass}>
                        {item.resultCode ? <code className="font-mono text-xs">{item.resultCode}</code> : <Dash />}
                      </td>
                      <td className={`${tdClass} text-center tabular-nums`}>{item.retryCount}</td>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                        {item.nextRetryAt ? formatDateTime(item.nextRetryAt) : <Dash />}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                        {item.processedAt ? formatDateTime(item.processedAt) : <Dash />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <NotificationPagination
              page={referrals.page}
              totalPages={referrals.totalPages}
              query={referralQuery}
              pageParam={Q.referralPage}
              label="영향 의뢰 목록 페이지"
            />
          </>
        )}
      </div>
    </div>
  );
}

/** 장애 상태 배지. OCCURRED 외 값(백엔드 미확정)은 받은 값 그대로 보여 준다 */
function IncidentApiStatusBadge({ status }: { status: string }) {
  const isOccurred = status === "OCCURRED";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ring-1 ring-inset ring-black/5 ${
        isOccurred ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-700"
      }`}
    >
      <span className={`size-1.5 rounded-full ${isOccurred ? "bg-red-500" : "bg-gray-400"}`} aria-hidden="true" />
      {isOccurred ? "장애 발생" : status}
    </span>
  );
}

const FAILURE_TITLES: Record<IncidentLoadFailure["reason"], string> = {
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: "장비 장애를 조회할 권한이 없습니다.",
  NOT_FOUND: "장애 정보를 표시할 수 없습니다.",
  NETWORK: "장비 장애 정보를 불러오지 못했습니다.",
  ERROR: "장비 장애 정보를 불러오지 못했습니다.",
};

/** 조회 실패 안내. 401은 토큰을 지워야 다시 로그인할 수 있으므로 로그아웃(폼 POST) 후 로그인 화면으로 보낸다 */
function FailureNotice({ failure }: { failure: IncidentLoadFailure }) {
  const isError = failure.reason !== "SIGNED_OUT";
  const message =
    failure.reason === "SIGNED_OUT"
      ? "장비 장애는 검사기관 계정으로 로그인한 뒤 확인할 수 있습니다."
      : failure.reason === "UNAUTHORIZED"
        ? "다시 로그인해 주세요."
        : failure.message;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center ${
        isError ? "border-red-200 bg-red-50 text-red-700" : "border-dashed border-line bg-white text-gray-600"
      }`}
    >
      <p className="text-[15px] font-semibold">{FAILURE_TITLES[failure.reason]}</p>
      <p className="text-sm">
        {message}
        {failure.reason === "FORBIDDEN" && failure.code === "ACCESS_DENIED" && (
          <span className="mt-1 block">
            Gateway 권한 정책에 장비 장애 조회 규칙이 아직 반영되지 않았을 수 있습니다.
          </span>
        )}
      </p>
      {failure.reason === "SIGNED_OUT" && (
        <Link href={ROUTES.login} className={actionClass}>
          로그인
        </Link>
      )}
      {failure.reason === "UNAUTHORIZED" && (
        <form action="/auth/logout" method="post">
          <button type="submit" className={actionClass}>
            다시 로그인
          </button>
        </form>
      )}
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {children}
    </p>
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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 쿼리로 화면 주소를 만든다 (빈 값은 뺀다) */
function toHref(query: Record<string, string>): string {
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== "")).toString();
  return search ? `${ROUTES.examining.incidents}?${search}` : ROUTES.examining.incidents;
}

const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";
const smallLinkClass =
  "inline-flex h-8 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50";
const actionClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50";
