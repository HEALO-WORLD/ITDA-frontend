import { ChevronDown, Info, Plus, Search } from "lucide-react";
import Link from "next/link";

import { primaryButtonClass } from "@/components/ui/styles";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";

import { parsePageParam } from "@/features/examinations/server";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { ROUTES } from "@/constants/navigation";
import { formatDateTime } from "@/lib/format/date";

import { isDowntimeRegistrationEnabled } from "../downtimeConfig";
import { isUuid, type EquipmentIncidentDto } from "../remote";
import { loadIncidentPage, loadIncidentEquipmentLookup, type IncidentEquipmentLookup, type IncidentLoadFailure } from "../server";

import IncidentApiDetailModal, { IncidentApiDetailButton } from "./IncidentApiDetailModal";
import IncidentDowntimeRegister from "./IncidentDowntimeRegister";
import { IncidentSummaryBar } from "./IncidentSummary";

type SearchParams = Record<string, string | string[] | undefined>;

interface IncidentApiSectionProps {
  searchParams: Promise<SearchParams>;
}

/** 화면 주소 쿼리 이름 */
const Q = {
  page: "page",
  equipmentId: "equipmentId",
} as const;

/**
 * 장비 장애·재조정 (API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 *
 * - 목록: `?page=`(1부터) 백엔드 페이지, `?equipmentId=` 장비 필터 (백엔드 지원 필터. 장애 상태는 OCCURRED 하나뿐이라 필터를 두지 않는다)
 * - 상세: [상세]를 누르면 `?incidentId=`를 붙여 중앙 대화상자(IncidentApiDetailModal)로 장애 상세·영향 의뢰 처리 현황을 보여 준다
 *   (영향 의뢰 조건 `?referralStatus=`·`?referralPage=`). 대화상자가 열 때만 조회하므로 목록은 다시 그리지 않는다
 * - 접근 제어는 Gateway(토큰·역할)와 백엔드(기관 범위)가 한다. 프론트는 역할을 추정하지 않고 결과(401·403·404)를 안내한다
 * - 배포 와이어프레임(Mock 화면)과 같은 구성: 요약 바 → 장애 목록 카드(검색 조건·장애 등록 버튼·표)
 *   장비명·검사 유형은 우리 기관 장비 목록 1회로 찾는다 (행마다 요청하지 않는다). 못 찾으면 장비 ID로 보인다
 * - 백엔드에 없는 기능은 모양만 두고 비활성·안내: 장애 등록(장애 생성 API 없음)·복구, 발생일 기간 검색, 복구 완료·재조정 필요 집계
 * - 실패해도 Mock 데이터로 대체하지 않는다
 */
export default async function IncidentApiSection({ searchParams }: IncidentApiSectionProps) {
  const params = await searchParams;
  const page = parsePageParam(params[Q.page]);
  const rawEquipmentId = first(params[Q.equipmentId]);
  const equipmentId = isUuid(rawEquipmentId) ? rawEquipmentId : undefined;

  const [list, equipmentLookup] = await Promise.all([loadIncidentPage(page, equipmentId), loadIncidentEquipmentLookup()]);

  if (!list.ok) return <FailureNotice failure={list} />;

  const listQuery: Record<string, string> = equipmentId ? { [Q.equipmentId]: equipmentId } : {};
  // 장애 등록: 기능 스위치가 켜졌을 때만 (기본 꺼짐). 장비 선택지는 이미 받은 우리 기관 장비 목록만 쓴다 (추가 요청 없음)
  const canRegister = isDowntimeRegistrationEnabled();
  const registerEquipments = equipmentLookup ? Object.entries(equipmentLookup).map(([id, item]) => ({ id, name: item.name, modality: item.modality })) : null;

  return (
    <div className="flex flex-col gap-5">
      <IncidentSummaryBar
        items={[
          { label: equipmentId ? "이 장비의 장애 이력" : "장애 이력", value: `${list.totalElements}건`, valueClass: list.totalElements > 0 ? "text-red-600" : "text-gray-900" },
          // 조회할 수 없는 집계는 숫자 대신 회색 칩으로 구분한다 (문구·의미는 그대로)
          { label: "복구 완료 이력", value: "조회 준비 중", valueClass: "rounded-md bg-gray-100 px-2 py-0.5 text-sm! font-semibold text-gray-600" },
          { label: "재조정 필요 예약", value: "상세에서 확인", valueClass: "rounded-md bg-gray-100 px-2 py-0.5 text-sm! font-semibold text-gray-600" },
        ]}
        note="장애 복구 기능과 재조정 필요 예약 집계 API가 서버에 아직 없어 장애 이력 건수만 표시합니다. 영향받은 의뢰는 각 장애의 [상세]에서 확인할 수 있습니다."
      />
      <section
        aria-labelledby="incident-api-list-title"
        className="min-w-0 rounded-xl border border-line bg-white px-4 pb-4 pt-5 sm:px-6"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="incident-api-list-title" className="text-lg font-bold text-gray-900">
            장비 장애 목록
            <span className="ml-2 text-base font-semibold tabular-nums text-primary">{list.totalElements}건</span>
          </h2>
          {canRegister ? (
            <IncidentDowntimeRegister equipments={registerEquipments} />
          ) : (
            <button type="button" disabled aria-describedby="incident-register-unavailable" className={primaryButtonClass}>
              <Plus className="size-4" aria-hidden="true" />
              장비 장애 등록
            </button>
          )}
        </div>
        <IncidentFilterBar equipmentId={equipmentId} lookup={equipmentLookup} canRegister={canRegister} />

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
            lookup={equipmentLookup}
            equipmentHref={(id) => toHref({ [Q.equipmentId]: id })}
          />
        )}

        <NotificationPagination page={list.page} totalPages={list.totalPages} query={listQuery} label="장애 목록 페이지" />
      </section>

      {/* 상세 대화상자 (?incidentId=): 장비 이름은 이미 받은 장비 목록으로 찾는다 (추가 요청 없음) */}
      <IncidentApiDetailModal equipmentNames={equipmentLookup} />
    </div>
  );
}

/**
 * 검색 조건: 백엔드가 받는 장비 조건 + 검색 (일반 GET 폼, 검색하면 첫 페이지).
 * 장애 상태(OCCURRED 하나뿐)·기간 조건은 백엔드에 없어 항상 비활성이던 칸을 화면에서 숨기고, 아래 안내 문구로 이유를 알린다.
 */
function IncidentFilterBar({ equipmentId, lookup, canRegister }: { equipmentId: string | undefined; lookup: IncidentEquipmentLookup; canRegister: boolean }) {
  const control = "h-10 rounded-lg border border-line bg-white text-sm text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  const options = lookup ? Object.entries(lookup).sort((a, b) => a[1].name.localeCompare(b[1].name, "ko", { numeric: true })) : [];
  return (
    <form role="search" aria-label="장비 장애 검색 조건" method="get" className="mb-4 flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {lookup ? (
          <div className="relative min-w-0 sm:w-[280px]">
            <select name="equipmentId" aria-label="장비" defaultValue={equipmentId ?? ""} className={`${control} w-full cursor-pointer appearance-none pl-3 pr-9`}>
              <option value="">전체 장비</option>
              {options.map(([id, item]) => (
                <option key={id} value={id}>
                  {item.name} ({item.modality})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          </div>
        ) : (
          <input type="search" name="equipmentId" aria-label="장비 ID" defaultValue={equipmentId ?? ""} placeholder="장비 ID (전체 UUID)" className={`${control} w-full px-3 sm:w-[280px]`} />
        )}
        <button type="submit" className={`${primaryButtonClass} min-w-[96px]`}>
          <Search className="size-4" aria-hidden="true" />
          검색
        </button>
      </div>
      <p id="incident-register-unavailable" className="flex items-start gap-1.5 text-[13px] leading-relaxed text-gray-600">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {canRegister
          ? "장비 조건만 서버에서 검색합니다. 장애 상태·기간 검색은 서버 기능이 준비되면 사용할 수 있습니다."
          : "장비 조건만 서버에서 검색합니다. 장애 상태·기간 검색과 장비 장애 등록은 서버 기능이 준비되면 사용할 수 있습니다."}
        {!lookup && " 장비 목록을 불러오지 못해 장비는 ID로 입력합니다."}
      </p>
    </form>
  );
}

function IncidentApiTable({
  rows,
  lookup,
  equipmentHref,
}: {
  rows: EquipmentIncidentDto[];
  lookup: IncidentEquipmentLookup;
  equipmentHref: (equipmentId: string) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
      <table className="w-full min-w-[940px] table-fixed border-collapse">
        <colgroup>
          <col className="w-[156px]" />
          <col />
          <col className="w-[88px]" />
          <col className="w-[156px]" />
          <col className="w-[180px]" />
          <col className="w-[104px]" />
          <col className="w-[88px]" />
        </colgroup>
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className={thClass}>장애번호</th>
            <th scope="col" className={thClass}>장비명</th>
            <th scope="col" className={thClass}>검사 유형</th>
            <th scope="col" className={thClass}>장애 발생일시</th>
            <th scope="col" className={thClass}>영향 구간</th>
            <th scope="col" className={`${thClass} text-center!`}>장애 상태</th>
            <th scope="col" className={`${thClass} text-center!`}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((incident) => {
            const equipment = lookup?.[incident.equipmentId.toLowerCase()];
            return (
              <tr
                key={incident.incidentId}
                className="border-t border-line transition-colors hover:bg-gray-50"
              >
                <td className={`${tdClass} whitespace-nowrap`}>
                  <ReferralIdCopyButton referralId={incident.incidentId} label="장애번호" />
                </td>
                <td className={tdClass}>
                  {equipment ? (
                    <p className="truncate text-[15px] font-semibold text-gray-900" title={equipment.name}>
                      {equipment.name}
                    </p>
                  ) : (
                    <code className="block truncate font-mono text-xs text-gray-700" title={incident.equipmentId}>
                      {incident.equipmentId}
                    </code>
                  )}
                  <Link href={equipmentHref(incident.equipmentId)} className="mt-0.5 inline-block text-xs font-medium text-gray-500 underline-offset-2 hover:text-primary hover:underline">
                    이 장비의 장애만 보기
                  </Link>
                </td>
                <td className={`${tdClass} whitespace-nowrap`}>{equipment?.modality ?? <span className="text-gray-400">-</span>}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(incident.occurredAt)}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums text-sm`}>
                  {/* 시작 ~ 종료를 두 줄로 (긴 날짜 범위도 열 폭 안에서 읽기 쉽게) */}
                  <span className="block">{formatDateTime(incident.startAt)}</span>
                  <span className="block text-gray-500">~ {formatDateTime(incident.endAt)}</span>
                </td>
                <td className={`${tdClass} text-center`}>
                  <IncidentApiStatusBadge status={incident.status} />
                </td>
                <td className={`${tdClass} text-center`}>
                  <IncidentApiDetailButton incidentId={incident.incidentId} label={`${formatDateTime(incident.occurredAt)} 장애 상세 보기`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
