import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 관리자 의뢰·예약·슬롯 이력 화면 공용 조각. 클래스 값은 공통 스타일(components/ui/styles.ts)과 같은 기준이다.
 */

export const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
export const tdClass = "px-4 py-3.5 text-sm text-gray-700";
export const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";
export const detailLinkClass =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-primary/40 bg-white px-3.5 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft";
export const smallLinkClass = "inline-flex h-8 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50";
/** 검색·초기화 버튼: 의뢰기관 슬롯 검색과 같은 공통 버튼 */
export { resetButtonClass as resetClass, searchButtonClass as submitClass } from "@/components/ui/styles";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuidText = (value: string) => UUID_PATTERN.test(value);

export const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

/** 값이 없음(null). 의미에 맞는 문구를 받는다 (기본 '없음') */
export function None({ label = "없음" }: { label?: string }) {
  return <span className="text-gray-400">{label}</span>;
}

/** ID 표기: 축약 + 전체 값 title. href가 있으면 이동 링크 */
export function IdText({ id, href, full = false, label }: { id: string | null; href?: string; full?: boolean; label?: string }) {
  if (!id) return <None label={label} />;
  const text = <code className={`font-mono ${full ? "break-all text-[13px]" : "text-xs"} ${href ? "" : "text-gray-700"}`} title={id}>{full ? id : shortId(id)}</code>;
  return href ? (
    <Link href={href} className="text-primary underline-offset-2 hover:underline">
      {text}
    </Link>
  ) : (
    text
  );
}

export function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/** 예약 상태 배지: 의뢰기관 상세 대화상자와 같은 공통 배지를 쓴다 */
export { default as ReservationStatusBadge } from "@/features/referrals/components/ReservationStatusBadge";

export function TotalCount({ total, page, totalPages, unit }: { total: number; page: number; totalPages: number; unit: string }) {
  return (
    <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
      총 <span className="font-bold text-primary">{total}</span>건의 {unit}
      {totalPages > 0 && <span className="text-gray-500"> · {page + 1}/{totalPages}페이지</span>}
    </p>
  );
}

export function EmptyRows({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] text-gray-500">{children}</div>;
}

// ── 주소 조건 ──

export type SearchParams = Record<string, string | string[] | undefined>;

/** 문자열 조건 하나 (배열이면 올바르지 않음 → null, 없으면 "") */
export function readParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return null;
  return typeof value === "string" ? value.trim() : "";
}

/** 주소 `?page=`(1부터) → 0부터. 없으면 0, 올바르지 않으면 null */
export function parsePage(raw: string | null): number | null {
  if (raw === null) return null;
  if (raw === "") return 0;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw) - 1;
  return Number.isSafeInteger(page) ? page : null;
}

export function toHref(path: string, query: Record<string, string | undefined>): string {
  const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => !!entry[1])).toString();
  return search ? `${path}?${search}` : path;
}
