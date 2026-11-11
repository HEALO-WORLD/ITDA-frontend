"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { detailButtonClass } from "@/components/ui/styles";
import { DetailError } from "@/features/referrals/components/ReferralDetailParts";
import ReferralIdCopyButton from "@/features/referrals/components/ReferralIdCopyButton";
import { abbreviateReferralId } from "@/features/referrals/referralId";

import type { AdminLoadFailure } from "../server";

/**
 * 관리자 상세 대화상자(의뢰·예약·장비 장애) 공용 조각.
 *
 * 열린 상태는 주소 쿼리(`?referralId=` · `?reservationId=` · `?incidentId=`)로 나타낸다.
 * - 상세 버튼은 history.pushState로 쿼리만 붙인다: 목록을 서버에서 다시 그리지 않아 검색 조건·페이지·스크롤이 그대로다
 * - 직접 접근·뒤로/앞으로 가기는 주소가 바뀌면 useSearchParams로 따라간다
 * - 닫으면 상세 쿼리만 뺀다 (버튼으로 열었으면 뒤로 가기, 주소로 바로 들어왔으면 주소만 바꾼다)
 * 데이터는 대화상자가 열릴 때만 Server Function으로 조회한다 (ADMIN·출처 확인은 서버에서).
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NETWORK_FAILURE: AdminLoadFailure = { ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.", code: null };

/** 이 화면 안에서 버튼으로 연 경우 (닫을 때 뒤로 가기로 되돌린다). 대화상자는 한 번에 하나만 열린다 */
let openedInPage = false;

function urlWith(updates: Record<string, string | null>): string {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 주소 쿼리로 여닫는 상세 대화상자 상태. extraParams: 대화상자 안에서만 쓰는 쿼리 (닫을 때 함께 뺀다) */
export function useUrlDetail(param: string, extraParams: string[] = []) {
  const searchParams = useSearchParams();
  const id = searchParams.get(param);
  const close = () => {
    if (openedInPage) {
      openedInPage = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", urlWith(Object.fromEntries([param, ...extraParams].map((key) => [key, null]))));
    }
  };
  /** 대화상자 안의 조건 변경 (영향 의뢰 필터·페이지 등): 기록을 늘리지 않고 주소만 바꾼다 */
  const replaceParams = (updates: Record<string, string | null>) => window.history.replaceState(null, "", urlWith(updates));
  return { id, open: id !== null, valid: id !== null && UUID_PATTERN.test(id), searchParams, close, replaceParams };
}

/** 목록 행의 '상세' 버튼 */
export function AdminDetailButton({ param, id, label }: { param: string; id: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        openedInPage = true;
        window.history.pushState(null, "", urlWith({ [param]: id }));
      }}
      aria-label={label}
      className={detailButtonClass}
    >
      상세
    </button>
  );
}

/**
 * 상세 조회 결과 상태. key가 바뀌면(다른 대상·다른 조건) 다시 조회하고, 늦게 온 이전 응답은 버린다.
 * key가 null이면 조회하지 않는다 (닫힘·형식 오류).
 */
export function useDetailResult<T>(key: string | null, load: () => Promise<T>, onNetworkError: T) {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (key === null) return;
    const request = ++requestRef.current;
    loadRef.current().then(
      (value) => request === requestRef.current && setState({ key, value }),
      () => request === requestRef.current && setState({ key, value: onNetworkError }),
    );
    // onNetworkError는 고정 값이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const retry = useCallback(() => {
    setState(null);
    setAttempt((n) => n + 1);
  }, []);
  return { value: state && state.key === key ? state.value : null, retry };
}

export const FAILURE_TITLES: Record<AdminLoadFailure["reason"], string> = {
  SIGNED_OUT: "로그인이 필요합니다.",
  UNAUTHORIZED: "로그인 정보가 만료되었습니다.",
  FORBIDDEN: "조회할 권한이 없습니다.",
  NETWORK: "서버에 연결할 수 없습니다.",
  ERROR: "상세 정보를 불러오지 못했습니다.",
};

/** 단건 조회 실패 안내 (원인별 제목 + 다시 시도: 연결·서버 오류일 때만) */
export function AdminDetailError({ failure, onRetry }: { failure: AdminLoadFailure; onRetry: () => void }) {
  return (
    <DetailError
      title={FAILURE_TITLES[failure.reason]}
      message={failure.message}
      onRetry={failure.reason === "NETWORK" || failure.reason === "ERROR" ? onRetry : undefined}
    />
  );
}

/** 연한 회색 정보 카드 (제목 + 오른쪽 보조 링크) */
export function InfoCard({ icon: Icon, title, action, children, className = "" }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-xl border border-line bg-gray-50/60 p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Icon className="size-4 text-gray-400" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 축약 ID + 전체 UUID 복사 (전체 값은 title·기술 정보에서 확인) */
export function ShortId({ id, label }: { id: string; label: string }) {
  return <ReferralIdCopyButton referralId={id} label={label} />;
}

/** 축약 ID 문자열 (링크 안 등 복사 버튼을 둘 수 없는 곳) */
export const shortIdText = abbreviateReferralId;

/** '기술 정보 보기': 업무 화면에서 우선순위를 낮춘 내부 식별자 전체 값 (데이터는 그대로 모두 보인다) */
export function TechInfo({ items }: { items: [label: string, id: string | null][] }) {
  return (
    <details className="group rounded-xl border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        기술 정보 보기
        <ChevronDown className="size-4 text-gray-400 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line px-4 py-4 sm:grid-cols-2">
        {items.map(([label, id]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium text-gray-500">{label}</dt>
            <dd className="mt-1 break-all font-mono text-[13px] text-gray-700">{id ?? <span className="font-sans text-gray-400">없음</span>}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** 하단 고정 닫기 버튼 (Modal footer) */
export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-lg border border-line bg-white px-5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
      닫기
    </button>
  );
}
