import { Construction } from "lucide-react";

/**
 * API 모드에서 아직 실제 API에 연결되지 않은 기능의 안내 (Mock 데이터로 채우지 않는다).
 * 실제 API 요청 실패(서버 오류·권한 등)와 구분되는 상태다: 요청을 보내지 않았고 오류 색(빨강)을 쓰지 않는다.
 */
export default function FeatureNotReady({ detail }: { detail?: string }) {
  return (
    <section
      role="status"
      aria-label="준비 중인 기능"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center"
    >
      <Construction className="size-7 text-gray-400" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-gray-800">현재 해당 기능은 준비 중입니다.</p>
      {detail && <p className="text-sm text-gray-500">{detail}</p>}
    </section>
  );
}
