import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it, mock } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 장비 장애 후속 처리 표시 문구 (검사기관·관리자 장애 상세). 표시 계층만 확인한다: 백엔드 값·조회·필터·페이지 로직은 그대로다.
 * - processingStatus 4종: 자동 후속 처리 작업 상태 (SUCCEEDED ≠ 예약 재조정 완료)
 * - resultCode 6종 한글 문구, 모르는 값은 원래 코드 그대로
 */

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

let labels: typeof import("@/features/incidents/processingLabels");
let ExaminingItem: typeof import("@/features/incidents/components/IncidentApiDetailModal").AffectedItem;
let AdminItem: typeof import("@/features/admin/components/AdminIncidentDetailModal").AffectedItem;

before(async () => {
  mock.module("next/navigation", {
    namedExports: {
      unstable_rethrow: () => {},
      useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
      useSearchParams: () => new URLSearchParams(),
      usePathname: () => "/",
    },
  });
  labels = await import("@/features/incidents/processingLabels");
  ExaminingItem = (await import("@/features/incidents/components/IncidentApiDetailModal")).AffectedItem;
  AdminItem = (await import("@/features/admin/components/AdminIncidentDetailModal")).AffectedItem;
});

type Item = Parameters<typeof ExaminingItem>[0]["item"];
const item = (overrides: Partial<Item> = {}): Item => ({
  id: id(1),
  incidentId: id(2),
  referralId: id(3),
  reservationId: id(4),
  processingStatus: "SUCCEEDED",
  retryCount: 0,
  nextRetryAt: null,
  lockedUntil: null,
  resultCode: "RESCHEDULE_REQUIRED",
  processedAt: "2026-11-09T14:05:12",
  manualReviewRequired: false,
  ...overrides,
});
const renderExamining = (overrides: Partial<Item> = {}) => renderToStaticMarkup(createElement("ul", null, createElement(ExaminingItem, { item: item(overrides) })));
const renderAdmin = (overrides: Partial<Item> = {}) =>
  renderToStaticMarkup(createElement("ul", null, createElement(AdminItem, { item: { ...item(overrides), lastError: null } })));

describe("processingStatus 4종 문구", () => {
  it("대기·처리 중·완료·실패가 '자동 처리' 문구로 보인다", () => {
    assert.deepEqual(labels.PROCESSING_STATUS_LABELS, {
      PENDING: "후속 처리 대기",
      PROCESSING: "자동 처리 중",
      SUCCEEDED: "자동 처리 완료",
      FAILED: "자동 처리 실패",
    });
    for (const [status, label] of Object.entries(labels.PROCESSING_STATUS_LABELS)) {
      for (const html of [renderExamining({ processingStatus: status as Item["processingStatus"] }), renderAdmin({ processingStatus: status as Item["processingStatus"] })]) {
        assert.ok(html.includes(`>${label}</span>`), `${status} → ${label}`);
      }
    }
  });

  it("SUCCEEDED를 예약 재조정 완료·'처리 완료' 단독 문구로 보이지 않는다", () => {
    for (const html of [renderExamining(), renderAdmin()]) {
      assert.ok(html.includes("자동 처리 완료"));
      assert.doesNotMatch(html, /재조정 완료|예약 복구/);
      assert.doesNotMatch(html, />처리 완료</, "앞에 '자동'이 없는 '처리 완료' 문구 없음");
    }
    assert.match(labels.AUTO_PROCESSING_NOTE, /예약 재조정 완료를 뜻하지 않습니다/);
  });

  it("후속 처리 현황 집계·상태 필터·배지가 같은 문구를 쓰고, 집계 아래에 안내를 붙인다 (두 화면)", () => {
    for (const file of ["../../src/features/incidents/components/IncidentApiDetailModal.tsx", "../../src/features/admin/components/AdminIncidentDetailModal.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.match(source, /PROCESSING_STATUS_LABELS as PROCESSING_LABELS/, file);
      assert.doesNotMatch(source, /const PROCESSING_LABELS/, `${file}: 화면별 문구를 따로 두지 않는다`);
      for (const status of ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]) assert.ok(source.includes(`label={PROCESSING_LABELS.${status}}`), `${file} 집계 ${status}`);
      assert.match(source, /\{value \? PROCESSING_LABELS\[value\] : "전체"\}/, `${file} 필터`);
      assert.match(source, /\{AUTO_PROCESSING_NOTE\}/, `${file} 안내`);
    }
  });
});

describe("resultCode 한글 문구", () => {
  const expected: Record<string, string> = {
    RESCHEDULE_REQUIRED: "재조정 필요 상태로 변경",
    ALREADY_BLOCKED: "이미 차단된 예약",
    SKIPPED_IN_PROGRESS: "검사 진행 중으로 자동 처리 제외",
    SKIPPED_COMPLETED: "검사 완료로 처리 대상 제외",
    SKIPPED_CANCELED: "취소된 예약으로 처리 대상 제외",
    SKIPPED_NOT_CURRENT: "현재 예약이 아니어서 제외",
  };

  it("6종을 한글 문구로 보이고 원래 코드는 title에 남긴다 (두 화면)", () => {
    for (const [code, label] of Object.entries(expected)) {
      assert.equal(labels.getResultCodeLabel(code), label);
      for (const html of [renderExamining({ resultCode: code }), renderAdmin({ resultCode: code })]) {
        assert.ok(html.includes(`<span title="${code}">${label}</span>`), code);
      }
    }
  });

  it("모르는 코드는 문구를 만들지 않고 원래 값을 그대로 보인다 (객체 기본 속성 이름도 안전)", () => {
    for (const code of ["NEW_UNKNOWN_CODE", "toString", "__proto__", "constructor"]) {
      assert.equal(labels.getResultCodeLabel(code), null, code);
    }
    const html = renderExamining({ resultCode: "NEW_UNKNOWN_CODE" });
    assert.match(html, /<code class="font-mono text-xs">NEW_UNKNOWN_CODE<\/code>/);
    assert.match(renderAdmin({ resultCode: "toString" }), /<code class="font-mono text-xs">toString<\/code>/);
  });

  it("null이면 기존처럼 '없음'", () => {
    for (const html of [renderExamining({ resultCode: null }), renderAdmin({ resultCode: null })]) {
      assert.match(html, /처리 결과<\/dt><dd[^>]*>없음<\/dd>/);
    }
  });
});

describe("수동 확인 필요 표시 유지", () => {
  it("manualReviewRequired=true면 '자동 처리 완료'와 '수동 확인 필요' 배지·이유 안내가 함께 보이고, 완료 버튼은 없다", () => {
    const html = renderExamining({ manualReviewRequired: true, resultCode: "SKIPPED_IN_PROGRESS" });
    assert.ok(html.includes("자동 처리 완료"));
    assert.ok(html.includes("수동 확인 필요"));
    assert.ok(html.includes("검사 진행 중으로 자동 처리 제외"));
    assert.ok(html.includes("담당자가 실제 촬영 상태와 후속 조치 필요 여부를 확인해 주세요."));
    assert.ok(html.includes("‘자동 처리 완료’는 자동 장애 처리 작업이 끝났다는 뜻이며"));
    // 수동 확인 완료 API가 없어 완료 버튼을 두지 않는다 (카드의 버튼은 ID 복사 버튼뿐)
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    assert.ok(buttons.length > 0 && buttons.every((button) => /aria-label="[^"]*전체 복사"/.test(button)), buttons.join("\n"));
  });
});
