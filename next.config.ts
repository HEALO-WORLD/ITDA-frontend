import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Docker 이미지 빌드에서만 standalone 출력을 쓴다 (Dockerfile이 NEXT_OUTPUT=standalone을 넘긴다).
  // Vercel·로컬 `next build`·`next dev`는 설정하지 않으므로 기존과 같다
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
