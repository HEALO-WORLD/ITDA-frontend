import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ROUTES } from "@/constants/navigation";
import ReferralStatusBadge from "@/features/referrals/components/ReferralStatusBadge";
import { isReferralApiId, type FailureReasonDto, type ReservationStatusDto } from "@/features/referrals/remote";
import {
  loadRescheduleReservation,
  type RescheduleReferralItem,
  type RescheduleReferralLoadResult,
  type RescheduleReservationLoadResult,
} from "@/features/referrals/server";
import { WEEKDAYS } from "@/lib/format/date";
import { getWeekday } from "@/lib/date/seoulDate";

import NotificationPagination from "./NotificationPagination";
import RescheduleAlert from "./RescheduleAlert";

/**
 * 재조정 필요 배너·목록 (API 모드, referrals 기능). 서버 컴포넌트.
 * 페이지가 한 번만 시작한 조회 결과(Promise)를 배너와 목록이 함께 기다려 같은 기준(totalElements)을 쓴다.
 * - 응답에 없는 의뢰번호·검사기관·기존 예약일시·재조정 원인은 표시하지 않는다
 * - 실제 슬롯 검색 API와 재예약 Gateway 규칙이 없어 재조정 버튼은 준비 중으로 비활성화한다 (재예약 요청을 보내지 않는다)
 * - 실패는 0건으로 보지 않고 배너·목록에 실패를 알린다
 * - 상세 보기(`?rescheduleDetail=<의뢰 ID>`)를 고른 의뢰 하나만 기존 예약을 조회한다. 예약 ID는 URL로 받지 않고
 *   현재 페이지 목록 항목의 currentReservationId를 쓴다 (목록에 없는 의뢰는 조회하지 않는다)
 */

/** URL 페이지 파라미터 (알림 내역의 `?page=`와 겹치지 않게 따로 쓴다) */
export const RESCHEDULE_PAGE_PARAM = "reschedulePage";
/** 상세 보기로 고른 의뢰 ID 파라미터. 목록 페이지를 옮기면 닫힌다 */
export const RESCHEDULE_DETAIL_PARAM = "rescheduleDetail";

export async function ApiRescheduleAlert({ result }: { result: Promise<RescheduleReferralLoadResult> }) {
  const loaded = await result;
  if (loaded.ok) {
    // 원인(장애 장비)은 API에 없어 표시하지 않는다. 0건이면 RescheduleAlert가 아무것도 그리지 않는다
    return <RescheduleAlert count={loaded.totalElements} failureExamTypes={null} isMockData={false} />;
  }
  if (loaded.reason === "SIGNED_OUT") return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
      <p className="font-semibold">예약 재조정 필요 여부를 확인하지 못했습니다.</p>
      <p className="mt-1 text-sm">아래 &lsquo;예약 재조정 필요&rsquo; 목록의 안내를 확인해 주세요.</p>
    </div>
  );
}

const thClass = "whitespace-nowrap px-3 py-4 text-left text-sm font-semibold text-gray-600";
const tdClass = "px-3 py-4 text-[15px] text-gray-900";

export async function ApiRescheduleTable({
  result,
  searchParams,
}: {
  result: Promise<RescheduleReferralLoadResult>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [loaded, params] = await Promise.all([result, searchParams]);
  // 같은 화면의 알림 내역 쿼리(page·filter)는 유지한다. 상세 보기는 열고 닫을 때만 바꾼다
  const stringParams = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[0] !== RESCHEDULE_DETAIL_PARAM && typeof entry[1] === "string",
  );
  const baseQuery = Object.fromEntries(stringParams);
  // 목록 페이지를 옮기면 상세 보기는 닫는다
  const keepQuery = Object.fromEntries(stringParams.filter(([key]) => key !== RESCHEDULE_PAGE_PARAM));
  const detailHref = (referralId: string | null) =>
    `?${new URLSearchParams(referralId ? { ...baseQuery, [RESCHEDULE_DETAIL_PARAM]: referralId } : baseQuery)}`;
  const selection = loaded.ok ? findSelection(params[RESCHEDULE_DETAIL_PARAM], loaded.items) : null;
  const selectedId = selection && selection !== "INVALID" && selection !== "NOT_ON_PAGE" ? selection.referralId : null;

  return (
    <section aria-labelledby="reschedule-title" className="rounded-xl border border-line bg-white px-5 pb-6 pt-7 sm:px-6">
      <h2 id="reschedule-title" className="text-2xl font-bold text-gray-900">
        예약 재조정 필요{loaded.ok && <span className="ml-2 text-lg font-semibold text-gray-500">{loaded.totalElements}건</span>}
      </h2>

      {!loaded.ok ? (
        <div className="mt-5">
          <FailureNotice failure={loaded} />
        </div>
      ) : (
        <>
          <p className="mb-5 mt-2 text-[15px] text-gray-600">
            {loaded.totalElements > 0 && "아래 의뢰는 예약 재조정이 필요합니다. 새 슬롯 선택 기능은 준비 중입니다."}
          </p>
          {loaded.examTypeWarning && (
            <p role="status" className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {loaded.examTypeWarning}
            </p>
          )}
          {loaded.items.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-[15px] text-gray-500">
              {loaded.totalElements > 0 ? "이 페이지에 표시할 의뢰가 없습니다." : "재조정이 필요한 예약이 없습니다."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[680px] border-collapse">
                <thead className="bg-gray-100/80">
                  <tr>
                    <th scope="col" className={thClass}>의뢰 ID</th>
                    <th scope="col" className={thClass}>환자명</th>
                    <th scope="col" className={thClass}>검사유형</th>
                    <th scope="col" className={`${thClass} text-center`}>상태</th>
                    <th scope="col" className={`${thClass} text-center`}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.items.map((item) => (
                    <tr
                      key={item.referralId}
                      className={`border-t border-line ${item.referralId === selectedId ? "bg-primary-soft" : ""}`}
                    >
                      <td className={`${tdClass} font-mono text-xs text-gray-700`}>{item.referralId}</td>
                      <td className={`${tdClass} whitespace-nowrap`}>{item.patientName}</td>
                      <td className={tdClass}>{item.examTypeName ?? <span className="text-gray-500">확인 불가</span>}</td>
                      <td className={`${tdClass} text-center`}>
                        <ReferralStatusBadge status="RESCHEDULE_REQUIRED" />
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <div className="flex items-center justify-center gap-2">
                          <Link
                            href={detailHref(item.referralId === selectedId ? null : item.referralId)}
                            scroll={false}
                            aria-controls={item.referralId === selectedId ? "reschedule-detail" : undefined}
                            className={actionClass}
                          >
                            {item.referralId === selectedId ? "상세 닫기" : "상세 보기"}
                          </Link>
                          <button
                            type="button"
                            disabled
                            aria-describedby="reschedule-unavailable"
                            className="inline-flex h-10 cursor-not-allowed items-center whitespace-nowrap rounded-lg bg-gray-200 px-4 text-[15px] font-semibold text-gray-500"
                          >
                            새 슬롯 검색 (준비 중)
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loaded.items.length > 0 && (
            <p id="reschedule-unavailable" className="mt-3 text-sm text-gray-500">
              실제 슬롯 검색과 예약 변경 요청은 서버 기능이 준비된 뒤 이용할 수 있습니다.
            </p>
          )}
          {selection === "INVALID" || selection === "NOT_ON_PAGE" ? (
            <DetailPanel closeHref={detailHref(null)}>
              <p role="alert" className="text-[15px] text-red-700">
                {selection === "INVALID"
                  ? "선택한 의뢰 ID가 올바르지 않습니다."
                  : "선택한 의뢰가 현재 목록 페이지에 없습니다. 목록에서 다시 선택해 주세요."}
              </p>
            </DetailPanel>
          ) : (
            selection && (
              <Suspense
                key={selection.referralId}
                fallback={
                  <DetailPanel closeHref={detailHref(null)}>
                    <p role="status" className="text-[15px] text-gray-500">
                      기존 예약 정보를 불러오고 있습니다.
                    </p>
                  </DetailPanel>
                }
              >
                <ReservationDetail item={selection} closeHref={detailHref(null)} />
              </Suspense>
            )
          )}
          <NotificationPagination
            page={loaded.page}
            totalPages={loaded.totalPages}
            query={keepQuery}
            pageParam={RESCHEDULE_PAGE_PARAM}
            label="재조정 필요 목록 페이지"
          />
        </>
      )}
    </section>
  );
}

/** URL의 상세 보기 의뢰 ID를 현재 페이지 목록 항목과 맞춘다 (없음 null · 형식 오류 INVALID · 다른 페이지 NOT_ON_PAGE) */
function findSelection(
  raw: string | string[] | undefined,
  items: readonly RescheduleReferralItem[],
): RescheduleReferralItem | "INVALID" | "NOT_ON_PAGE" | null {
  if (raw === undefined || raw === "") return null;
  if (!isReferralApiId(raw)) return "INVALID";
  return items.find(({ referralId }) => referralId.toLowerCase() === raw.toLowerCase()) ?? "NOT_ON_PAGE";
}

const RESERVATION_STATUS_LABELS: Record<ReservationStatusDto, string> = {
  REQUESTED: "예약 요청",
  HELD: "슬롯 확보",
  CONFIRMED: "예약 확정",
  FAILED: "예약 실패",
  BLOCKED: "장애로 차단",
  CANCELED: "예약 취소",
};

const FAILURE_REASON_LABELS: Record<FailureReasonDto, string> = {
  SLOT_CONFLICT: "슬롯 충돌",
  CONFIRM_FAILED: "예약 확정 실패",
  HOLD_EXPIRED: "슬롯 확보 시간 만료",
  EQUIPMENT_FAILURE: "장비 장애",
};

const RESERVATION_FAILURE_TITLES: Record<Exclude<RescheduleReservationLoadResult, { ok: true }>["reason"], string> = {
  NO_RESERVATION: "연결된 예약이 없습니다.",
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: "예약 정보를 볼 수 없는 계정입니다.",
  NOT_FOUND: "예약 정보를 찾을 수 없습니다.",
  NETWORK: "예약 서버에 연결할 수 없습니다.",
  ERROR: "기존 예약 정보를 불러오지 못했습니다.",
};

function DetailPanel({ closeHref, children }: { closeHref: string; children: ReactNode }) {
  return (
    <section
      id="reschedule-detail"
      aria-labelledby="reschedule-detail-title"
      className="mt-5 rounded-lg border border-line bg-gray-50 px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="reschedule-detail-title" className="text-lg font-bold text-gray-900">
          기존 예약 정보
        </h3>
        <Link href={closeHref} scroll={false} className={actionClass}>
          닫기
        </Link>
      </div>
      {children}
    </section>
  );
}

/** 선택한 의뢰의 기존 예약 (이 컴포넌트가 렌더링될 때만 예약 API를 부른다) */
async function ReservationDetail({ item, closeHref }: { item: RescheduleReferralItem; closeHref: string }) {
  const loaded = await loadRescheduleReservation(item);
  if (!loaded.ok) {
    return (
      <DetailPanel closeHref={closeHref}>
        <div role={loaded.reason === "NO_RESERVATION" ? "status" : "alert"} className="flex flex-col gap-2 text-[15px]">
          <p className={loaded.reason === "NO_RESERVATION" ? "font-semibold text-gray-700" : "font-semibold text-red-700"}>
            {RESERVATION_FAILURE_TITLES[loaded.reason]}
          </p>
          <p className="text-sm text-gray-600">{loaded.reason === "UNAUTHORIZED" ? "다시 로그인해 주세요." : loaded.message}</p>
          {loaded.reason === "UNAUTHORIZED" && (
            <form action="/auth/logout" method="post">
              <button type="submit" className={actionClass}>
                다시 로그인
              </button>
            </form>
          )}
        </div>
      </DetailPanel>
    );
  }

  const { detail } = loaded;
  return (
    <DetailPanel closeHref={closeHref}>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[15px]">
        <dt className="text-gray-600">의뢰 ID</dt>
        <dd className="break-all font-mono text-xs leading-6 text-gray-700">{item.referralId}</dd>
        <dt className="text-gray-600">검사 일시</dt>
        <dd className="text-gray-900">
          {detail.examDate} ({WEEKDAYS[getWeekday(detail.examDate)]}) {detail.startTime}~{detail.endTime}
        </dd>
        <dt className="text-gray-600">예약 상태</dt>
        <dd className="text-gray-900">
          {RESERVATION_STATUS_LABELS[detail.reservationStatus]}{" "}
          <span className="font-mono text-xs text-gray-500">{detail.reservationStatus}</span>
        </dd>
        <dt className="text-gray-600">실패 사유</dt>
        <dd className="text-gray-900">
          {detail.failureReason ? (
            <>
              {FAILURE_REASON_LABELS[detail.failureReason]}{" "}
              <span className="font-mono text-xs text-gray-500">{detail.failureReason}</span>
            </>
          ) : (
            <span className="text-gray-500">없음</span>
          )}
        </dd>
        <dt className="text-gray-600">검사기관 ID</dt>
        <dd className="break-all font-mono text-xs leading-6 text-gray-700">{detail.examInstitutionId}</dd>
        <dt className="text-gray-600">장비 ID</dt>
        <dd className="break-all font-mono text-xs leading-6 text-gray-700">{detail.equipmentId}</dd>
      </dl>
      <p className="mt-3 text-sm text-gray-500">검사기관·장비 이름은 조회 기능이 준비되지 않아 ID로 표시합니다.</p>
    </DetailPanel>
  );
}

const FAILURE_TITLES: Record<Exclude<RescheduleReferralLoadResult, { ok: true }>["reason"], string> = {
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었거나 올바르지 않습니다.",
  FORBIDDEN: "재조정 필요 목록을 볼 수 없는 계정입니다.",
  NETWORK: "재조정 필요 목록 서버에 연결할 수 없습니다.",
  ERROR: "재조정 필요 목록을 불러오지 못했습니다.",
};

const actionClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50";

function FailureNotice({ failure }: { failure: Exclude<RescheduleReferralLoadResult, { ok: true }> }) {
  const isError = failure.reason !== "SIGNED_OUT";
  const message =
    failure.reason === "SIGNED_OUT"
      ? "재조정 필요 목록은 의뢰기관 계정으로 로그인한 뒤 확인할 수 있습니다."
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
      <p className="text-sm">{message}</p>
      {failure.reason === "SIGNED_OUT" && (
        <Link href={ROUTES.login} className={actionClass}>
          로그인
        </Link>
      )}
      {failure.reason === "UNAUTHORIZED" && (
        // 쿠키 삭제는 Route Handler에서만 가능하므로 폼 POST로 로그아웃한 뒤 로그인 화면으로 이동한다
        <form action="/auth/logout" method="post">
          <button type="submit" className={actionClass}>
            다시 로그인
          </button>
        </form>
      )}
    </div>
  );
}
