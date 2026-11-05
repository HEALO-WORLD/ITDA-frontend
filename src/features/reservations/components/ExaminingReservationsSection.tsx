import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";

import FormDateRange from "@/components/ui/FormDateRange";
import { SelectInput, TextInput } from "@/components/ui/FormControls";
import { searchCardClass, searchGridClass } from "@/components/ui/styles";
import { ROUTES } from "@/constants/navigation";
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
  TotalCount,
  type SearchParams,
} from "@/features/admin/components/AdminDataParts";
import { AdminFailureNotice } from "@/features/admin/components/AdminNotices";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import { FAILURE_REASON_LABELS, RESERVATION_STATUS_LABELS } from "@/features/referrals/labels";
import {
  FAILURE_REASONS,
  REFERRAL_PAGE_SIZES,
  RESERVATION_SORTS,
  RESERVATION_STATUSES,
  type FailureReasonDto,
  type ReservationSortDto,
  type ReservationStatusDto,
} from "@/features/referrals/remote";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { loadExaminingEquipments, loadExaminingReservationPage, type ExaminingReservationQuery } from "../server";

import ExaminingReservationDetailModal, { ExaminingReservationDetailButton } from "./ExaminingReservationDetailModal";

const PATH = ROUTES.examining.reservations;
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
  list: ExaminingReservationQuery & { page: number; size: 10 | 30 | 50; sort: ReservationSortDto };
  /** 화면 입력값 (YYYY-MM-DD). 요청에는 시각을 붙여 보낸다 */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 확정 예약 관리 (검사기관, API 모드). 우리 기관이 검사하는 예약을 조회만 한다 (취소·삭제·상태 변경 없음).
 * - 목록: GET /api/v1/referrals/reservations. 범위는 백엔드가 로그인 기관으로 정한다 (검사기관·의뢰·작성자 ID 조건은 보내지 않는다)
 * - 조건: equipmentId(우리 기관 장비 선택)·status·failureReason·검사일 기간·sort·size·page — 모두 서버 검색이다 (화면에서 거르지 않는다)
 * - 상세: '상세' 버튼 → 대화상자(?reservationId=). 열 때만 예약 단건을 조회한다
 * - 장비 이름: 우리 기관 장비 목록 1회 (실패하면 ID로 표시하고 장비 조건은 ID 입력으로 받는다)
 * - 예약 응답에 없는 환자명·의뢰기관·검사 유형은 보이지 않는다 (검사기관은 의뢰 단건 API 권한이 없다)
 */
export default async function ExaminingReservationsSection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = parseQuery(await searchParams);
  if (!query) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "검색 조건 값이 올바르지 않습니다. 장비·상태를 다시 선택하고, 검사 시작일이 종료일보다 늦지 않게 선택해 주세요.", code: null }} />;
  }
  const [equipments, list] = await Promise.all([loadExaminingEquipments(), loadExaminingReservationPage(query.list)]);
  if (!list.ok) return <AdminFailureNotice failure={list} />;
  const equipmentNames: Record<string, string> = Object.fromEntries((equipments.ok ? equipments.equipments : []).map((item) => [item.id.toLowerCase(), item.name]));

  const { equipmentId, status, failureReason, size, sort } = query.list;
  // 페이지 이동에서 유지할 조건 (기본값은 주소에 넣지 않는다)
  const listQuery: Record<string, string> = Object.fromEntries(
    Object.entries({
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
      <ReservationApiFilter query={query} equipments={equipments.ok ? equipments.equipments : null} />
      <TotalCount total={list.totalElements} page={list.page} totalPages={list.totalPages} unit="예약" />
      {list.items.length === 0 ? (
        <EmptyRows>{list.page > 0 ? "이 페이지에 예약이 없습니다." : filtered ? "검색 조건에 맞는 예약이 없습니다." : "접수된 예약이 없습니다."}</EmptyRows>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>예약번호</th>
                <th scope="col" className={thClass}>의뢰 번호</th>
                <th scope="col" className={thClass}>검사 장비</th>
                <th scope="col" className={thClass}>검사 일시</th>
                <th scope="col" className={`${thClass} text-center!`}>예약 상태</th>
                <th scope="col" className={`${thClass} text-center!`}>시도</th>
                <th scope="col" className={thClass}>실패 사유</th>
                <th scope="col" className={`${thClass} text-center!`}>상세</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
                  <td className={`${tdClass} whitespace-nowrap`}><ReferralIdCopyButton referralId={item.id} label="예약 ID" /></td>
                  <td className={tdClass}><IdText id={item.referralId} /></td>
                  <td className={`${tdClass} font-medium text-gray-900`}>
                    {item.equipmentId ? equipmentNames[item.equipmentId.toLowerCase()] ?? <IdText id={item.equipmentId} /> : <None label="정보 없음" />}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{item.startTime ? formatDateTimeWithWeekday(item.startTime) : <None label="정보 없음" />}</td>
                  <td className={`${tdClass} text-center`}><ReservationStatusBadge status={item.reservationStatus} /></td>
                  <td className={`${tdClass} text-center tabular-nums`}>{item.attemptNo}</td>
                  <td className={`${tdClass} text-sm`}>{item.failureReason ? <span className="font-medium text-orange-700">{FAILURE_REASON_LABELS[item.failureReason]}</span> : <None />}</td>
                  <td className={`${tdClass} text-center`}><ExaminingReservationDetailButton reservationId={item.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="예약 목록 페이지" />
      {/* 상세 대화상자 (?reservationId=): 장비 이름은 이미 받은 장비 목록으로 찾는다 (추가 요청 없음) */}
      <ExaminingReservationDetailModal equipmentNames={equipmentNames} />
    </div>
  );
}

function ReservationApiFilter({ query, equipments }: { query: Query; equipments: { id: string; name: string; modality: string }[] | null }) {
  const { list } = query;
  return (
    <form role="search" aria-label="예약 검색 조건" action={PATH} method="get" className={searchCardClass}>
      <div className={searchGridClass}>
        {equipments ? (
          <SelectInput
            id="exam-resv-equipment"
            name="equipmentId"
            label="검사 장비"
            defaultValue={list.equipmentId ?? ""}
            options={[{ value: "", label: "전체 장비" }, ...equipments.map((item) => ({ value: item.id, label: `${item.modality} · ${item.name}` }))]}
          />
        ) : (
          <TextInput id="exam-resv-equipment" name="equipmentId" label="검사 장비 ID" defaultValue={list.equipmentId ?? ""} placeholder="전체 UUID 입력" autoComplete="off" />
        )}
        <SelectInput
          id="exam-resv-status"
          name="status"
          label="예약 상태"
          defaultValue={list.status ?? ""}
          options={[{ value: "", label: "전체 상태" }, ...RESERVATION_STATUSES.map((value) => ({ value, label: RESERVATION_STATUS_LABELS[value] }))]}
        />
        <FormDateRange
          from={{ id: "exam-resv-date-from", label: "검사 시작일", name: "examDateFrom", defaultValue: query.dateFrom ?? "" }}
          to={{ id: "exam-resv-date-to", label: "검사 종료일", name: "examDateTo", defaultValue: query.dateTo ?? "" }}
        />
        <SelectInput
          id="exam-resv-failure"
          name="failureReason"
          label="실패 사유"
          defaultValue={list.failureReason ?? ""}
          options={[{ value: "", label: "전체 실패 사유" }, ...FAILURE_REASONS.map((value) => ({ value, label: FAILURE_REASON_LABELS[value] }))]}
        />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-5">
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-[180px_140px]">
          <SelectInput id="exam-resv-sort" name="sort" label="정렬" defaultValue={list.sort} options={RESERVATION_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }))} />
          <SelectInput
            id="exam-resv-size"
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
      {!equipments && <p role="status" className="text-sm text-amber-700">장비 목록을 불러오지 못해 장비는 ID로 표시하고, 장비 조건은 ID로 입력받습니다. 예약 목록은 그대로 확인할 수 있습니다.</p>}
    </form>
  );
}

/** 주소 조건 → 조회 조건. 올바르지 않은 값은 다른 값으로 바꾸지 않고 null (요청하지 않는다) */
function parseQuery(params: SearchParams): Query | null {
  const get = (key: string) => readParam(params, key);
  const page = parsePage(get("page"));
  if (page === null) return null;
  const query: Query = { list: { page, size: 10, sort: "createdAt,desc" } };
  const equipmentId = get("equipmentId");
  if (equipmentId === null || (equipmentId && !isUuidText(equipmentId))) return null;
  if (equipmentId) query.list.equipmentId = equipmentId;
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
  return query;
}

/** 달력에 있는 날짜인지 (2026-02-30 등은 거부) */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
