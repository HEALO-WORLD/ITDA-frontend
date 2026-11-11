import Image from "next/image";

/** 로고 원본 비율 (public/itda-logo-transparent.png: 837 × 272, 투명 배경) */
const LOGO_WIDTH = 837;
const LOGO_HEIGHT = 272;

/**
 * IT:DA 로고 이미지 (공통 헤더: 의뢰기관·검사기관·관리자·로그인).
 * 높이 34px(헤더 64px 안), 가로는 원본 비율 그대로. 화면 위쪽에 바로 보이므로 지연 로딩하지 않는다
 */
export default function Logo() {
  return (
    <Image
      src="/itda-logo-transparent.png"
      alt="IT:DA"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      loading="eager"
      className="h-[34px] w-auto shrink-0"
    />
  );
}
