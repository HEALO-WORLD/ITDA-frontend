import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 제목 오른쪽 주요 버튼 */
  actions?: ReactNode;
}

/** 본문 상단 화면 제목/설명 (모든 역할 화면 공통) */
export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] text-gray-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
