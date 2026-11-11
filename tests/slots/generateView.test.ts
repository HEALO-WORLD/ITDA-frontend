import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createSubmitLock } from "@/features/slots/submitLock";

/**
 * 슬롯 생성 화면: 연속 클릭 방지, API 대화상자 첫 화면(서버 기능에 없는 입력이 없는지), Mock 화면이 실제 생성을 부르지 않는지.
 * 클릭·키보드 흐름은 브라우저에서 확인한다 (이 저장소에는 DOM 테스트 도구가 없다).
 */

process.env.NEXT_PUBLIC_API_MODE = "api";
process.env.NEXT_PUBLIC_API_FEATURES = "slots,equipment";

const { default: ApiSlotGenerationDialog } = await import("@/features/equipment/components/ApiSlotGenerationDialog");
const { default: Modal } = await import("@/components/ui/Modal");

const EQUIPMENTS = [
  { id: "30000000-0000-0000-0000-000000000001", institutionId: "20000000-0000-0000-0000-000000000003", name: "CT-1", modality: "CT", status: "OPERATIONAL" },
] as const;

describe("연속 클릭 방지 (createSubmitLock)", () => {
  it("요청이 끝나기 전 두 번째 클릭은 실행하지 않는다", async () => {
    const lock = createSubmitLock();
    let calls = 0;
    let release!: () => void;
    const task = () =>
      new Promise<string>((resolve) => {
        calls++;
        release = () => resolve("done");
      });
    const first = lock.run(task);
    const second = lock.run(task);
    assert.equal(lock.running, true);
    assert.equal(await second, null);
    release();
    assert.equal(await first, "done");
    assert.equal(calls, 1);
    assert.equal(lock.running, false);
  });

  it("실패해도 잠금을 풀어 다시 시도할 수 있다", async () => {
    const lock = createSubmitLock();
    await assert.rejects(lock.run(async () => { throw new Error("x"); }));
    assert.equal(lock.running, false);
    assert.equal(await lock.run(async () => 1), 1);
  });
});

describe("ApiSlotGenerationDialog 첫 화면", () => {
  const html = renderToStaticMarkup(createElement(ApiSlotGenerationDialog, { equipments: [...EQUIPMENTS], initialId: null, onClose: () => {} }));

  it("왼쪽 장비·검사 정보 → 오른쪽 생성 기간(시작·종료) 순서, 장비 미선택이면 검사 유형·생성 버튼 비활성", () => {
    const order = ["장비·검사 정보", "대상 장비", "검사 유형", "장비 상태", "운영시간", "생성 기간", "생성 시작일", "생성 종료일", "선택 기간", "생성 대상 운영일", "휴무 제외", "생성 전 확인"];
    const positions = order.map((label) => html.indexOf(label));
    assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), JSON.stringify(positions));
    assert.match(html, /최대 14일/);
    assert.match(html, /장비를 먼저 선택해 주세요/);
    assert.match(html, /<button type="button" disabled="" aria-busy="false"[^>]*>슬롯 생성<\/button>/);
  });

  // 디자인 정책: 가로로 긴 입력 모달은 form2(980px)로 통일한다 (장비 등록·슬롯 생성)
  it("장비 등록 모달과 같은 너비(form2 980px)·2단 그리드·하단 고정 버튼", () => {
    assert.match(html, /w-\[min\(980px,calc\(100%-24px\)\)\]/);
    assert.match(html, /min-\[860px\]:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\]/);
    // 하단 버튼 줄은 스크롤 본문 밖(footer)에 있다
    assert.ok(html.lastIndexOf("슬롯 생성</button>") > html.indexOf("생성 전 확인"));
    // 장비 등록 모달(EquipmentApiWorkspace의 CreateEquipmentDialog)도 같은 form2: 같은 Modal 요소에 크기와 제목이 함께 있어야 한다
    // (CreateEquipmentDialog는 내보내지 않고 단계 상태로 열려 서버 렌더링으로 열 수 없어 JSX를 확인한다)
    const workspace = readFileSync(new URL("../../src/features/equipment/components/EquipmentApiWorkspace.tsx", import.meta.url), "utf8");
    assert.match(workspace, /<Modal\b[^>]*\bsize="form2"[^>]*\btitle="장비 등록"/);
    assert.doesNotMatch(workspace, /<Modal\b[^>]*\bsize="(?!form2")[^"]+"[^>]*\btitle="장비 등록"/);
  });

  it("form2는 작은 화면에서 화면 너비에 맞춘다 (가로 넘침 없음: 좌우 12px 여백, 높이는 화면 안, 본문만 세로 스크롤)", () => {
    const props: Parameters<typeof Modal>[0] = { open: true, size: "form2", title: "장비 등록", onClose: () => {}, children: "본문" };
    const modal = renderToStaticMarkup(createElement(Modal, props));
    // 너비 = min(980px, 화면 너비 - 24px): 980px보다 좁은 화면에서는 화면 너비를 따른다
    assert.match(modal, /w-\[min\(980px,calc\(100%-24px\)\)\]/);
    assert.doesNotMatch(modal, /min-w-\[/);
    assert.match(modal, /max-h-\[calc\(100dvh-32px\)\]/);
    assert.match(modal, /overflow-y-auto/);
  });

  // 장비 등록 모달 레이아웃 (백업 커밋 4b4d054의 2단 디자인): CreateEquipmentDialog는 내보내지 않고 단계 상태로 열려 JSX를 확인한다
  it("장비 등록 모달: 860px 이상 2단(기본 정보 5 : 지원 검사 유형 7), 좁으면 1단, 버튼 줄은 footer에 고정하고 form 속성으로 제출", () => {
    const workspace = readFileSync(new URL("../../src/features/equipment/components/EquipmentApiWorkspace.tsx", import.meta.url), "utf8");
    const start = workspace.indexOf("function CreateEquipmentDialog(");
    assert.ok(start > 0);
    const dialog = workspace.slice(start, workspace.indexOf("\nfunction ", start + 1));
    // 2단 그리드: 기본은 1단(grid-cols-1), 860px 이상에서 5:7
    assert.match(dialog, /className="grid grid-cols-1 [^"]*min-\[860px\]:grid-cols-\[minmax\(0,5fr\)_minmax\(0,7fr\)\]"/);
    // 왼쪽 열: 장비명·검사 유형·기본 소요 시간 → 오른쪽 열: 지원 검사 유형 선택
    const order = ['id="api-equipment-name"', 'id="api-equipment-type"', 'id="api-equipment-minutes"', "<SupportedExamTypesPicker"].map((key) => dialog.indexOf(key));
    assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])), JSON.stringify(order));
    // 하단 버튼(이전·취소/닫기·다음/장비 등록)은 Modal footer에 있고, 폼 밖이라 form 속성으로 같은 폼을 제출한다 (Enter 제출·검증 흐름 유지)
    const footer = dialog.slice(dialog.indexOf("footer={"), dialog.indexOf("<form "));
    for (const label of ["이전", "취소", "다음", "장비 등록"]) assert.ok(footer.includes(label), label);
    assert.equal((footer.match(/type="submit" form=\{formId\}/g) ?? []).length, 2);
    assert.match(dialog, /<form id=\{formId\} onSubmit=\{submit\} noValidate/);
    assert.equal(dialog.slice(dialog.indexOf("<form ")).includes('type="submit"'), false, "폼 본문 안에 제출 버튼을 두지 않는다");
  });

  it("Modal footer는 스크롤 본문 밖에 그린다 (본문만 세로 스크롤)", () => {
    const props: Parameters<typeof Modal>[0] = { open: true, size: "form2", title: "장비 등록", onClose: () => {}, footer: "하단 버튼", children: "본문" };
    const modal = renderToStaticMarkup(createElement(Modal, props));
    const body = modal.indexOf("overflow-y-auto");
    const footer = modal.indexOf("하단 버튼");
    assert.ok(body > 0 && footer > modal.indexOf("본문", body), "footer는 본문 다음");
    // 본문 div가 닫힌 뒤 footer가 나온다 (본문 스크롤 영역 안에 있지 않다)
    assert.match(modal.slice(body), /본문<\/div><div class="[^"]*shrink-0[^"]*">하단 버튼/);
  });

  it("서버에 없는 기능(사용자 지정 시간·휴게 시간·생성 예정 슬롯 수)을 입력·표시하지 않는다", () => {
    for (const absent of ["장비 운영 시간 전체에 생성", "휴게 시작", "생성 예정", "겹쳐서 제외"]) {
      assert.equal(html.includes(absent), false, absent);
    }
    assert.match(html, /슬롯 개수는 서버가 그날 운영시간을 소요 시간 단위로 나눠 정합니다/);
  });
});

describe("Mock 화면 회귀", () => {
  it("Mock 슬롯 생성 폼은 그대로 Mock 저장소만 쓰고 실제 생성 Server Function을 부르지 않는다", () => {
    const source = readFileSync(new URL("../../src/features/equipment/components/SlotGenerationForm.tsx", import.meta.url), "utf8");
    assert.equal(source.includes("generateSlotsAction"), false);
    assert.equal(source.includes("slots/generateActions"), false);
  });

  it("장비 페이지: API 모드(equipment)가 아니면 Mock 워크스페이스를 쓰고, API 생성 대화상자는 API 워크스페이스에서만 연다", () => {
    const page = readFileSync(new URL("../../src/app/examining/equipment/page.tsx", import.meta.url), "utf8");
    assert.match(page, /isApiFeature\("equipment"\)[\s\S]*EquipmentApiSection[\s\S]*EquipmentSlotWorkspace/);
    const mockWorkspace = readFileSync(new URL("../../src/features/equipment/components/EquipmentSlotWorkspace.tsx", import.meta.url), "utf8");
    assert.equal(mockWorkspace.includes("ApiSlotGenerationDialog"), false);
  });
});

describe("슬롯 생성 화면: 로그인 세션 정합성 (STEP 3-2-2B-5)", () => {
  it("렌더링 시점 로그인 세션을 기간 생성 Action에 보내고, SESSION_CHANGED면 안내를 남기고 생성 버튼을 잠근다 (입력값 유지·재조회 없음)", () => {
    const source = readFileSync(new URL("../../src/features/equipment/components/ApiSlotGenerationDialog.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.match(source, /const renderedLoginSession = useRenderedLoginSession\(\);/);
    assert.match(source, /generateSlotRangeAction\(\{ equipmentId, examTypeId, startDate, endDate \}, renderedLoginSession\)/);
    assert.match(source, /if \(next\.reason === "SESSION_CHANGED"\) \{\s*setSessionChangedMessage\(next\.message\);\s*return;\s*\}/, "목록·장비 정보를 다시 불러오지 않는다");
    assert.match(source, /&& !sessionChangedMessage;/, "생성 버튼 잠금 (canSubmit)");
    assert.match(source, /if \(lock\.running \|\| !canSubmit \|\| sessionChangedMessage\) return;/);
    assert.match(source, /\{\(sessionChangedMessage \?\? error\) && \(/);
    // 장비를 바꿔도 안내·잠금은 남는다 (changeEquipment는 error만 지운다)
    const change = source.slice(source.indexOf("const changeEquipment"), source.indexOf("const submit"));
    assert.equal(change.includes("setSessionChangedMessage"), false);
    assert.doesNotMatch(source, /\/auth\/session/);
  });
});
