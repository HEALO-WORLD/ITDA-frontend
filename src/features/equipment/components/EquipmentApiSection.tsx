import { AdminFailureNotice } from "@/features/admin/components/AdminNotices";
import NotificationPagination from "@/features/notifications/components/NotificationPagination";

import { loadEquipmentPage } from "../server";

import EquipmentApiWorkspace from "./EquipmentApiWorkspace";

interface EquipmentApiSectionProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 장비·슬롯 운영 (검사기관, API 모드). cookies()·searchParams를 읽으므로 페이지의 Suspense 안에서 렌더링한다.
 * - 우리 기관 장비를 한 번에 최대 100대 받는다 (기관 ID는 서버가 users/me로 정한다). 장비명 검색·CT/MRI 탭은 받은 목록 안에서 한다
 *   (백엔드 목록 API에 장비명 검색 조건이 없다). 100대를 넘으면 `?page=`로 다음 100대를 본다
 * - 화면 구성은 배포 와이어프레임(Mock 화면)과 같다: EquipmentApiWorkspace
 * 페이지 요청: users/me 1 + 장비 목록 1 (+ 100대 초과 시 종류별 건수 2) + 지원 검사 유형 표시(목록 1 + 앞쪽 최대 10대 각 1, 브라우저에서 따로)
 */
export default async function EquipmentApiSection({ searchParams }: EquipmentApiSectionProps) {
  const page = parsePage((await searchParams).page);
  if (page === null) {
    return <AdminFailureNotice failure={{ ok: false, reason: "ERROR", message: "페이지 번호가 올바르지 않습니다. 목록 첫 페이지로 이동해 주세요.", code: null }} />;
  }
  const list = await loadEquipmentPage({ page });
  if (!list.ok) return <AdminFailureNotice failure={list} />;

  return (
    <div className="flex flex-col gap-5">
      <EquipmentApiWorkspace equipments={list.equipments} totalElements={list.totalElements} truncated={list.totalPages > 1} counts={list.counts} />
      <NotificationPagination page={list.page} totalPages={list.totalPages} label="장비 목록 페이지 (100대씩)" />
    </div>
  );
}

/** `?page=`(1부터) → 0부터. 없으면 0, 올바르지 않으면 null (다른 값으로 바꾸지 않는다) */
function parsePage(raw: string | string[] | undefined): number | null {
  if (raw === undefined || raw === "") return 0;
  if (Array.isArray(raw) || !/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw) - 1;
  return Number.isSafeInteger(page) ? page : null;
}
