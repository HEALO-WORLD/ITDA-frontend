import { AlertTriangle } from "lucide-react";

import StatusBadge from "@/components/ui/StatusBadge";

/**
 * 검사 진행 중 장비 장애로 자동 재조정에서 제외된 영향 의뢰의 "수동 확인 필요" 표시 (검사기관·관리자 장애 상세 공용).
 *
 * - 표시 여부는 백엔드 응답의 manualReviewRequired만 따른다 (화면에서 조건을 다시 계산하지 않는다)
 * - 수동 확인 완료 처리는 없다. 검사가 완료되면 백엔드가 false를 돌려주므로 다시 조회할 때 사라진다
 * - "자동 처리 완료" 배지는 자동 장애 처리 작업이 끝났다는 뜻이라, 두 배지가 함께 보일 수 있다
 */

/** 처리 상태 배지 옆에 붙는 배지 */
export function ManualReviewBadge() {
  return <StatusBadge tone="warning">수동 확인 필요</StatusBadge>;
}

/** 영향 의뢰 카드 아래에 붙는 안내 */
export function ManualReviewNotice() {
  return (
    <div role="note" className="mt-2.5 flex gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0 break-keep">
        <p className="font-semibold">장비 장애 발생 당시 검사가 진행 중이어서 자동 재조정 대상에서 제외되었습니다.</p>
        <p className="mt-0.5">담당자가 실제 촬영 상태와 후속 조치 필요 여부를 확인해 주세요.</p>
        <p className="mt-1 text-xs text-amber-800">
          ‘자동 처리 완료’는 자동 장애 처리 작업이 끝났다는 뜻이며, 검사 완료나 담당자의 확인 완료를 뜻하지 않습니다.
        </p>
      </div>
    </div>
  );
}
