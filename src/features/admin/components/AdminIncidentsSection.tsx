import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";

import { SelectInput, TextInput } from "@/components/ui/FormControls";
import SharedStatusBadge from "@/components/ui/StatusBadge";
import { resetButtonClass, searchButtonClass, searchCardClass } from "@/components/ui/styles";
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

import { loadAdminIncidentPage, type AdminIncidentListQuery } from "../incidents";
import type { InstitutionDto } from "../remote";
import { loadInstitutions } from "../server";

import AdminIncidentDetailModal, { AdminIncidentDetailButton } from "./AdminIncidentDetailModal";
import { AdminFailureNotice } from "./AdminNotices";

interface AdminIncidentsSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

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

  return (
    <div className="flex flex-col gap-5">
      <IncidentFilter query={query.list} institutions={examInstitutions} institutionsFailed={!institutions.ok} />

      <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
        총 <span className="font-bold text-primary">{list.totalElements}</span>건의 장비 장애
        {list.totalPages > 0 && <span className="text-gray-500"> · {list.page + 1}/{list.totalPages}페이지</span>}
      </p>

      {list.incidents.length === 0 ? (
        <div role="status" className="rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] text-gray-500">
          {list.page > 0 ? "이 페이지에 장비 장애가 없습니다." : Object.keys(listQuery).length ? "검색 조건에 맞는 장비 장애가 없습니다." : "등록된 장비 장애가 없습니다."}
        </div>
      ) : (
        <IncidentTable rows={list.incidents} institutionName={(id) => nameById.get(id.toLowerCase())} />
      )}
      <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="장비 장애 목록 페이지" />

      {/* 상세 대화상자 (?incidentId=, 영향 의뢰 조건 ?referralStatus=·?referralPage=). 관리자 전용 lastError는 관리자 로더에서만 온다 */}
      <AdminIncidentDetailModal institutionNames={Object.fromEntries(nameById)} />
    </div>
  );
}

/** 검색 조건 (일반 GET 폼: 검색하면 첫 페이지로 간다) */
function IncidentFilter({ query, institutions, institutionsFailed }: { query: AdminIncidentListQuery; institutions: InstitutionDto[]; institutionsFailed: boolean }) {
  return (
    <form role="search" aria-label="장비 장애 검색 조건" action={ROUTES.admin.incidents} method="get" className={searchCardClass}>
      {/* 기준: 의뢰기관 검사 슬롯 검색 (라벨 붙은 공통 입력 + 오른쪽 아래 버튼) */}
      <div className="grid grid-cols-1 items-end gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <SelectInput
          id="admin-incident-institution"
          name="institutionId"
          label="검사기관"
          defaultValue={query.institutionId ?? ""}
          disabled={institutionsFailed}
          options={[{ value: "", label: "전체 검사기관" }, ...institutions.map((item) => ({ value: item.id, label: item.name }))]}
        />
        <TextInput id="admin-incident-equipment" name="equipmentId" label="장비 ID" defaultValue={query.equipmentId ?? ""} placeholder="전체 UUID 입력" autoComplete="off" />
        {/* 장애 상태는 백엔드 EquipmentIncidentStatus가 OCCURRED 하나뿐이라 선택 상자를 두지 않는다.
            주소로 받은 ?status=는 검색해도 유지한다 (백엔드 status 조건 지원은 그대로) */}
        {query.status && <input type="hidden" name="status" value={query.status} />}
        <div className="flex gap-2 sm:col-span-2 sm:justify-end xl:col-span-1">
          <Link href={ROUTES.admin.incidents} className={resetButtonClass}>
            <RotateCcw className="size-4" aria-hidden="true" />
            초기화
          </Link>
          <button type="submit" className={searchButtonClass}>
            <Search className="size-5" aria-hidden="true" />
            검색
          </button>
        </div>
      </div>
      {institutionsFailed && (
        <p role="status" className="text-sm text-amber-700">기관 목록을 불러오지 못해 검사기관 조건을 쓸 수 없고, 기관은 ID로 표시합니다. 장애 목록은 그대로 확인할 수 있습니다.</p>
      )}
    </form>
  );
}

function IncidentTable({
  rows,
  institutionName,
}: {
  rows: EquipmentIncidentDto[];
  institutionName: (id: string) => string | undefined;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
      <table className="w-full min-w-[1040px] border-collapse">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>장애 발생일시</th>
            <th scope="col" className={thClass}>검사기관</th>
            <th scope="col" className={thClass}>장비 ID</th>
            <th scope="col" className={thClass}>장애 사유</th>
            <th scope="col" className={thClass}>영향 구간</th>
            <th scope="col" className={`${thClass} text-center!`}>장애 상태</th>
            <th scope="col" className={`${thClass} text-center!`}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((incident) => {
            return (
              <tr key={incident.incidentId} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
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
                  <AdminIncidentDetailButton incidentId={incident.incidentId} label={`${formatDateTime(incident.occurredAt)} 장애 상세 보기`} />
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

const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

function StatusBadge({ status }: { status: string }) {
  return <SharedStatusBadge tone={status === "OCCURRED" ? "danger" : "neutral"}>{status === "OCCURRED" ? "장애 발생" : status}</SharedStatusBadge>;
}

function Dash() {
  return <span className="text-gray-400">-</span>;
}

// 검사기관 장애 화면(IncidentApiSection)과 같은 표 모양
const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";
