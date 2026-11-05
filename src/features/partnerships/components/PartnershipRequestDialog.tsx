"use client";

import { Loader2, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { controlClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/styles";
import { NETWORK_FAILURE, useDetailResult } from "@/features/admin/components/AdminDetailParts";

import { loadPartnershipTargetsAction, requestPartnershipAction } from "../actions";
import type { PartnershipTargetsResult } from "../server";
import { IN_PROGRESS_STATUSES, PARTNERSHIP_STATUS_LABELS, type PartnershipActionResult } from "../types";

const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

/**
 * 새 협약 요청 (의뢰기관). 열 때 요청 대상을 한 번 조회한다 (공개 기관 목록 + 내 기관 협약, 서버에서 병렬 2회).
 * - 검사기관(EXAM)만 보인다. 승인 대기·협약 중인 기관은 고를 수 없게 막고 이유를 보인다 (서버도 다시 확인한다)
 * - 거절·종료된 기관은 '다시 요청'으로 고를 수 있다 (서버가 기존 협약을 승인 대기로 바꾼다)
 * - 처리 중에는 다시 요청하지 않는다
 */
export default function PartnershipRequestDialog({ onClose, onDone }: { onClose: () => void; onDone: (result: PartnershipActionResult) => void }) {
  const { value: loaded, retry } = useDetailResult<PartnershipTargetsResult>("targets", () => loadPartnershipTargetsAction(), NETWORK_FAILURE);
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const targets = useMemo(() => {
    if (!loaded?.ok) return [];
    const value = keyword.trim().toLowerCase();
    return value ? loaded.targets.filter((item) => item.name.toLowerCase().includes(value)) : loaded.targets;
  }, [loaded, keyword]);
  const selected = loaded?.ok ? (loaded.targets.find((item) => item.id === selectedId) ?? null) : null;

  const submit = async () => {
    if (pendingRef.current) return;
    if (!selected || (selected.status && IN_PROGRESS_STATUSES.includes(selected.status))) {
      setError("협약을 요청할 검사기관을 선택해 주세요.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await requestPartnershipAction(selected.id);
      if (result.ok || result.reason === "CONFLICT") {
        onDone(result);
        return;
      }
      setError(result.message);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Modal open size="lg" title="새 협약 요청" description="협약할 검사기관을 고르면 그 기관에 협약을 요청합니다." onClose={() => !pending && onClose()} closeOnBackdrop={false}>
      <div className="flex flex-col gap-4">
        {loaded === null ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            검사기관 목록을 불러오고 있습니다.
          </p>
        ) : !loaded.ok ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loaded.message}
            {loaded.reason !== "FORBIDDEN" && (
              <button type="button" onClick={retry} className={secondaryButtonClass}>
                다시 시도
              </button>
            )}
          </div>
        ) : loaded.targets.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-gray-500">
            협약을 요청할 수 있는 활성 검사기관이 없습니다.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="검사기관명 검색"
                aria-label="검사기관명 검색"
                data-autofocus
                className={`${controlClass} pl-9`}
              />
            </div>
            <fieldset disabled={pending}>
              <legend className="sr-only">협약을 요청할 검사기관</legend>
              {targets.length === 0 ? (
                <p role="status" className="px-1 py-6 text-center text-sm text-gray-500">
                  검색 조건에 맞는 검사기관이 없습니다.
                </p>
              ) : (
                <ul className="flex max-h-[320px] flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {targets.map((item) => {
                    const blocked = item.status !== null && IN_PROGRESS_STATUSES.includes(item.status);
                    const inputId = `partnership-target-${item.id}`;
                    return (
                      <li key={item.id}>
                        <label
                          htmlFor={inputId}
                          className={`flex items-center justify-between gap-3 px-4 py-3 text-[15px] ${
                            blocked ? "cursor-not-allowed bg-gray-50 text-gray-400" : selectedId === item.id ? "cursor-pointer bg-primary-soft text-primary" : "cursor-pointer hover:bg-gray-50"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <input
                              id={inputId}
                              type="radio"
                              name="partnership-target"
                              value={item.id}
                              checked={selectedId === item.id}
                              disabled={blocked}
                              onChange={() => {
                                setSelectedId(item.id);
                                setError(null);
                              }}
                              className="size-4 accent-primary"
                            />
                            <span className="truncate font-medium">{item.name}</span>
                          </span>
                          <span className="shrink-0 text-xs">
                            {item.status === null
                              ? ""
                              : blocked
                                ? `${PARTNERSHIP_STATUS_LABELS[item.status]} · 요청 불가`
                                : `${PARTNERSHIP_STATUS_LABELS[item.status]} · 다시 요청 가능`}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
            <p className="text-sm text-gray-500">검사기관이 승인하기 전(승인 대기)에는 그 기관에 검사를 의뢰할 수 없습니다.</p>
          </>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={secondaryButtonClass}>
            취소
          </button>
          {loaded?.ok && loaded.targets.length > 0 && (
            <button type="button" onClick={submit} disabled={pending || !selected} aria-busy={pending} className={primaryButtonClass}>
              {pending ? "요청 중…" : selected?.status ? "다시 요청" : "협약 요청"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
