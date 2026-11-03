import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  /** 제목 아래 보조 문구 */
  description?: ReactNode;
  /** 제목 오른쪽에 붙는 요소 (예: 상태 배지) */
  titleAddon?: ReactNode;
  /** 최대 너비. md = 560px(기본), lg = 680px */
  size?: "md" | "lg";
  onClose: () => void;
  /** 바깥(배경) 클릭으로 닫기. 입력 중인 폼은 false 권장 */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

const WIDTH_CLASS = {
  md: "w-[min(560px,calc(100%-32px))]",
  lg: "w-[min(680px,calc(100%-32px))]",
} as const;

/**
 * 공통 모달. 네이티브 <dialog>의 showModal()을 사용한다.
 * - 열려 있는 동안 배경은 비활성(inert)이라 포커스가 모달 안에 머문다
 * - Esc로 닫히고, 닫히면 연 요소로 포커스가 돌아간다
 * - onClose는 사용자가 닫을 때(Esc·닫기 버튼·바깥 클릭)만 부른다.
 *   open이 false가 되어 프로그램으로 닫을 때 뒤늦게 오는 close 이벤트는 무시한다
 *   (부르면 그사이 열린 다른 모달까지 닫힌다. 예: 상세 → 결과 등록 전환)
 * - 처음 포커스는 data-autofocus가 있는 요소, 없으면 첫 포커스 가능 요소
 *   (React의 autoFocus는 모달이 열리기 전에 실행되어 동작하지 않으므로 data-autofocus를 쓴다)
 * - 제목 영역은 고정하고, 내용이 길면 본문만 스크롤한다
 * 내용은 열려 있을 때만 렌더링하므로 다시 열면 내부 상태가 초기화된다.
 */
export default function Modal({
  open,
  title,
  description,
  titleAddon,
  size = "md",
  onClose,
  closeOnBackdrop = true,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => {
        // 이 시점의 open은 최신 값이다. Esc로 닫혔으면 아직 true, 부모가 닫았으면 이미 false
        if (open) onClose();
      }}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-32px)] rounded-xl bg-white p-0 shadow-xl backdrop:bg-gray-900/40 ${WIDTH_CLASS[size]}`}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-32px)] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-5 pt-6 sm:px-7">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 id={titleId} className="text-xl font-bold text-gray-900">
                  {title}
                </h2>
                {titleAddon}
              </div>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-gray-500">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 pb-6 sm:px-7">{children}</div>
        </div>
      )}
    </dialog>
  );
}
