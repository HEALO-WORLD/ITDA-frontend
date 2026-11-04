import Link from "next/link";

import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import { ROUTES } from "@/constants/navigation";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";
import { formatDateTime } from "@/lib/format/date";

import { loadAdminSlotHistories } from "../operations";
import type { SlotStatusChangeReasonDto, SlotStatusDto } from "../remote";

import { controlClass, EmptyRows, IdText, isUuidText, None, parsePage, readParam, resetClass, submitClass, tdClass, thClass, toHref, TotalCount, type SearchParams } from "./AdminDataParts";
import { AdminFailureNotice } from "./AdminNotices";

const PATH = ROUTES.admin.slots;

const SLOT_STATUS_LABELS: Record<SlotStatusDto, string> = { AVAILABLE: "예약 가능", HELD: "선점", BOOKED: "예약됨", UNAVAILABLE: "사용 불가" };
const SLOT_STATUS_TONE: Record<SlotStatusDto, StatusTone> = { AVAILABLE: "success", HELD: "info", BOOKED: "neutral", UNAVAILABLE: "warning" };
const SlotStatus = ({ status }: { status: SlotStatusDto }) => <StatusBadge tone={SLOT_STATUS_TONE[status]}>{SLOT_STATUS_LABELS[status]}</StatusBadge>;
const REASON_LABELS: Record<SlotStatusChangeReasonDto, string> = {
  HOLD: "슬롯 선점",
  BOOK: "예약 확정",
  HOLD_EXPIRED: "선점 만료",
  RELEASE_HOLD: "선점 해제",
  RELEASE_SLOT: "예약 슬롯 해제",
  ADMIN_RELEASE: "관리자 강제 해제",
  DOWNTIME_STARTED: "장비 중단 시작",
  DOWNTIME_ENDED: "장비 중단 종료",
};

/**
 * 슬롯 상태 이력 (관리자, API 모드, 조회만). 백엔드에 전체 슬롯 목록 API가 없어 슬롯 ID로만 조회한다.
 * - `?slotId=`(전체 UUID)·`?page=`(1부터). 형식이 틀리면 요청하지 않고 안내한다
 * - 예약 상세의 슬롯 ID 링크로 들어온다. 강제 해제(POST /slots/{id}/release)는 의뢰·예약 상태를 함께 바꾸지 않아 두지 않는다
 * - null 값은 의미에 맞게 '없음'으로 보인다 (이벤트 ID: API·스케줄러 변경, 변경한 사용자: 이벤트·스케줄러 변경)
 */
export default async function AdminSlotHistorySection({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const slotId = readParam(params, "slotId");
  const page = parsePage(readParam(params, "page"));
  const invalid = slotId === null || page === null || (slotId !== "" && !isUuidText(slotId));

  return (
    <div className="flex flex-col gap-5">
      <form role="search" aria-label="슬롯 상태 이력 조회" action={PATH} method="get" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="slotId"
            defaultValue={slotId ?? ""}
            placeholder="슬롯 ID (UUID)"
            aria-label="슬롯 ID (전체 UUID)"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "admin-slot-id-error" : undefined}
            autoComplete="off"
            required
            className={`${controlClass} min-w-[280px] flex-[2_1_360px] font-mono`}
          />
          <button type="submit" className={submitClass}>조회</button>
          <Link href={PATH} className={resetClass}>초기화</Link>
        </div>
        {invalid && (
          <p id="admin-slot-id-error" role="alert" className="text-sm text-red-600">
            슬롯 ID 형식이 올바르지 않습니다. 36자리 UUID(예: 3f2a…-…)를 그대로 입력해 주세요.
          </p>
        )}
      </form>
      {invalid || slotId === null || page === null ? null : slotId === "" ? (
        <EmptyRows>조회할 슬롯 ID를 입력해 주세요. 예약 관리의 예약 상세에서 슬롯 ID를 누르면 바로 이 화면으로 이동합니다.</EmptyRows>
      ) : (
        <SlotHistoryTable slotId={slotId} page={page} />
      )}
    </div>
  );
}

async function SlotHistoryTable({ slotId, page }: { slotId: string; page: number }) {
  const result = await loadAdminSlotHistories(slotId, page);
  if (!result.ok) return <AdminFailureNotice failure={result} />;
  return (
    <>
      <p className="text-sm text-gray-600">
        슬롯 <IdText id={slotId} full />의 상태 변경 이력 (변경 일시 오래된순)
      </p>
      <TotalCount total={result.totalElements} page={result.page} totalPages={result.totalPages} unit="상태 변경" />
      {result.items.length === 0 ? (
        <EmptyRows>{result.page > 0 ? "이 페이지에 상태 변경 이력이 없습니다." : "이 슬롯의 상태 변경 이력이 없습니다."}</EmptyRows>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[1120px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>변경 일시</th>
                <th scope="col" className={thClass}>이전 상태</th>
                <th scope="col" className={thClass}>변경 후 상태</th>
                <th scope="col" className={thClass}>변경 사유</th>
                <th scope="col" className={thClass}>관련 예약 ID</th>
                <th scope="col" className={thClass}>이벤트 ID</th>
                <th scope="col" className={thClass}>변경한 사용자 ID</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id} className="border-t border-line">
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatDateTime(item.changedAt)}</td>
                  <td className={tdClass}>{item.fromStatus ? <SlotStatus status={item.fromStatus} /> : <None label="없음 (최초)" />}</td>
                  <td className={tdClass}><span className="inline-flex items-center gap-1.5"><span className="text-gray-300" aria-hidden="true">→</span><SlotStatus status={item.toStatus} /></span></td>
                  <td className={tdClass}>
                    <span className="font-semibold text-gray-900">{REASON_LABELS[item.reason]}</span> <span className="font-mono text-xs text-gray-400">{item.reason}</span>
                  </td>
                  <td className={tdClass}>
                    <IdText id={item.reservationId} href={item.reservationId ? toHref(ROUTES.admin.reservations, { reservationId: item.reservationId }) : undefined} label="없음 (예약 무관)" />
                  </td>
                  <td className={tdClass}><IdText id={item.sourceEventId} label="없음 (API·스케줄러)" /></td>
                  <td className={tdClass}><IdText id={item.changedBy} label="없음 (이벤트·스케줄러)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NotificationPagination page={result.page} totalPages={result.totalPages} query={{ slotId }} label="슬롯 상태 이력 페이지" />
    </>
  );
}
