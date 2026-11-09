"use client";

import { ClipboardList, FileText, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { subtleDetailButtonClass } from "@/components/ui/styles";
import { ROUTES } from "@/constants/navigation";
import { formatDateTimeWithWeekday } from "@/lib/format/date";

import { getMockReferralResult } from "../mockResult";
import { abbreviateReferralId } from "../referralId";
import { loadReferralResultAction, type ResultLoadResponse } from "../resultActions";

import { DetailLoading } from "./ReferralDetailParts";

/**
 * 의뢰·예약 목록(API 모드)의 [검사결과] 버튼과 결과 대화상자 (조회 전용).
 * 열 때마다 그 의뢰의 결과 한 건만 조회한다.
 * - API 모드(source="api", 기본): Server Function → `GET /api/v1/referrals/{referralId}/results`
 * - Mock 모드(source="mock"): 개발용 Mock 검사 기록에서 찾는다 (백엔드 요청 없음, mockResult.ts)
 * 두 모드 모두 같은 응답 모양을 같은 결과 화면(ResultBody)으로 보인다.
 * 공통 Modal을 써서 Esc·닫기 버튼·포커스 이동·연 버튼으로 포커스 복귀를 그대로 쓴다.
 */
export default function ReferralResultButton({
  referralId,
  source = "api",
  label,
}: {
  referralId: string;
  source?: "api" | "mock";
  /** 화면에 보일 의뢰 번호 (Mock: R-010 등). 없으면 의뢰 ID 축약 */
  label?: string;
}) {
  const displayId = label ?? abbreviateReferralId(referralId);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ResultLoadResponse | null>(null);
  const loadingRef = useRef(false);

  const load = async () => {
    if (loadingRef.current) return; // 연속 클릭에 중복 요청하지 않는다
    loadingRef.current = true;
    setResult(null);
    try {
      setResult(source === "mock" ? getMockReferralResult(referralId) : await loadReferralResultAction(referralId));
    } catch {
      setResult({ ok: false, reason: "NETWORK", message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      loadingRef.current = false;
    }
  };

  const show = () => {
    setOpen(true);
    void load();
  };

  return (
    <>
      <button type="button" onClick={show} aria-haspopup="dialog" aria-label={`${displayId} 검사결과`} className={subtleDetailButtonClass}>
        검사결과
      </button>
      <Modal
        open={open}
        size="lg"
        title="검사결과"
        description={`의뢰 ${displayId}`}
        onClose={() => setOpen(false)}
        footer={
          <button type="button" onClick={() => setOpen(false)} className={closeButtonClass}>
            닫기
          </button>
        }
      >
        {!result ? <DetailLoading /> : <ResultBody result={result} onRetry={() => void load()} />}
      </Modal>
    </>
  );
}

const closeButtonClass =
  "inline-flex h-10 items-center rounded-lg border border-line bg-white px-5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50";

/** 결과 본문 (조회 결과별 화면. 테스트에서도 그대로 그린다) */
export function ResultBody({ result, onRetry }: { result: ResultLoadResponse; onRetry?: () => void }) {
  if (!result.ok) {
    // 결과 없음·조회 불가는 안내, 그 밖의 실패는 오류로 보이고 필요하면 다시 시도·재로그인을 붙인다
    const isEmpty = result.reason === "NOT_REGISTERED" || result.reason === "NOT_FOUND";
    const canRetry = result.reason === "NETWORK" || result.reason === "ERROR" || result.reason === "INVALID_RESPONSE";
    const signedOut = result.reason === "SIGNED_OUT" || result.reason === "UNAUTHORIZED";
    return (
      <div
        role={isEmpty ? "status" : "alert"}
        className={`flex flex-col items-center gap-3 rounded-xl px-4 py-10 text-center ${isEmpty ? "border border-dashed border-line bg-gray-50" : "border border-red-100 bg-red-50/70"}`}
      >
        {isEmpty ? <ClipboardList className="size-6 text-gray-400" aria-hidden="true" /> : <Info className="size-6 text-red-500" aria-hidden="true" />}
        <p className={`text-[15px] font-semibold ${isEmpty ? "text-gray-700" : "text-gray-900"}`}>{result.message}</p>
        {result.reason === "NOT_REGISTERED" && <p className="text-sm text-gray-500">검사기관에서 결과를 등록하면 이곳에서 확인할 수 있습니다.</p>}
        {canRetry && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            다시 시도
          </button>
        )}
        {signedOut && (
          <Link href={ROUTES.login} className="text-sm font-semibold text-primary underline underline-offset-4">
            다시 로그인
          </Link>
        )}
      </div>
    );
  }

  const { summary, notes, registeredAt } = result.data;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="검사결과 요약">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <FileText className="size-4 text-gray-400" aria-hidden="true" />
          검사결과 요약
        </h3>
        <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-4 py-3 text-[15px] text-gray-900">{summary}</p>
      </section>
      <section aria-label="추가 소견">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">추가 소견</h3>
        {notes && notes.trim() ? (
          <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-4 py-3 text-[15px] text-gray-900">{notes}</p>
        ) : (
          <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">추가 소견이 없습니다.</p>
        )}
      </section>
      <dl className="flex items-center gap-2 border-t border-line pt-4 text-sm">
        <dt className="text-gray-500">결과 등록 일시</dt>
        <dd className="font-medium tabular-nums text-gray-900">{formatDateTimeWithWeekday(registeredAt.slice(0, 16))}</dd>
      </dl>
    </div>
  );
}
