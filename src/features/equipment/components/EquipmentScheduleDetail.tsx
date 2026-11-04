import { Clock, Pencil } from "lucide-react";

import { WEEKDAYS } from "@/lib/format/date";

import { WEEK_ORDER } from "../operatingHours";
import { getSupportedExamTypeNames } from "../supportedExamTypes";
import type { Equipment } from "../types";

import EquipmentStatusBadge from "./EquipmentStatusBadge";

/**
 * 장비 상세: 상태·요일별 운영 시간과 [장비 정보 수정]·[운영 시간 수정] (수정은 개발용 Mock).
 * 장비 상태는 진행 중 장애 이력으로만 정해지며 여기서 바꾸지 않는다.
 */
export default function EquipmentScheduleDetail({
  equipment,
  onClose,
  onEditInfo,
  onEditHours,
}: {
  equipment: Equipment;
  onClose: () => void;
  onEditInfo: () => void;
  onEditHours: () => void;
}) {
  const byWeekday = new Map(equipment.operatingHours.map((item) => [item.weekday, item]));
  const supportedNames = getSupportedExamTypeNames(equipment.supportedExamTypeIds);

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-[15px]">
        <span className="font-medium text-gray-500">장비 상태</span>
        <EquipmentStatusBadge status={equipment.status} />
      </div>
      <p className="mb-4 flex flex-wrap items-baseline gap-x-2 text-[15px]">
        <span className="font-medium text-gray-500">지원 검사 유형</span>
        {supportedNames ? (
          <span className="text-gray-900">{supportedNames.join(", ")}</span>
        ) : (
          <span className="text-gray-400">미설정</span>
        )}
      </p>
      <table className="w-full border-collapse overflow-hidden rounded-lg border border-line text-[15px]">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-gray-700">요일</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-gray-700">운영 시간</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold text-gray-700">휴게 시간</th>
          </tr>
        </thead>
        <tbody>
          {WEEK_ORDER.map((weekday) => {
            const hours = byWeekday.get(weekday);
            return (
              <tr key={weekday} className="border-t border-line">
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-gray-900">
                  {WEEKDAYS[weekday]}
                </th>
                <td className={`px-4 py-2.5 ${hours ? "text-gray-900" : "text-gray-400"}`}>
                  {hours ? `${hours.open} ~ ${hours.close}` : "휴무"}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {hours?.breakTime ? `${hours.breakTime.start} ~ ${hours.breakTime.end}` : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-gray-500">
        {equipment.operatingHours.length === 0
          ? "운영 시간이 없어 슬롯을 만들 수 없습니다. [운영 시간 수정]에서 설정해 주세요."
          : "운영 시간을 바꿔도 이미 만든 슬롯·예약은 바뀌지 않고, 이후 슬롯 생성에 적용됩니다."}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onEditInfo}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-white px-4 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          <Pencil className="size-4" aria-hidden="true" />
          장비 정보 수정
        </button>
        <button
          type="button"
          onClick={onEditHours}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-primary bg-white px-4 text-[15px] font-semibold text-primary hover:bg-primary-soft"
        >
          <Clock className="size-4" aria-hidden="true" />
          운영 시간 수정
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-lg border border-line bg-white px-6 text-[15px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          닫기
        </button>
      </div>
    </>
  );
}
