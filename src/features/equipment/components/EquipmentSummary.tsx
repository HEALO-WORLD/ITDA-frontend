"use client";

import { CalendarCheck, Magnet, ScanLine, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Equipment } from "../types";
import { useLiveEquipments } from "../useLiveEquipments";

import TodayAvailableSlotCount from "./TodayAvailableSlotCount";

interface EquipmentSummaryProps {
  organizationId: string;
}

/**
 * 장비 운영 요약 (MRI 장비 수 · CT 장비 수 · 오늘 예약 가능 슬롯). 좁은 화면에서는 줄바꿈된다.
 * 장비 수는 원본 + 화면에서 등록한 장비(개발용 Mock) 기준이다
 */
export default function EquipmentSummary({ organizationId }: EquipmentSummaryProps) {
  const equipments = useLiveEquipments(organizationId);
  const countByType = (type: Equipment["examType"]) =>
    equipments.filter(({ examType }) => examType === type).length;

  return (
    <EquipmentSummaryBar
      mri={<>{countByType("MRI")}대</>}
      ct={<>{countByType("CT")}대</>}
      todaySlots={<TodayAvailableSlotCount organizationId={organizationId} />}
    />
  );
}

/** 요약 바 모양 (Mock·API 공용). 값을 알 수 없는 항목은 호출한 쪽이 안내 문구를 넣는다 (0으로 채우지 않는다) */
export function EquipmentSummaryBar({ mri, ct, todaySlots }: { mri: ReactNode; ct: ReactNode; todaySlots: ReactNode }) {
  return (
    <ul
      aria-label="장비 운영 요약"
      className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-line bg-white px-6 py-4"
    >
      <SummaryItem icon={Magnet} label="MRI 장비">
        {mri}
      </SummaryItem>
      <SummaryItem icon={ScanLine} label="CT 장비">
        {ct}
      </SummaryItem>
      <SummaryItem icon={CalendarCheck} label="오늘 예약 가능 슬롯">
        {todaySlots}
      </SummaryItem>
    </ul>
  );
}

function SummaryItem({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft">
        <Icon className="size-[18px] text-primary" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="text-[15px] text-gray-600">{label}</span>
      <span className="text-xl font-bold text-gray-900">{children}</span>
    </li>
  );
}
