import Link from "next/link";

import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { FAILURE_REASON_LABELS, RESERVATION_STATUS_LABELS } from "@/features/referrals/labels";
import {
  FAILURE_REASONS,
  REFERRAL_PAGE_SIZES,
  RESERVATION_SORTS,
  RESERVATION_STATUSES,
  type FailureReasonDto,
  type ReservationListParams,
  type ReservationSortDto,
  type ReservationStatusDto,
} from "@/features/referrals/remote";
import { formatDateTime } from "@/lib/format/date";

import { loadAdminReservation, loadAdminReservationPage } from "../operations";
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

const PATH = ROUTES.admin.reservations;
const SORT_LABELS: Record<ReservationSortDto, string> = {
  "createdAt,desc": "등록일 최신순",
  "createdAt,asc": "등록일 오래된순",
  "examDate,desc": "검사일 늦은순",
  "examDate,asc": "검사일 빠른순",
  "updatedAt,desc": "수정일 최신순",
  "updatedAt,asc": "수정일 오래된순",
  "attemptNo,desc": "시도 횟수 많은순",
  "attemptNo,asc": "시도 횟수 적은순",
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Query {
  list: ReservationListParams & { page: number; size: 10 | 30 | 50; sort: ReservationSortDto };
  /** 화면 입력값 (YYYY-MM-DD). 요청에는 시각을 붙여 보낸다 */
  dateFrom?: string;
  dateTo?: string;
  reservationId?: string;
}

/**
 * 예약 관리 (관리자, API 모드). 전체 검사기관의 예약 처리 상태와 실패 원인을 조회만 한다 (취소·삭제·강제 변경 없음).
 * - 목록 조건: referralId·examInstitutionId(검사기관 선택)·equipmentId·status·failureReason·검사일 기간·size·sort·page
 * - 상세 `?reservationId=`: 예약 단건 1회. 의뢰 ID → 관리자 의뢰 상세, 슬롯 ID → 슬롯 상태 이력으로 이동
 * - 검사기관명은 관리자 기관 목록 1회로 찾는다. 장비 이름은 ADMIN이 조회할 수 있는 장비 API가 없어 ID로 보인다
 */
export default async function AdminReservationsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = parseQuery(await searchParams);
  if (!query) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "검색 조건 값이 올바르지 않습니다. ID는 전체 UUID로 입력하고, 검사 시작일이 종료일보다 늦지 않게 선택해 주세요.", code: null }} />;
  }
  const [institutions, list] = await Promise.all([loadInstitutions(), loadAdminReservationPage(query.list)]);
  if (!list.ok) return <AdminFailureNotice failure={list} />;
  const nameById = new Map((institutions.ok ? institutions.institutions : []).map((item) => [item.id.toLowerCase(), item.name]));
  const institutionName = (id: string | null) => (id ? nameById.get(id.toLowerCase()) : undefined);

  const { referralId, examInstitutionId, equipmentId, status, failureReason, size, sort } = query.list;
  const listQuery: Record<string, string> = Object.fromEntries(
    Object.entries({
      referralId,
      examInstitutionId,
      equipmentId,
      status,
      failureReason,
      examDateFrom: query.dateFrom,
      examDateTo: query.dateTo,
      size: size === 10 ? undefined : String(size),
      sort: sort === "createdAt,desc" ? undefined : sort,
    }).filter((entry): entry is [string, string] => !!entry[1]),
  );
  const pageQuery = { ...listQuery, ...(list.page > 0 ? { page: String(list.page + 1) } : {}) };
  const filtered = Object.keys(listQuery).some((key) => key !== "size" && key !== "sort");

  return (
    <div className="flex flex-col gap-5">
      <ReservationFilter query={query} institutions={institutions.ok ? institutions.institutions.filter((item) => item.type === "EXAM") : []} institutionsFailed={!institutions.ok} />
      <TotalCount total={list.totalElements} page={list.page} totalPages={list.totalPages} unit="예약" />
      {list.items.length === 0 ? (
        <EmptyRows>{list.page > 0 ? "이 페이지에 예약이 없습니다." : filtered ? "검색 조건에 맞는 예약이 없습니다." : "등록된 예약이 없습니다."}</EmptyRows>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[1120px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>예약 ID</th>
                <th scope="col" className={thClass}>연결된 의뢰 ID</th>
                <th scope="col" className={thClass}>검사기관</th>
                <th scope="col" className={thClass}>검사 일시</th>
                <th scope="col" className={`${thClass} text-center`}>예약 상태</th>
                <th scope="col" className={`${thClass} text-center`}>시도 횟수</th>
                <th scope="col" className={thClass}>실패 사유</th>
                <th scope="col" className={`${thClass} text-center`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => {
                const selected = item.id.toLowerCase() === query.reservationId?.toLowerCase();
                return (
                  <tr key={item.id} className={`border-t border-line transition-colors first:border-t-0 ${selected ? "bg-primary-soft/60" : "hover:bg-gray-50/70"}`}>
                    <td className={tdClass}><IdText id={item.id} /></td>
                    <td className={tdClass}><IdText id={item.referralId} href={toHref(ROUTES.admin.referrals, { referralId: item.referralId })} /></td>
                    <td className={tdClass}>{institutionName(item.examInstitutionId) ?? <IdText id={item.examInstitutionId} label="정보 없음" />}</td>
                    <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{item.startTime ? formatDateTime(item.startTime) : <None label="정보 없음" />}</td>
                    <td className={`${tdClass} text-center`}><ReservationStatusBadge status={item.reservationStatus} /></td>
                    <td className={`${tdClass} text-center tabular-nums`}>{item.attemptNo}</td>
                    <td className={`${tdClass} text-sm`}>{item.failureReason ? <span className="text-red-700">{FAILURE_REASON_LABELS[item.failureReason]}</span> : <None />}</td>
                    <td className={`${tdClass} text-center`}>
                      <Link href={toHref(PATH, { ...pageQuery, reservationId: item.id })} aria-current={selected ? "true" : undefined} aria-label={`예약 ${item.id.slice(0, 8)} 상세 보기`} className={detailLinkClass}>
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
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="예약 목록 페이지" />
      {query.reservationId && <ReservationDetailPanel reservationId={query.reservationId} closeHref={toHref(PATH, pageQuery)} institutionName={institutionName} />}
    </div>
  );
}

async function ReservationDetailPanel({ reservationId, closeHref, institutionName }: { reservationId: string; closeHref: string; institutionName: (id: string | null) => string | undefined }) {
  const result = await loadAdminReservation(reservationId);
  return (
    <section aria-labelledby="admin-reservation-detail-title" className="flex flex-col gap-5 rounded-xl border border-line bg-white px-5 py-6 shadow-card sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-reservation-detail-title" className="text-lg font-semibold text-gray-900">예약 상세</h2>
        <Link href={closeHref} className={smallLinkClass}>닫기</Link>
      </div>
      {!result.ok ? (
        <AdminFailureNotice failure={result} />
      ) : (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-[15px] sm:grid-cols-2">
          <Field label="예약 ID"><IdText id={result.reservation.id} full /></Field>
          <Field label="의뢰 ID"><IdText id={result.reservation.referralId} href={toHref(ROUTES.admin.referrals, { referralId: result.reservation.referralId })} full /></Field>
          <Field label="슬롯 ID">
            <IdText id={result.reservation.slotId} href={result.reservation.slotId ? toHref(ROUTES.admin.slots, { slotId: result.reservation.slotId }) : undefined} full label="없음 (슬롯 미배정)" />
          </Field>
          <Field label="검사기관">
            {institutionName(result.reservation.examInstitutionId) && <span className="mr-2">{institutionName(result.reservation.examInstitutionId)}</span>}
            <IdText id={result.reservation.examInstitutionId} full label="없음" />
          </Field>
          <Field label="장비 ID">
            <IdText id={result.reservation.equipmentId} full label="없음" />
            {result.reservation.equipmentId && <span className="block text-sm text-gray-500">장비 이름은 관리자 권한으로 조회할 수 없어 ID로 표시합니다.</span>}
          </Field>
          <Field label="검사 일시">
            {result.reservation.startTime ? `${formatDateTime(result.reservation.startTime)}${result.reservation.endTime ? ` ~ ${formatDateTime(result.reservation.endTime)}` : ""}` : <None label="정보 없음" />}
          </Field>
          <Field label="예약 상태"><ReservationStatusBadge status={result.reservation.reservationStatus} /></Field>
          <Field label="예약 시도 번호">{result.reservation.attemptNo}번째 시도</Field>
          <Field label="실패 사유" wide>
            {result.reservation.failureReason ? (
              <span className="font-medium text-red-700">{FAILURE_REASON_LABELS[result.reservation.failureReason]} <span className="font-mono text-xs text-gray-500">({result.reservation.failureReason})</span></span>
            ) : (
              <None />
            )}
          </Field>
          <Field label="예약 확정 시각">{result.reservation.confirmedAt ? formatDateTime(result.reservation.confirmedAt) : <None label="없음 (확정 전)" />}</Field>
          <Field label="예약 종료 시각">{result.reservation.endedAt ? formatDateTime(result.reservation.endedAt) : <None label="없음 (종료 전)" />}</Field>
        </dl>
      )}
    </section>
  );
}

function ReservationFilter({ query, institutions, institutionsFailed }: { query: Query; institutions: InstitutionDto[]; institutionsFailed: boolean }) {
  const { list } = query;
  return (
    <form role="search" aria-label="예약 검색 조건" action={PATH} method="get" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <input name="referralId" defaultValue={list.referralId ?? ""} placeholder="의뢰 ID (UUID)" aria-label="의뢰 ID (전체 UUID)" autoComplete="off" className={`${controlClass} min-w-[240px] flex-[2_1_260px] font-mono`} />
        <select name="examInstitutionId" aria-label="검사기관" defaultValue={list.examInstitutionId ?? ""} disabled={institutionsFailed} className={`${controlClass} min-w-[180px] flex-[1_1_180px] disabled:bg-gray-50 disabled:text-gray-400`}>
          <option value="">전체 검사기관</option>
          {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input name="equipmentId" defaultValue={list.equipmentId ?? ""} placeholder="장비 ID (UUID)" aria-label="장비 ID (전체 UUID)" autoComplete="off" className={`${controlClass} min-w-[240px] flex-[2_1_260px] font-mono`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select name="status" aria-label="예약 상태" defaultValue={list.status ?? ""} className={`${controlClass} w-auto`}>
          <option value="">전체 상태</option>
          {RESERVATION_STATUSES.map((value) => <option key={value} value={value}>{RESERVATION_STATUS_LABELS[value]}</option>)}
        </select>
        <select name="failureReason" aria-label="실패 사유" defaultValue={list.failureReason ?? ""} className={`${controlClass} w-auto`}>
          <option value="">전체 실패 사유</option>
          {FAILURE_REASONS.map((value) => <option key={value} value={value}>{FAILURE_REASON_LABELS[value]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          검사 시작일
          <input type="date" name="examDateFrom" defaultValue={query.dateFrom ?? ""} className={`${controlClass} w-auto`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          검사 종료일
          <input type="date" name="examDateTo" defaultValue={query.dateTo ?? ""} className={`${controlClass} w-auto`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select name="sort" aria-label="정렬" defaultValue={list.sort} className={`${controlClass} w-auto`}>
          {RESERVATION_SORTS.map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
        </select>
        <select name="size" aria-label="페이지당 건수" defaultValue={String(list.size)} className={`${controlClass} w-auto`}>
          {REFERRAL_PAGE_SIZES.map((value) => <option key={value} value={value}>{value}개씩</option>)}
        </select>
        <button type="submit" className={submitClass}>검색</button>
        <Link href={PATH} className={resetClass}>초기화</Link>
      </div>
      {institutionsFailed && <p role="status" className="text-sm text-amber-700">기관 목록을 불러오지 못해 검사기관 조건을 쓸 수 없고, 기관은 ID로 표시합니다.</p>}
    </form>
  );
}

/** 주소 조건 → 조회 조건. 올바르지 않은 값은 다른 값으로 바꾸지 않고 null (요청하지 않는다) */
function parseQuery(params: SearchParams): Query | null {
  const get = (key: string) => readParam(params, key);
  const page = parsePage(get("page"));
  if (page === null) return null;
  const query: Query = { list: { page, size: 10, sort: "createdAt,desc" } };
  for (const key of ["referralId", "examInstitutionId", "equipmentId"] as const) {
    const value = get(key);
    if (value === null || (value && !isUuidText(value))) return null;
    if (value) query.list[key] = value;
  }
  const status = get("status");
  if (status === null || (status && !(RESERVATION_STATUSES as readonly string[]).includes(status))) return null;
  if (status) query.list.status = status as ReservationStatusDto;
  const failureReason = get("failureReason");
  if (failureReason === null || (failureReason && !(FAILURE_REASONS as readonly string[]).includes(failureReason))) return null;
  if (failureReason) query.list.failureReason = failureReason as FailureReasonDto;
  const dateFrom = get("examDateFrom");
  const dateTo = get("examDateTo");
  if (dateFrom === null || dateTo === null) return null;
  if ((dateFrom && !isDate(dateFrom)) || (dateTo && !isDate(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) return null;
  if (dateFrom) {
    query.dateFrom = dateFrom;
    query.list.examDateFrom = `${dateFrom}T00:00:00`;
  }
  if (dateTo) {
    query.dateTo = dateTo;
    query.list.examDateTo = `${dateTo}T23:59:59`;
  }
  const size = get("size");
  if (size === null || (size && !["10", "30", "50"].includes(size))) return null;
  if (size) query.list.size = Number(size) as 10 | 30 | 50;
  const sort = get("sort");
  if (sort === null || (sort && !(RESERVATION_SORTS as readonly string[]).includes(sort))) return null;
  if (sort) query.list.sort = sort as ReservationSortDto;
  const reservationId = get("reservationId");
  if (reservationId === null || (reservationId && !isUuidText(reservationId))) return null;
  if (reservationId) query.reservationId = reservationId;
  return query;
}

/** 달력에 있는 날짜인지 (2026-02-30 등은 거부) */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
