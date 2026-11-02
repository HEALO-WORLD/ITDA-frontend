import { getMockOnlyError } from "@/lib/api/config";

import { getNextProgressStatus, getProgressChangeBlockReason, type NextProgressStatus } from "./rules";
import type { Examination } from "./types";

/**
 * 검사 진행 상태 변경 (클라이언트에서 호출, ⚠️ Mock: 서버에 저장하지 않는다).
 * 호출한 화면이 자기 상태에만 반영하며 새로고침하면 초기 Mock으로 돌아간다.
 *
 * API 연결 상태: 미연결 (Mock 유지).
 * 실제 상태 변경 함수(remote.ts changeExaminationStatus)는 검사 ID가 필요한데, 화면 데이터에는 의뢰 ID만 있고
 * 검사 ID를 얻을 공개 조회 API가 아직 없다. 조회 API가 준비되면 이 함수에서 실제 API를 호출하도록 바꾼다.
 */

/** Mock 처리 지연(ms). 처리 중 상태·중복 클릭 방지를 확인하기 위한 값 */
const MOCK_DELAY_MS = 500;

export type ChangeProgressOutcome = { ok: true; progressStatus: NextProgressStatus } | { ok: false; message: string };

/** 대기 → 진행 중 → 완료 순서로 한 단계만 바꾼다 (서버 규칙과 같게 건너뛰기·되돌리기는 막는다) */
export async function changeExaminationProgress(
  examination: Examination,
  next: NextProgressStatus,
): Promise<ChangeProgressOutcome> {
  const mockOnlyError = getMockOnlyError("examinations.changeStatus");
  if (mockOnlyError) return { ok: false, message: mockOnlyError.message };
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  if (getNextProgressStatus(examination) !== next) {
    return { ok: false, message: "현재 검사 상태에서는 이 단계로 변경할 수 없습니다." };
  }
  const blockReason = getProgressChangeBlockReason(examination, next);
  if (blockReason) return { ok: false, message: blockReason };
  return { ok: true, progressStatus: next };
}
