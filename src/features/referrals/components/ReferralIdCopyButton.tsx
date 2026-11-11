"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { abbreviateReferralId } from "../referralId";

interface ReferralIdCopyButtonProps {
  /** 의뢰 ID 원본(UUID 전체). 화면에는 줄여 보이지만 복사·요청에는 이 값을 쓴다 */
  referralId: string;
  /** 복사 대상 이름 (안내 문구·스크린리더). 기본 '의뢰 ID'. 예: '예약 ID', '장애 ID' */
  label?: string;
}

/**
 * 의뢰 ID 축약 표시 + 전체 UUID 복사 (API 모드 의뢰 목록).
 * 클립보드를 쓸 수 없거나(권한 거부·안전하지 않은 출처) 복사에 실패하면 전체 ID를 보여 직접 복사할 수 있게 한다.
 */
export default function ReferralIdCopyButton({ referralId, label = "의뢰 ID" }: ReferralIdCopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(referralId);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-sm font-medium text-gray-800" title={referralId}>
          {abbreviateReferralId(referralId)}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={`${label} ${abbreviateReferralId(referralId)} 전체 복사`}
          className="inline-flex size-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {state === "copied" ? (
            <Check className="size-4 text-emerald-600" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-xs">
        {state === "copied" && <span className="text-emerald-700">{label}를 복사했습니다.</span>}
        {state === "failed" && (
          <span className="text-red-600">
            복사하지 못했습니다. 아래 ID를 직접 선택해 복사해 주세요.
            <span className="mt-1 block select-all break-all font-mono text-gray-800">{referralId}</span>
          </span>
        )}
      </p>
    </div>
  );
}
