"use client";

import { useState } from "react";

import type { DateKey } from "@/lib/date/seoulDate";

import DatePicker from "./DatePicker";

interface DateField {
  id: string;
  label: string;
  /** GET 폼으로 보낼 쿼리 이름 */
  name: string;
  /** 주소에서 읽은 현재 값 (`YYYY-MM-DD`, 없으면 "") */
  defaultValue: string;
}

/**
 * 기간(시작일~종료일) 입력: 공통 커스텀 달력(DatePicker)을 GET 검색 폼에서 쓰기 위한 얇은 래퍼.
 * - 선택한 날짜를 숨은 입력(name)으로 보내 기존 쿼리 파라미터·검색 동작을 그대로 쓴다 (빈 값은 보내지 않는다)
 * - 조회용이라 지난 날짜도 고를 수 있다 (슬롯 검색의 '지난 날짜 선택 불가' 규칙은 가져오지 않는다)
 * - 종료일 달력에서는 시작일 이전, 시작일 달력에서는 종료일 이후 날짜를 고를 수 없다 (서버 검증은 그대로 유지)
 */
export default function FormDateRange({ from, to }: { from: DateField; to: DateField }) {
  const [start, setStart] = useState<DateKey | "">(from.defaultValue as DateKey | "");
  const [end, setEnd] = useState<DateKey | "">(to.defaultValue as DateKey | "");

  return (
    <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-4 sm:col-span-2 sm:grid-cols-2">
      <div className="min-w-0">
        <DatePicker
          id={from.id}
          label={from.label}
          value={start}
          onChange={setStart}
          placeholder="시작일 선택"
          getDisabledReason={(key) => (end && key > end ? "종료일 이후" : null)}
        />
        {start && <input type="hidden" name={from.name} value={start} />}
        {start && <ClearButton label={`${from.label} 지우기`} onClear={() => setStart("")} />}
      </div>
      <div className="min-w-0">
        <DatePicker
          id={to.id}
          label={to.label}
          value={end}
          onChange={setEnd}
          placeholder="종료일 선택"
          getDisabledReason={(key) => (start && key < start ? "시작일 이전" : null)}
        />
        {end && <input type="hidden" name={to.name} value={end} />}
        {end && <ClearButton label={`${to.label} 지우기`} onClear={() => setEnd("")} />}
      </div>
    </div>
  );
}

function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button type="button" onClick={onClear} className="mt-1.5 text-sm font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline">
      {label}
    </button>
  );
}
