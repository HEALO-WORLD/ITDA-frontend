/**
 * 예약 변경 비교 카드 (기존 예약 | 변경할 예약). API 재조정 확인(ApiRescheduleConfirm)과 Mock 재조정 확인이 같이 쓴다.
 * 표시 전용: 요청·상태 판단을 하지 않는다
 */
/** 예약 카드: 검사 일시를 가장 크게, 검사기관·세부 검사 항목, 검사 장비는 보조 정보. 기존과 같은 값은 '기존과 같음'으로 표시 */
export default function ReservationCard({
  label,
  tone,
  dateTime,
  institution,
  examItem,
  equipment,
  sameInstitution = false,
  sameExamItem = false,
  changes,
}: {
  label: string;
  tone: "neutral" | "highlight";
  dateTime: string;
  institution: string | null;
  examItem: string | null;
  equipment: string | null;
  sameInstitution?: boolean;
  sameExamItem?: boolean;
  /** PC 재조정 모달의 변경 예약 카드: 기존과 달라지는 항목 */
  changes?: { dateTime: boolean; institution: boolean; equipment: boolean };
}) {
  const sameTag = <span className="ml-1.5 rounded bg-white/80 px-1.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-line">기존과 같음</span>;
  const changedTag = <span className="ml-1.5 rounded bg-brand-mint px-1.5 py-0.5 text-xs font-bold text-brand-navy">변경</span>;
  return (
    <section
      aria-label={label}
      className={`flex flex-col gap-3 rounded-xl border px-4 py-4 sm:px-5 ${tone === "highlight" ? "border-primary/30 bg-primary-soft" : "border-line bg-gray-50"}`}
    >
      <h3 className={`text-sm font-bold ${tone === "highlight" ? "text-primary" : "text-gray-600"}`}>{label}</h3>
      <p className="text-lg font-bold tabular-nums text-gray-900">
        {dateTime}
        {changes?.dateTime && changedTag}
      </p>
      <dl className="flex flex-col gap-1.5 text-[15px]">
        <div className="flex gap-3">
          <dt className="w-[100px] shrink-0 whitespace-nowrap text-gray-500">검사기관</dt>
          <dd className="min-w-0 text-gray-900">
            {institution ?? "확인 불가"}
            {sameInstitution && sameTag}
            {changes?.institution && changedTag}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[100px] shrink-0 whitespace-nowrap text-gray-500">세부 검사 항목</dt>
          <dd className="min-w-0 text-gray-900">
            {examItem ?? "확인 불가"}
            {sameExamItem && sameTag}
          </dd>
        </div>
        <div className="flex gap-3 text-sm">
          <dt className="w-[100px] shrink-0 whitespace-nowrap text-gray-400">검사 장비</dt>
          <dd className="min-w-0 text-gray-500">
            {equipment ?? "—"}
            {changes?.equipment && changedTag}
          </dd>
        </div>
      </dl>
    </section>
  );
}
