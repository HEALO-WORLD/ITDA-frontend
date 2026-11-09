import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import StatusBadge from "@/components/ui/StatusBadge";
import ImpactWindowBadge from "@/features/incidents/components/ImpactWindowBadge";
import {
  getImpactWindowStatus,
  IMPACT_WINDOW_META,
  msUntilImpactWindowChange,
  parseKstLocalDateTime,
} from "@/features/incidents/impactWindow";

/**
 * 장비 장애 중단 기간 상태 (startAt ≤ 현재 < endAt). 백엔드 status(OCCURRED)·API는 그대로이고 화면에서만 계산한다.
 * startAt·endAt은 한국 시간 LocalDateTime 문자열이라 브라우저 시간대와 무관하게 해석해야 한다.
 */

const START = "2026-11-09T10:00:00";
const END = "2026-11-09T12:30:00";
/** 2026-11-09 10:00 KST = 01:00 UTC */
const START_MS = Date.UTC(2026, 10, 9, 1, 0, 0);
const END_MS = Date.UTC(2026, 10, 9, 3, 30, 0);
const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("parseKstLocalDateTime", () => {
  it("시간대 표기 없는 문자열을 한국 시간으로 해석한다 (초·소수 초 생략 허용, 소수 초는 밀리초까지)", () => {
    assert.equal(parseKstLocalDateTime(START), START_MS);
    assert.equal(parseKstLocalDateTime("2026-11-09T10:00"), START_MS);
    assert.equal(parseKstLocalDateTime("2026-11-09T10:00:00.5"), START_MS + 500);
    assert.equal(parseKstLocalDateTime("2026-11-09T10:00:00.123456789"), START_MS + 123);
  });

  it("브라우저(프로세스) 시간대가 달라도 같은 절대 시각이다", () => {
    for (const tz of ["UTC", "America/New_York", "Asia/Seoul", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      assert.equal(parseKstLocalDateTime(START), START_MS, tz);
      assert.equal(getImpactWindowStatus(START, END, START_MS), "ACTIVE", tz);
    }
  });

  it("형식이 다르거나 없는 날짜면 null (상태를 추측하지 않는다)", () => {
    for (const bad of ["", "2026-11-09", "2026-11-09 10:00:00", "2026-11-09T10:00:00Z", "2026-11-09T10:00:00+09:00", "2026-02-30T10:00:00", "2026-13-01T00:00:00", "2026-11-09T24:00:00", "garbage"]) {
      assert.equal(parseKstLocalDateTime(bad), null, bad);
    }
  });
});

describe("getImpactWindowStatus: 시작 포함·종료 미포함 경계", () => {
  it("시작 1ms 전은 중단 예정, 시작 시각 정각은 중단 중", () => {
    assert.equal(getImpactWindowStatus(START, END, START_MS - 1), "UPCOMING");
    assert.equal(getImpactWindowStatus(START, END, START_MS), "ACTIVE");
  });

  it("종료 1ms 전은 중단 중, 종료 시각 정각부터 중단 해제", () => {
    assert.equal(getImpactWindowStatus(START, END, END_MS - 1), "ACTIVE");
    assert.equal(getImpactWindowStatus(START, END, END_MS), "ENDED");
    assert.equal(getImpactWindowStatus(START, END, END_MS + 86_400_000), "ENDED");
  });

  it("초 생략 형식도 같은 경계로 판단한다", () => {
    assert.equal(getImpactWindowStatus("2026-11-09T10:00", "2026-11-09T12:30", START_MS - 1), "UPCOMING");
    assert.equal(getImpactWindowStatus("2026-11-09T10:00", "2026-11-09T12:30", START_MS), "ACTIVE");
    assert.equal(getImpactWindowStatus("2026-11-09T10:00", "2026-11-09T12:30", END_MS), "ENDED");
  });

  it("시각을 해석할 수 없으면 null", () => {
    assert.equal(getImpactWindowStatus("bad", END, START_MS), null);
    assert.equal(getImpactWindowStatus(START, "bad", START_MS), null);
  });
});

describe("msUntilImpactWindowChange: 열어 둔 화면의 다음 갱신 시점", () => {
  it("예정이면 시작까지, 중단 중이면 종료까지, 종료 뒤에는 더 바뀌지 않는다(null)", () => {
    assert.equal(msUntilImpactWindowChange(START, END, START_MS - 1_000), 1_000);
    assert.equal(msUntilImpactWindowChange(START, END, START_MS), END_MS - START_MS);
    assert.equal(msUntilImpactWindowChange(START, END, END_MS - 1), 1);
    assert.equal(msUntilImpactWindowChange(START, END, END_MS), null);
    assert.equal(msUntilImpactWindowChange("bad", END, START_MS), null);
  });
});

describe("ImpactWindowBadge 표시", () => {
  const render = (props: { startAt: string; endAt: string }) => renderToStaticMarkup(createElement(ImpactWindowBadge, props));
  const renderTone = (status: keyof typeof IMPACT_WINDOW_META) =>
    renderToStaticMarkup(StatusBadge({ tone: IMPACT_WINDOW_META[status].tone, children: IMPACT_WINDOW_META[status].label }));

  it("상태별 문구·색: 중단 예정(파랑)·중단 중(빨강)·중단 해제(회색)", () => {
    assert.deepEqual(IMPACT_WINDOW_META, {
      UPCOMING: { label: "중단 예정", tone: "info" },
      ACTIVE: { label: "중단 중", tone: "danger" },
      ENDED: { label: "중단 해제", tone: "muted" },
    });
    assert.match(renderTone("UPCOMING"), /bg-info-soft[^"]*"[\s\S]*중단 예정/);
    assert.match(renderTone("ACTIVE"), /bg-red-50[^"]*"[\s\S]*중단 중/);
    assert.match(renderTone("ENDED"), /bg-gray-100 text-gray-500[^"]*"[\s\S]*중단 해제/);
  });

  it("'중단 해제'를 복구 완료로 보이지 않는다", () => {
    for (const { label } of Object.values(IMPACT_WINDOW_META)) assert.doesNotMatch(label, /복구|정상|영향/);
  });

  it("서버 렌더링(프리렌더 포함)에서는 현재 시각을 읽지 않고 항상 '확인 중'이다 (hydration 일치)", () => {
    const realNow = Date.now;
    Date.now = () => {
      throw new Error("서버 렌더링 중 Date.now() 호출");
    };
    try {
      for (const props of [{ startAt: START, endAt: END }, { startAt: "2000-01-01T00:00:00", endAt: "2000-01-02T00:00:00" }, { startAt: "bad", endAt: END }]) {
        const html = render(props);
        assert.match(html, /확인 중/);
        assert.doesNotMatch(html, /중단 예정|중단 중|중단 해제/);
      }
    } finally {
      Date.now = realNow;
    }
  });
});

describe("화면 연결 (검사기관 목록·상세, 관리자 목록·상세)", () => {
  const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
  const files = {
    examiningList: "features/incidents/components/IncidentApiSection.tsx",
    examiningDetail: "features/incidents/components/IncidentApiDetailModal.tsx",
    adminList: "features/admin/components/AdminIncidentsSection.tsx",
    adminDetail: "features/admin/components/AdminIncidentDetailModal.tsx",
  };

  it("네 화면 모두 공통 배지를 쓰고, OCCURRED를 '장애 발생'으로 보이던 배지를 두지 않는다", () => {
    for (const [name, path] of Object.entries(files)) {
      const source = read(path);
      assert.match(source, /<ImpactWindowBadge startAt=\{incident!?\.startAt\} endAt=\{incident!?\.endAt\}/, name);
      assert.doesNotMatch(source, /"장애 발생"/, name);
    }
  });

  it("목록·상세는 서버에서 현재 시각을 넘기지 않고, 라벨은 '중단 기간'·'상태'다", () => {
    for (const [name, path] of Object.entries(files)) {
      const source = read(path);
      assert.doesNotMatch(source, /serverNowMs|nowMs|getRequestTimeMs|Date\.now\(/, name);
      assert.doesNotMatch(source, /영향 구간|영향 예정|영향 기간 종료/, name);
    }
    for (const path of [files.examiningList, files.adminList]) {
      const source = read(path);
      assert.match(source, />중단 기간<\/th>/, path);
      assert.match(source, />상태<\/th>/, path);
      assert.doesNotMatch(source, />장애 상태<\/th>/, path);
    }
    assert.match(read(files.examiningDetail), /<Info label="상태">/);
    assert.match(read(files.examiningDetail), /<Info label="중단 기간 \(시작~종료\)">/);
    assert.match(read(files.adminDetail), /<Info label="중단 기간 \(시작~종료\)">/);
    assert.doesNotMatch(read("features/incidents/impactWindow.ts"), /getRequestTimeMs/);
  });

  it("검사기관 목록의 상태 열은 배지가 상세 버튼과 겹치지 않을 폭이고 줄바꿈하지 않는다", () => {
    const source = read(files.examiningList);
    assert.match(source, /<col className="w-\[128px\]" \/>\s*<col className="w-\[88px\]" \/>\s*<\/colgroup>/);
    assert.match(source, /whitespace-nowrap text-center`\}>\s*<ImpactWindowBadge/);
  });

  it("자동 후속 처리 상태 문구는 그대로다", () => {
    const labels = read("features/incidents/processingLabels.ts");
    for (const label of ["후속 처리 대기", "자동 처리 중", "자동 처리 완료", "자동 처리 실패"]) assert.ok(labels.includes(label), label);
  });
});
