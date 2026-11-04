import Link from "next/link";

import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { toBadgeStatus } from "@/features/referrals/components/ReferralApiTable";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { FAILURE_REASON_LABELS, HISTORY_REASON_LABELS, REFERRAL_STATUS_LABELS } from "@/features/referrals/labels";
import {
  isPatientNameSearch,
  REFERRAL_PAGE_SIZES,
  REFERRAL_STATUSES,
  type ReferralListParams,
  type ReferralStatusDto,
} from "@/features/referrals/remote";
import { formatDateTime } from "@/lib/format/date";

import { loadAdminReferralDetail, loadAdminReferralPage, type AdminReferralDetail } from "../operations";
import type { InstitutionDto } from "../remote";
import { loadInstitutions } from "../server";

import {
  controlClass,
  detailLinkClass,
  EmptyRows,
  Field,
  IdText,
  isUuidText,
  None,
  parsePage,
  readParam,
  ReservationStatusBadge,
  resetClass,
  smallLinkClass,
  submitClass,
  tdClass,
  thClass,
  toHref,
  TotalCount,
  type SearchParams,
} from "./AdminDataParts";
import { AdminFailureNotice } from "./AdminNotices";

const PATH = ROUTES.admin.referrals;
const SORT_LABELS = { "createdAt,desc": "등록일 최신순", "createdAt,asc": "등록일 오래된순", "updatedAt,desc": "수정일 최신순", "updatedAt,asc": "수정일 오래된순" } as const;
type ReferralSort = keyof typeof SORT_LABELS;

interface Query {
  list: ReferralListParams & { page: number; size: 10 | 30 | 50; sort: ReferralSort };
  referralId?: string;
}

/**
 * 의뢰 관리 (관리자, API 모드). 전체 의뢰기관의 의뢰를 조회만 한다 (변경 기능 없음).
 * - 목록 조건: status·referringInstitutionId(의뢰기관 선택)·examTypeId(ID 입력: ADMIN은 검사 유형 목록 API 권한이 없다)·patientName·size·sort·page
 * - 상세 `?referralId=`: 의뢰 + 상태 변경 이력 + 현재 예약 (단건 3회). 목록에서는 단건 API를 부르지 않는다
 * - 기관명은 관리자 기관 목록 1회로 찾는다 (실패하면 ID로 표시)
 */
export default async function AdminReferralsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = parseQuery(await searchParams);
  if (!query) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "검색 조건 값이 올바르지 않습니다. ID는 전체 UUID로, 환자명은 20자 이내로 입력해 주세요.", code: null }} />;
  }
  const [institutions, list] = await Promise.all([loadInstitutions(), loadAdminReferralPage(query.list)]);
  if (!list.ok) return <AdminFailureNotice failure={list} />;
  const nameById = new Map((institutions.ok ? institutions.institutions : []).map((item) => [item.id.toLowerCase(), item.name]));
  const institutionName = (id: string) => nameById.get(id.toLowerCase());

  const { status, referringInstitutionId, examTypeId, patientName, size, sort } = query.list;
  // 페이지 이동·상세 링크에서 유지할 조건 (기본값은 주소에 넣지 않는다)
  const listQuery: Record<string, string> = Object.fromEntries(
    Object.entries({ status, referringInstitutionId, examTypeId, patientName, size: size === 10 ? undefined : String(size), sort: sort === "createdAt,desc" ? undefined : sort }).filter(
      (entry): entry is [string, string] => !!entry[1],
    ),
  );
  const pageQuery = { ...listQuery, ...(list.page > 0 ? { page: String(list.page + 1) } : {}) };
  const filtered = Object.keys(listQuery).some((key) => key !== "size" && key !== "sort");

  return (
    <div className="flex flex-col gap-5">
      <ReferralFilter query={query.list} institutions={institutions.ok ? institutions.institutions.filter((item) => item.type === "REQUESTER") : []} institutionsFailed={!institutions.ok} />
      <TotalCount total={list.totalElements} page={list.page} totalPages={list.totalPages} unit="의뢰" />
      {list.items.length === 0 ? (
        <EmptyRows>{list.page > 0 ? "이 페이지에 의뢰가 없습니다." : filtered ? "검색 조건에 맞는 의뢰가 없습니다." : "등록된 의뢰가 없습니다."}</EmptyRows>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[960px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>의뢰 번호</th>
                <th scope="col" className={thClass}>환자명</th>
                <th scope="col" className={thClass}>의뢰기관</th>
                <th scope="col" className={`${thClass} text-center`}>의뢰 상태</th>
                <th scope="col" className={thClass}>현재 예약</th>
                <th scope="col" className={`${thClass} text-center`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => {
                const selected = item.id.toLowerCase() === query.referralId?.toLowerCase();
                return (
                  <tr key={item.id} className={`border-t border-line transition-colors first:border-t-0 ${selected ? "bg-primary-soft/60" : "hover:bg-gray-50/70"}`}>
                    <td className={`${tdClass} whitespace-nowrap`}><ReferralIdCopyButton referralId={item.id} /></td>
                    <td className={`${tdClass} whitespace-nowrap`}>{item.patientName}</td>
                    <td className={tdClass}>{institutionName(item.referringInstitutionId) ?? <IdText id={item.referringInstitutionId} />}</td>
                    <td className={`${tdClass} text-center`}><ReferralStatusBadge status={toBadgeStatus(item.referralStatus)} /></td>
                    <td className={tdClass}>
                      {item.currentReservationId ? (
                        <IdText id={item.currentReservationId} href={toHref(ROUTES.admin.reservations, { reservationId: item.currentReservationId })} />
                      ) : (
                        <None label="예약 없음" />
                      )}
                    </td>
                    <td className={`${tdClass} text-center`}>
                      <Link href={toHref(PATH, { ...pageQuery, referralId: item.id })} aria-current={selected ? "true" : undefined} aria-label={`의뢰 ${item.id.slice(0, 8)} 상세 보기`} className={detailLinkClass}>
                        상세
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="의뢰 목록 페이지" />
      {query.referralId && <ReferralDetailPanel referralId={query.referralId} closeHref={toHref(PATH, pageQuery)} institutionName={institutionName} />}
    </div>
  );
}

async function ReferralDetailPanel({ referralId, closeHref, institutionName }: { referralId: string; closeHref: string; institutionName: (id: string) => string | undefined }) {
  const result = await loadAdminReferralDetail(referralId);
  return (
    <section aria-labelledby="admin-referral-detail-title" className="flex flex-col gap-5 rounded-xl border border-line bg-white px-5 py-6 shadow-card sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-referral-detail-title" className="text-lg font-semibold text-gray-900">의뢰 상세</h2>
        <Link href={closeHref} className={smallLinkClass}>닫기</Link>
      </div>
      {!result.ok ? (
        <AdminFailureNotice failure={result} />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-[15px] sm:grid-cols-2">
            <Field label="의뢰 번호"><IdText id={result.detail.referral.id} full /></Field>
            <Field label="의뢰 상태"><ReferralStatusBadge status={toBadgeStatus(result.detail.referral.referralStatus)} /></Field>
            <Field label="환자명">{result.detail.referral.patientName}</Field>
            <Field label="의뢰기관">{institutionName(result.detail.referral.referringInstitutionId) ?? <IdText id={result.detail.referral.referringInstitutionId} full />}</Field>
            <Field label="검사 유형 ID" wide>
              <IdText id={result.detail.referral.examTypeId} full /> <span className="text-sm text-gray-500">(검사 유형 이름은 관리자 권한으로 조회할 수 없어 ID로 표시)</span>
            </Field>
          </dl>

          <div className="rounded-lg bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-gray-800">연결된 현재 예약</h3>
              <Link href={toHref(ROUTES.admin.reservations, { referralId: result.detail.referral.id })} className={smallLinkClass}>이 의뢰의 예약 이력 전체</Link>
            </div>
            <CurrentReservation reservation={result.detail.reservation} />
          </div>

          <div>
            <h3 className="mb-3 text-[15px] font-semibold text-gray-800">의뢰 상태 변경 이력</h3>
            {"ok" in result.detail.histories ? (
              <AdminFailureNotice failure={result.detail.histories} />
            ) : result.detail.histories.length === 0 ? (
              <p role="status" className="text-sm text-gray-600">변경 이력이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className={thClass}>발생 일시</th>
                      <th scope="col" className={thClass}>사유</th>
                      <th scope="col" className={thClass}>이전 상태</th>
                      <th scope="col" className={thClass}>변경 후 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.detail.histories.map((history) => (
                      <tr key={history.id} className="border-t border-line">
                        <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(history.occurredAt)}</td>
                        <td className={tdClass}>{HISTORY_REASON_LABELS[history.reason]}</td>
                        <td className={tdClass}>{history.fromStatus ? REFERRAL_STATUS_LABELS[history.fromStatus] : <None label="없음 (최초 접수)" />}</td>
                        <td className={tdClass}>{REFERRAL_STATUS_LABELS[history.toStatus]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function CurrentReservation({ reservation }: { reservation: AdminReferralDetail["reservation"] }) {
  if (reservation === null) return <p className="text-sm text-gray-600">연결된 예약이 없습니다.</p>;
  if ("ok" in reservation) return <AdminFailureNotice failure={reservation} />;
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-[15px] sm:grid-cols-2">
      <Field label="예약 ID"><IdText id={reservation.id} href={toHref(ROUTES.admin.reservations, { reservationId: reservation.id })} full /></Field>
      <Field label="예약 상태"><ReservationStatusBadge status={reservation.reservationStatus} /> <span className="text-sm text-gray-500">({reservation.attemptNo}번째 시도)</span></Field>
      <Field label="검사 일시">{reservation.startTime ? formatDateTime(reservation.startTime) : <None label="정보 없음" />}</Field>
      <Field label="실패 사유">{reservation.failureReason ? <span className="font-medium text-red-700">{FAILURE_REASON_LABELS[reservation.failureReason]}</span> : <None />}</Field>
    </dl>
  );
}

function ReferralFilter({ query, institutions, institutionsFailed }: { query: Query["list"]; institutions: InstitutionDto[]; institutionsFailed: boolean }) {
  return (
    <form role="search" aria-label="의뢰 검색 조건" action={PATH} method="get" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <select name="status" aria-label="의뢰 상태" defaultValue={query.status ?? ""} className={`${controlClass} min-w-[130px] flex-[1_1_130px]`}>
          <option value="">전체 상태</option>
          {REFERRAL_STATUSES.map((value) => <option key={value} value={value}>{REFERRAL_STATUS_LABELS[value]}</option>)}
        </select>
        <select name="referringInstitutionId" aria-label="의뢰기관" defaultValue={query.referringInstitutionId ?? ""} disabled={institutionsFailed} className={`${controlClass} min-w-[180px] flex-[1_1_180px] disabled:bg-gray-50 disabled:text-gray-400`}>
          <option value="">전체 의뢰기관</option>
          {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input name="patientName" defaultValue={query.patientName ?? ""} maxLength={20} placeholder="환자명" aria-label="환자명 검색 (20자 이내)" autoComplete="off" className={`${controlClass} min-w-[140px] flex-[1_1_140px]`} />
        <input name="examTypeId" defaultValue={query.examTypeId ?? ""} placeholder="검사 유형 ID (UUID)" aria-label="검사 유형 ID (전체 UUID)" autoComplete="off" className={`${controlClass} min-w-[240px] flex-[2_1_260px] font-mono`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select name="sort" aria-label="정렬" defaultValue={query.sort} className={`${controlClass} w-auto`}>
          {(Object.keys(SORT_LABELS) as ReferralSort[]).map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
        </select>
        <select name="size" aria-label="페이지당 건수" defaultValue={String(query.size)} className={`${controlClass} w-auto`}>
          {REFERRAL_PAGE_SIZES.map((value) => <option key={value} value={value}>{value}개씩</option>)}
        </select>
        <button type="submit" className={submitClass}>검색</button>
        <Link href={PATH} className={resetClass}>초기화</Link>
      </div>
      {institutionsFailed && <p role="status" className="text-sm text-amber-700">기관 목록을 불러오지 못해 의뢰기관 조건을 쓸 수 없고, 기관은 ID로 표시합니다.</p>}
    </form>
  );
}

/** 주소 조건 → 조회 조건. 올바르지 않은 값은 다른 값으로 바꾸지 않고 null (요청하지 않는다) */
function parseQuery(params: SearchParams): Query | null {
  const get = (key: string) => readParam(params, key);
  const page = parsePage(get("page"));
  if (page === null) return null;
  const list: Query["list"] = { page, size: 10, sort: "createdAt,desc" };
  const status = get("status");
  if (status === null) return null;
  if (status) {
    if (!(REFERRAL_STATUSES as readonly string[]).includes(status)) return null;
    list.status = status as ReferralStatusDto;
  }
  for (const key of ["referringInstitutionId", "examTypeId"] as const) {
    const value = get(key);
    if (value === null || (value && !isUuidText(value))) return null;
    if (value) list[key] = value;
  }
  const patientName = get("patientName");
  if (patientName === null || (patientName && !isPatientNameSearch(patientName))) return null;
  if (patientName) list.patientName = patientName;
  const size = get("size");
  if (size === null || (size && !["10", "30", "50"].includes(size))) return null;
  if (size) list.size = Number(size) as 10 | 30 | 50;
  const sort = get("sort");
  if (sort === null || (sort && !(sort in SORT_LABELS))) return null;
  if (sort) list.sort = sort as ReferralSort;
  const referralId = get("referralId");
  if (referralId === null || (referralId && !isUuidText(referralId))) return null;
  return { list, referralId: referralId || undefined };
}
