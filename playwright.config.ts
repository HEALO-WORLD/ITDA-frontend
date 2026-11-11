import { defineConfig, devices, type Project } from "@playwright/test";

import { assertIsolatedE2eTarget, isDbWriteAllowed, resolveE2eTarget } from "./tests/e2e/support/environment";

/**
 * E2E 실행 안전장치
 * - E2E_BASE_URL 필수 (기본값 없음: 개발 프론트 3001 → 개발 DB로 잘못 실행되지 않도록)
 * - 실행 전에 대상 포트의 컨테이너가 격리된 E2E Compose 프로젝트(itda-e2e)인지 docker로 확인한다 (아니면 아무 테스트도 실행하지 않음)
 * - 기본 실행은 읽기 전용 테스트(*.readonly.spec.ts)만. 그 밖의 파일은 어떤 project에도 속하지 않아 실행되지 않는다
 * - DB를 바꾸는 테스트는 E2E_ALLOW_DB_WRITE=1일 때만 db-write project로 모은다
 *
 * 실행 예 (읽기 전용): E2E_BASE_URL=http://127.0.0.1:3002 E2E_TEST_PASSWORD=... npm run test:e2e
 */
const target = resolveE2eTarget(process.env.E2E_BASE_URL);
assertIsolatedE2eTarget(target);

/** DB를 바꾸는 테스트 (협약 요청·승인·종료 등). 새 파일은 *.db-write.spec.ts로 이름 붙인다 */
const DB_WRITE_SPECS = [/partnership-slot-visibility\.spec\.ts$/, /\.db-write\.spec\.ts$/];

const projects: Project[] = [
  { name: "readonly", testMatch: /\.readonly\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
];
if (isDbWriteAllowed()) {
  projects.push({ name: "db-write", testMatch: DB_WRITE_SPECS, use: { ...devices["Desktop Chrome"] } });
}

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/support/**"],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: target.baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects,
});
