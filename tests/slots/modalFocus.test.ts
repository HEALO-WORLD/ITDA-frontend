import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import DatePicker from "@/components/ui/DatePicker";
import Modal from "@/components/ui/Modal";

/**
 * 공용 모달 포커스·날짜 선택기 Esc (STEP 4A.2).
 * DOM 테스트 도구가 없어 클릭·키 입력은 브라우저에서 확인했고, 여기서는 동작을 정하는 코드 연결을 확인한다.
 */
const modalSource = readFileSync(new URL("../../src/components/ui/Modal.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pickerSource = readFileSync(new URL("../../src/components/ui/DatePicker.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("날짜 선택기 Esc", () => {
  it("열려 있을 때만 Esc를 처리하고, 부모 <dialog>가 닫히지 않게 preventDefault·stopPropagation을 함께 쓴다", () => {
    const start = pickerSource.indexOf("onKeyDown={\n        isOpen");
    const handler = pickerSource.slice(start, pickerSource.indexOf(": undefined", start));
    assert.ok(start > 0, "컨테이너 onKeyDown은 isOpen일 때만 연결한다");
    assert.match(handler, /event\.key !== "Escape"\) return;/);
    assert.match(handler, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*close\(\);/);
  });

  it("팝업 안에는 따로 Esc 처리를 두지 않는다 (컨테이너 한 곳에서만 처리)", () => {
    assert.equal(pickerSource.match(/"Escape"/g)?.length, 1);
  });

  it("닫힌 상태의 마크업은 그대로다 (트리거 버튼만, 팝업 없음)", () => {
    const html = renderToStaticMarkup(createElement(DatePicker, { id: "d", label: "시작일", value: "", onChange: () => {} }));
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /role="dialog"/);
  });
});

describe("공용 Modal 닫기 포커스", () => {
  it("언마운트 전에(useLayoutEffect 정리) 열린 dialog만 네이티브 close()로 닫는다", () => {
    assert.match(modalSource, /useLayoutEffect\(\(\) => \{\s*const dialog = dialogRef\.current;\s*return \(\) => \{\s*if \(dialog\?\.open\) dialog\.close\(\);/);
  });

  it("늦게 오는 close 이벤트(제거된 dialog·다시 열린 dialog)로는 onClose를 부르지 않는다", () => {
    assert.match(modalSource, /if \(open && dialog\.isConnected && !dialog\.open\) onClose\(\);/);
  });

  it("open=false 방식의 기존 닫기(useEffect의 dialog.close())와 마크업은 그대로다", () => {
    assert.match(modalSource, /if \(!open && dialog\.open\) dialog\.close\(\);/);
    const props: Parameters<typeof Modal>[0] = { open: true, title: "제목", onClose: () => {}, children: "본문" };
    const html = renderToStaticMarkup(createElement(Modal, props));
    assert.match(html, /<dialog aria-labelledby="[^"]+"/);
    assert.match(html, /aria-label="닫기"/);
  });
});
