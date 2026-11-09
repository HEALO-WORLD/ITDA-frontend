import { AlertTriangle, Info } from "lucide-react";

import type { EquipmentIncidentSummaryDto } from "../remote";
import type { IncidentLoadFailure } from "../server";

/** 집계 로더 결과 (server.ts loadIncidentSummary) */
export type IncidentSummaryResult = { ok: true; summary: EquipmentIncidentSummaryDto } | IncidentLoadFailure;

/**
 * 서버 LocalDateTime 문자열 → 화면 표시 `YYYY-MM-DD HH:mm(:ss)`.
 * 시간대 표기가 없는 값이라 Date로 바꾸지 않는다 (브라우저 시간대로 바뀌지 않게 문자열만 자른다: T → 공백, 소수 초 제외)
 */
export function formatSummaryAsOf(asOf: string): string {
  return asOf.replace("T", " ").split(".")[0];
}

/**
 * 장비 장애 현황 (API 모드, GET /api/v1/equipment-incidents/summary).
 * - 검사기관 전체 집계라 아래 목록의 장비 필터·페이지와 관계없다 (목록 건수로 대신하지 않는다)
 * - 실패하면 숫자 대신 '확인 불가'를 보인다 (0으로 채우지 않는다). 정상 0건은 숫자 0으로 보인다
 * - 복구 완료 건수는 API에 없어 표시하지 않는다 (다른 값으로 추론하지 않는다)
 * Mock 화면은 IncidentSummary를 그대로 쓴다.
 */
export default function IncidentApiSummary({ result }: { result: IncidentSummaryResult }) {
  const summary = result.ok ? result.summary : null;
  const needsReschedule = summary?.needsRescheduleReferralCount ?? 0;
  return (
    <section aria-labelledby="incident-summary-title" className="rounded-xl border border-line bg-white px-5 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="incident-summary-title" className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-gray-900">
          장비 장애 현황
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">검사기관 전체 기준</span>
        </h2>
        {summary && (
          <p className="text-xs text-gray-500">
            기준 시각{" "}
            <time dateTime={summary.asOf} title={summary.asOf} className="font-medium tabular-nums text-gray-700">
              {formatSummaryAsOf(summary.asOf)}
            </time>
          </p>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryItem
          label="현재 중단 장비"
          basis="등록된 중단 시간 기준"
          value={summary ? `${summary.activeDowntimeEquipmentCount}대` : null}
        />
        <SummaryItem label="누적 영향 의뢰" basis="누적 기준" value={summary ? `${summary.affectedReferralCount}건` : null} />
        {/* 재조정 필요: 지금 조치가 필요한 값이라 따로 강조한다. 색만으로 구분하지 않게 '조치 필요' 글자를 함께 둔다 */}
        <SummaryItem
          label="재조정 필요 의뢰"
          basis="현재 상태 기준"
          value={summary ? `${summary.needsRescheduleReferralCount}건` : null}
          emphasis={needsReschedule > 0 ? "action" : "normal"}
        />
      </dl>

      {result.ok ? (
        <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[13px] leading-relaxed text-gray-600">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          아래 목록의 장비 필터·페이지와 관계없는 우리 기관 전체 현황입니다. 장애 처리 반영이 늦으면 잠시 실제와 다를 수 있습니다.
        </p>
      ) : (
        <p role="status" className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[13px] leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          장비 장애 현황을 불러오지 못해 집계를 표시하지 않습니다. 장애 목록은 그대로 확인할 수 있습니다.
          {result.reason === "NETWORK" || result.reason === "ERROR" ? " 잠시 후 다시 시도해 주세요." : ""}
        </p>
      )}
    </section>
  );
}

function SummaryItem({
  label,
  basis,
  value,
  emphasis = "normal",
}: {
  label: string;
  basis: string;
  /** null = 조회 실패 ('확인 불가'로 보인다) */
  value: string | null;
  emphasis?: "normal" | "action";
}) {
  const action = emphasis === "action";
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-lg px-4 py-3 ${action ? "bg-red-50/70 ring-1 ring-inset ring-red-200" : "bg-gray-50"}`}>
      <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-gray-700">
        {label}
        {action && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">조치 필요</span>}
      </dt>
      <dd className="flex flex-col gap-0.5">
        {value === null ? (
          <span className="w-fit rounded-md bg-gray-200/70 px-2 py-0.5 text-sm font-semibold text-gray-600">확인 불가</span>
        ) : (
          <span className={`text-2xl font-bold tabular-nums ${action ? "text-red-600" : "text-gray-900"}`}>{value}</span>
        )}
        <span className="text-xs text-gray-500">{basis}</span>
      </dd>
    </div>
  );
}
