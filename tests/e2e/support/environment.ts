import { execFileSync } from "node:child_process";

/**
 * Playwright 실행 대상 안전장치 (playwright.config.ts에서 테스트를 모으기 전에 호출한다).
 *
 * - E2E_BASE_URL은 필수다. 기본값을 두지 않는다 (개발 프론트 3001 → 개발 DB로 잘못 붙지 않도록)
 * - DB를 바꾸는 테스트는 E2E_ALLOW_DB_WRITE=1일 때만 모으고, 그때는 대상 포트를 공개한 컨테이너가
 *   격리된 E2E Compose 프로젝트(기본 itda-e2e)에 속하고 개발 네트워크(itda_default)에 붙어 있지 않은지 docker로 확인한다
 */

/** 개발·시연 환경 프론트 (개발 DB). 어떤 경우에도 DB 변경 테스트 대상으로 쓰지 않는다 */
export const DEV_FRONTEND_PORTS: readonly string[] = ["3000", "3001"];
/** 격리된 E2E Compose 프로젝트 이름 (백엔드 docker-compose.e2e.yml의 name) */
export const DEFAULT_E2E_COMPOSE_PROJECT = "itda-e2e";
/** 개발 환경 Docker 네트워크 (여기에 붙은 컨테이너는 개발 Gateway·DB를 부를 수 있다) */
const DEV_DOCKER_NETWORK = "itda_default";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface E2eTarget {
  baseURL: string;
  host: string;
  port: string;
}

export function resolveE2eTarget(raw: string | undefined): E2eTarget {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      "E2E_BASE_URL 환경변수를 지정해 주세요. 기본값은 없습니다 (개발 환경 3001로 잘못 실행되지 않도록).\n" +
        "  예: E2E_BASE_URL=http://127.0.0.1:3002 npm run test:e2e",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`E2E_BASE_URL이 올바른 주소가 아닙니다: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`E2E_BASE_URL은 http(s) 주소여야 합니다: ${value}`);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return { baseURL: url.origin, host: url.hostname, port };
}

/** DB 변경 테스트를 허용할지 (명시적으로 1일 때만) */
export function isDbWriteAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_ALLOW_DB_WRITE === "1";
}

type DockerRunner = (args: string[]) => string;
const runDocker: DockerRunner = (args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * DB 변경 테스트 대상이 격리된 E2E 환경인지 확인한다. 아니면 예외 (테스트를 하나도 실행하지 않는다).
 * 1) 로컬 주소이고 개발 프론트 포트(3000·3001)가 아니다
 * 2) 그 포트를 공개한 컨테이너가 정확히 하나이고, Compose 프로젝트가 E2E 프로젝트다
 * 3) 그 컨테이너가 개발 네트워크(itda_default)에 붙어 있지 않다 (개발 Gateway·DB를 부를 수 없다)
 */
export function assertIsolatedE2eTarget(
  target: E2eTarget,
  { project = process.env.E2E_COMPOSE_PROJECT?.trim() || DEFAULT_E2E_COMPOSE_PROJECT, docker = runDocker }: { project?: string; docker?: DockerRunner } = {},
): void {
  const fail = (reason: string): never => {
    throw new Error(`E2E 테스트를 실행하지 않습니다 (격리된 E2E 환경 확인 실패): ${reason} (대상 ${target.baseURL})`);
  };
  if (!LOOPBACK_HOSTS.has(target.host)) fail("로컬 E2E 환경(127.0.0.1)만 허용합니다.");
  if (DEV_FRONTEND_PORTS.includes(target.port)) fail(`포트 ${target.port}는 개발·시연 환경입니다.`);

  let ids: string[];
  try {
    ids = docker(["ps", "--filter", `publish=${target.port}`, "--format", "{{.ID}}"]).split(/\s+/).filter(Boolean);
  } catch {
    return fail("docker로 대상 컨테이너를 확인할 수 없습니다.");
  }
  if (ids.length !== 1) fail(`포트 ${target.port}를 공개한 컨테이너가 ${ids.length}개입니다 (정확히 1개여야 합니다).`);

  const inspected = docker([
    "inspect",
    ids[0],
    "--format",
    '{{index .Config.Labels "com.docker.compose.project"}}|{{range $name, $_ := .NetworkSettings.Networks}}{{$name}},{{end}}',
  ]);
  const [composeProject, networkList = ""] = inspected.split("|");
  const networks = networkList.split(",").filter(Boolean);
  if (composeProject !== project) fail(`컨테이너 Compose 프로젝트가 "${composeProject || "(없음)"}"입니다 (기대: "${project}").`);
  if (networks.includes(DEV_DOCKER_NETWORK)) fail(`컨테이너가 개발 네트워크 ${DEV_DOCKER_NETWORK}에 연결되어 있습니다.`);
  if (!networks.every((name) => name.startsWith(`${project}_`))) fail(`컨테이너 네트워크(${networks.join(", ")})가 E2E 프로젝트 네트워크가 아닙니다.`);
}
