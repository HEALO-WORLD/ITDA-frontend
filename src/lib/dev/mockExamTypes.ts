import type { ExamType } from "@/features/slots/types";

/**
 * ⚠️ 개발용 Mock 검사 유형 (장비별 지원 검사 유형 선택 후보).
 *
 * 실제 검사 유형은 `GET /api/v1/exam-types`(id·name·modality)에서 온다. 백엔드 시드에 검사 유형이 없어
 * Mock 모드에서 쓸 후보만 여기 둔다. ID는 다른 Mock 데이터처럼 `mock-` 접두어를 쓰며 실제 ID가 아니다.
 */
export interface MockExamType {
  id: string;
  name: string;
  modality: ExamType;
}

export const MOCK_EXAM_TYPES: readonly MockExamType[] = [
  { id: "mock-exam-type-ct-chest", name: "흉부 CT", modality: "CT" },
  { id: "mock-exam-type-ct-abdomen", name: "복부 CT", modality: "CT" },
  { id: "mock-exam-type-ct-brain", name: "뇌 CT", modality: "CT" },
  { id: "mock-exam-type-mri-brain", name: "뇌 MRI", modality: "MRI" },
  { id: "mock-exam-type-mri-spine", name: "척추 MRI", modality: "MRI" },
  { id: "mock-exam-type-mri-knee", name: "무릎 MRI", modality: "MRI" },
];
