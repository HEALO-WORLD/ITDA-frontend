import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";

import { SelectInput, TextInput } from "@/components/ui/FormControls";
import { searchCardClass, searchGridClass } from "@/components/ui/styles";
import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { toBadgeStatus } from "@/features/referrals/components/ReferralApiTable";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { REFERRAL_STATUS_LABELS } from "@/features/referrals/labels";
import {
  isPatientNameSearch,
  REFERRAL_PAGE_SIZES,
  REFERRAL_STATUSES,
  type ReferralListParams,
  type ReferralStatusDto,
} from "@/features/referrals/remote";

import { loadAdminReferralPage } from "../operations";
import type { InstitutionDto } from "../remote";
import { loadInstitutions } from "../server";

import AdminReferralDetailModal, { AdminReferralDetailButton } from "./AdminReferralDetailModal";
import {
  EmptyRows,
  IdText,
  isUuidText,
  None,
  parsePage,
  readParam,
  resetClass,
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
 * - 상세: '상세' 버튼 → 대화상자(AdminReferralDetailModal). 주소 `?referralId=`로 열린 상태를 나타내고(직접 접근·뒤로 가기),
 *   열 때만 의뢰 + 상태 변경 이력 + 현재 예약을 조회한다 (단건 3회). 목록을 그릴 때는 단건 API를 부르지 않는다
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
                <th scope="col" className={`${thClass} text-center!`}>의뢰 상태</th>
                <th scope="col" className={thClass}>현재 예약</th>
                <th scope="col" className={`${thClass} text-center!`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => {
                return (
                  <tr key={item.id} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
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
                      <AdminReferralDetailButton referralId={item.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="의뢰 목록 페이지" />
      {/* 상세 대화상자: 기관명은 목록을 그릴 때 받은 관리자 기관 목록으로 찾는다 (추가 요청 없음) */}
      <AdminReferralDetailModal institutionNames={Object.fromEntries(nameById)} />
    </div>
  );
}

function ReferralFilter({ query, institutions, institutionsFailed }: { query: Query["list"]; institutions: InstitutionDto[]; institutionsFailed: boolean }) {
  return (
    <form role="search" aria-label="의뢰 검색 조건" action={PATH} method="get" className={searchCardClass}>
      {/* 기준: 의뢰기관 검사 슬롯 검색 (라벨 붙은 공통 입력, 데스크톱 4열 · 태블릿 2열 · 모바일 1열) */}
      <div className={searchGridClass}>
        <SelectInput
          id="admin-referral-status"
          name="status"
          label="의뢰 상태"
          defaultValue={query.status ?? ""}
          options={[{ value: "", label: "전체 상태" }, ...REFERRAL_STATUSES.map((value) => ({ value, label: REFERRAL_STATUS_LABELS[value] }))]}
        />
        <SelectInput
          id="admin-referral-institution"
          name="referringInstitutionId"
          label="의뢰기관"
          defaultValue={query.referringInstitutionId ?? ""}
          disabled={institutionsFailed}
          options={[{ value: "", label: "전체 의뢰기관" }, ...institutions.map((item) => ({ value: item.id, label: item.name }))]}
        />
        <TextInput id="admin-referral-patient" name="patientName" label="환자명" defaultValue={query.patientName ?? ""} maxLength={20} placeholder="환자명 (20자 이내)" autoComplete="off" />
        <TextInput id="admin-referral-exam-type" name="examTypeId" label="검사 유형 ID" defaultValue={query.examTypeId ?? ""} placeholder="전체 UUID 입력" autoComplete="off" />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-5">
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-[180px_140px]">
          <SelectInput
            id="admin-referral-sort"
            name="sort"
            label="정렬"
            defaultValue={query.sort}
            options={(Object.keys(SORT_LABELS) as ReferralSort[]).map((value) => ({ value, label: SORT_LABELS[value] }))}
          />
          <SelectInput
            id="admin-referral-size"
            name="size"
            label="페이지 크기"
            defaultValue={String(query.size)}
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
