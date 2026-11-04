"use client";

import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import Modal from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/format/date";

import { approveUserAction } from "../actions";
import type { AdminUserDto, AdminUserRoleDto } from "../remote";
import type { AdminActionResult } from "../types";

interface AdminUserTableProps {
  users: AdminUserDto[];
  tab: "pending" | "approved" | "all";
}

const ROLE_LABELS: Record<AdminUserRoleDto, string> = { REQUESTER: "의뢰기관", EXAMINER: "검사기관", ADMIN: "관리자" };
const NETWORK_ERROR_MESSAGE = "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";

// 의뢰·예약 목록(Mock 와이어프레임)과 같은 표·입력 모양
const thClass = "whitespace-nowrap border-b border-line px-4 py-3 text-left text-[13px] font-semibold text-gray-500";
const tdClass = "px-4 py-3.5 text-sm text-gray-700";
const controlClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

/**
 * 회원 목록 (API 모드). 검색은 받은 목록 안에서만 한다 (백엔드 목록 API에 검색 조건이 없다).
 * 승인 대기 사용자에게만 승인 버튼을 두고, 확인 대화상자를 거친 뒤 Server Function으로 승인한다.
 * 결과는 서버가 다시 그린 목록으로 맞춘다 (화면에서 먼저 바꾸지 않는다). 승인 취소·삭제·역할 변경 API는 없어 두지 않는다.
 */
export default function AdminUserTable({ users, tab }: AdminUserTableProps) {
  const [keyword, setKeyword] = useState("");
  const [target, setTarget] = useState<AdminUserDto | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [outcome, setOutcome] = useState<AdminActionResult | null>(null);

  const filtered = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return users;
    return users.filter((user) => user.loginId.toLowerCase().includes(value) || user.institutionName.toLowerCase().includes(value));
  }, [users, keyword]);

  const approve = async () => {
    if (!target || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await approveUserAction(target.userId);
      setOutcome(result);
      if (result.ok || result.reason === "CONFLICT" || result.reason === "NOT_FOUND") setTarget(null);
    } catch {
      setOutcome({ ok: false, reason: "NETWORK", message: NETWORK_ERROR_MESSAGE });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="search" aria-label="회원 검색" className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[190px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="로그인 ID·기관명 검색"
            aria-label="로그인 ID 또는 기관명 검색 (받은 목록 안에서 찾습니다)"
            className={`${controlClass} pl-9`}
          />
        </div>
        <p role="status" aria-live="polite" className="text-[15px] text-gray-600">
          총 <span className="font-bold text-primary">{filtered.length}</span>명
          {keyword.trim() && <span className="text-gray-500"> (전체 {users.length}명 중)</span>}
        </p>
      </div>

      {outcome && (
        <p
          role={outcome.ok ? "status" : "alert"}
          className={`rounded-lg px-4 py-3 text-sm ${outcome.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
        >
          {outcome.message}
        </p>
      )}

      {filtered.length === 0 ? (
        <div role="status" className="rounded-xl border border-dashed border-line-strong bg-white px-6 py-14 text-center text-[15px] text-gray-500">
          {users.length === 0
            ? tab === "pending"
              ? "가입 승인을 기다리는 회원이 없습니다."
              : "회원이 없습니다."
            : "검색 조건에 맞는 회원이 없습니다."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thClass}>로그인 ID</th>
                <th scope="col" className={thClass}>역할</th>
                <th scope="col" className={thClass}>소속 기관</th>
                <th scope="col" className={thClass}>가입일</th>
                <th scope="col" className={`${thClass} text-center!`}>승인 상태</th>
                <th scope="col" className={`${thClass} text-center!`}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.userId} className="border-t border-line transition-colors first:border-t-0 hover:bg-gray-50/70">
                  <td className={`${tdClass} whitespace-nowrap font-medium`}>{user.loginId}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{ROLE_LABELS[user.role]}</td>
                  <td className={tdClass}>{user.institutionName || "—"}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{user.createdAt ? formatDateTime(user.createdAt) : "—"}</td>
                  <td className={`${tdClass} text-center`}>
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none ring-1 ring-inset ring-black/5 ${
                        user.active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {user.active ? "승인 완료" : "승인 대기"}
                    </span>
                  </td>
                  <td className={`${tdClass} text-center`}>
                    {!user.active ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOutcome(null);
                          setTarget(user);
                        }}
                        aria-label={`${user.loginId} 가입 승인`}
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        승인
                      </button>
                    ) : (
                      <span className="text-gray-400" aria-label="처리할 작업 없음">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={target !== null} title="가입 승인" onClose={() => !pending && setTarget(null)} closeOnBackdrop={!pending}>
        {target && (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] text-gray-700">
              <strong className="font-semibold text-gray-900">{target.loginId}</strong>({ROLE_LABELS[target.role]} · {target.institutionName}) 회원의 가입을
              승인할까요? 승인하면 바로 로그인할 수 있습니다.
            </p>
            {outcome && !outcome.ok && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {outcome.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTarget(null)}
                disabled={pending}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                data-autofocus
                onClick={approve}
                disabled={pending}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "승인 중…" : "승인"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
