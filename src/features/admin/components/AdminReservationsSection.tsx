import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";

import FormDateRange from "@/components/ui/FormDateRange";
import { SelectInput, TextInput } from "@/components/ui/FormControls";
import { searchCardClass, searchGridClass } from "@/components/ui/styles";
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

import { loadAdminReservationPage } from "../operations";
import type { InstitutionDto } from "../remote";
import { loadInstitutions } from "../server";

import AdminReservationDetailModal, { AdminReservationDetailButton } from "./AdminReservationDetailModal";
import {
  EmptyRows,
  IdText,
  isUuidText,
  None,
  parsePage,
  readParam,
  ReservationStatusBadge,
  resetClass,
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
                <th scope="col" className={`${thClass} text-center!`}>예약 상태</th>
                <th scope="col" className={`${thClass} text-center!`}>시도 횟수</th>
                <th scope="col" className={thClass}>실패 사유</th>
                <th scope="col" className={`${thClass} text-center!`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => {
                return (
                  <tr key={item.id} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
                    <td className={tdClass}><IdText id={item.id} /></td>
                    <td className={tdClass}><IdText id={item.referralId} href={toHref(ROUTES.admin.referrals, { referralId: item.referralId })} /></td>
                    <td className={tdClass}>{institutionName(item.examInstitutionId) ?? <IdText id={item.examInstitutionId} label="정보 없음" />}</td>
                    <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{item.startTime ? formatDateTime(item.startTime) : <None label="정보 없음" />}</td>
                    <td className={`${tdClass} text-center`}><ReservationStatusBadge status={item.reservationStatus} /></td>
                    <td className={`${tdClass} text-center tabular-nums`}>{item.attemptNo}</td>
                    <td className={`${tdClass} text-sm`}>{item.failureReason ? <span className="font-medium text-orange-700">{FAILURE_REASON_LABELS[item.failureReason]}</span> : <None />}</td>
                    <td className={`${tdClass} text-center`}>
                      <AdminReservationDetailButton reservationId={item.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="예약 목록 페이지" />
      {/* 상세 대화상자 (?reservationId=): 기관명은 목록을 그릴 때 받은 관리자 기관 목록으로 찾는다 (추가 요청 없음) */}
      <AdminReservationDetailModal institutionNames={Object.fromEntries(nameById)} />
    </div>
  );
}

function ReservationFilter({ query, institutions, institutionsFailed }: { query: Query; institutions: InstitutionDto[]; institutionsFailed: boolean }) {
  const { list } = query;
  return (
    <form role="search" aria-label="예약 검색 조건" action={PATH} method="get" className={searchCardClass}>
      {/* 기준: 의뢰기관 검사 슬롯 검색. 1행 기본 검색 · 2행 상세 검색(실패 사유·검사 기간) · 하단 정렬·크기·버튼 */}
      <div className={searchGridClass}>
        <TextInput id="admin-resv-referral" name="referralId" label="의뢰 ID" defaultValue={list.referralId ?? ""} placeholder="전체 UUID 입력" autoComplete="off" />
        <SelectInput
          id="admin-resv-institution"
          name="examInstitutionId"
          label="검사기관"
          defaultValue={list.examInstitutionId ?? ""}
          disabled={institutionsFailed}
          options={[{ value: "", label: "전체 검사기관" }, ...institutions.map((item) => ({ value: item.id, label: item.name }))]}
        />
        <SelectInput
          id="admin-resv-status"
          name="status"
          label="예약 상태"
          defaultValue={list.status ?? ""}
          options={[{ value: "", label: "전체 상태" }, ...RESERVATION_STATUSES.map((value) => ({ value, label: RESERVATION_STATUS_LABELS[value] }))]}
        />
        <TextInput id="admin-resv-equipment" name="equipmentId" label="장비 ID" defaultValue={list.equipmentId ?? ""} placeholder="전체 UUID 입력" autoComplete="off" />
      </div>
      <div className={searchGridClass}>
        <SelectInput
          id="admin-resv-failure"
          name="failureReason"
          label="실패 사유"
          defaultValue={list.failureReason ?? ""}
          options={[{ value: "", label: "전체 실패 사유" }, ...FAILURE_REASONS.map((value) => ({ value, label: FAILURE_REASON_LABELS[value] }))]}
        />
        {/* 공통 커스텀 달력. 조회용이라 지난 날짜도 고를 수 있고, 시작일~종료일 범위는 서버에서도 그대로 검증한다 */}
        <FormDateRange
          from={{ id: "admin-resv-date-from", label: "검사 시작일", name: "examDateFrom", defaultValue: query.dateFrom ?? "" }}
          to={{ id: "admin-resv-date-to", label: "검사 종료일", name: "examDateTo", defaultValue: query.dateTo ?? "" }}
        />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-5">
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-[180px_140px]">
          <SelectInput id="admin-resv-sort" name="sort" label="정렬" defaultValue={list.sort} options={RESERVATION_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }))} />
          <SelectInput
            id="admin-resv-size"
            name="size"
            label="페이지 크기"
            defaultValue={String(list.size)}
            options={REFERRAL_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value}개씩` }))}
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Link href={PATH} className={resetClass}>
            <RotateCcw className="size-4" aria-hidden="true" />
            초기화
          </Link>
          <button type="submit" className={submitClass}>
            <Search className="size-5" aria-hidden="true" />
            검색
          </button>
        </div>
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
