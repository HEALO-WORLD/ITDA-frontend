# ITDA 프론트엔드

의뢰기관·검사기관용 영상검사 의뢰·예약 서비스의 웹 프론트엔드입니다.

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
- Mock 모드(개발용 예시 데이터)와 API 모드(백엔드 Gateway 연동)를 지원합니다.

## 로컬 개발

Node.js 20.9 이상이 필요합니다.

```bash
npm ci
npm run dev
```

브라우저에서 `http://localhost:3001`으로 접속합니다.

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | production 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint |

## 환경변수

프로젝트 루트의 `.env`에 설정합니다. `.env`는 Git에 커밋하지 않습니다.

| 변수 | 설명 | 적용 시점 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_MODE` | `mock`(기본) 또는 `api` | 빌드 |
| `NEXT_PUBLIC_API_FEATURES` | API로 연결할 기능 목록(쉼표 구분). 비우면 전체 | 빌드 |
| `NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION` | `true`이면 장비 장애 등록 사용 | 빌드 |
| `NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS` | 배포 환경에서 Mock 데모 바로가기 표시 | 빌드 |
| `API_BASE_URL` | Next 서버가 호출할 Gateway 주소. 로컬 개발: `http://localhost:8080` | 실행 |

- `NEXT_PUBLIC_*` 값은 빌드할 때 브라우저 코드에 들어갑니다. 값을 바꾸면 **다시 빌드**해야 합니다.
- 브라우저는 Gateway를 직접 부르지 않습니다. API 요청은 모두 Next 서버(Server Component·Server Action·Route Handler)를 거칩니다.

## Docker로 실행

프론트엔드는 production 모드 컨테이너로 실행되고, 백엔드 Docker 네트워크(`itda_default`)에 붙어 Gateway(`gateway-service:8080`)를 호출합니다.

### 1. 사전 준비

- Docker Desktop을 실행합니다.
- **API 모드라면 백엔드를 먼저 실행합니다.** 백엔드 네트워크가 있어야 프론트 컨테이너가 뜹니다.

  ```bash
  cd "백엔드코드 있는 폴더"
  docker compose -f docker-compose.yml -f docker-compose.app.yml up -d
  ```

- 프론트 `.env`의 `NEXT_PUBLIC_*` 값이 빌드에 그대로 쓰입니다. 컨테이너 안의 Gateway 주소는 `docker-compose.yml`에서 `http://gateway-service:8080`으로 자동 설정되므로 `.env`의 `API_BASE_URL`은 바꾸지 않아도 됩니다.

### 2. 빌드 및 실행

프론트엔드 폴더에서 실행합니다.

```bash
docker compose up --build -d
```

`http://localhost:3001`으로 접속합니다. 상태는 아래 명령으로 확인합니다.

```bash
docker compose ps
```

3001 포트를 `npm run dev`가 쓰고 있다면 다른 포트로 실행합니다 (PowerShell 기준).

```powershell
$env:FRONTEND_PORT = "3300"; docker compose up --build -d
```

### 3. 로그 확인

```bash
docker compose logs --tail=100
docker compose logs -f
```

`-f` 실시간 로그는 `Ctrl + C`로 빠져나옵니다. 컨테이너는 계속 실행됩니다.

### 4. 코드·환경변수 변경 후 반영

```bash
docker compose up --build -d
```

### 5. 중지

```bash
docker compose stop
docker compose start
docker compose down
```

- `stop`·`start`는 컨테이너를 멈췄다 다시 시작합니다.
- `down`은 프론트 컨테이너만 제거합니다. 백엔드 네트워크와 백엔드 컨테이너는 그대로입니다.
- 데이터 볼륨을 지우는 `down -v`는 쓰지 않습니다.

### 설정 파일

| 파일 | 설명 |
| --- | --- |
| `Dockerfile` | 의존성 설치 → 빌드 → 실행 3단계. Next.js standalone 출력, non-root 사용자로 실행 |
| `docker-compose.yml` | 프론트 전용 Compose 프로젝트(`itda-frontend`). 포트 `127.0.0.1:3001`, 백엔드 네트워크 연결 |
| `.dockerignore` | `node_modules`·`.next`·`.env`·`tests` 등을 빌드에서 제외 |

Docker 실행에만 쓰는 추가 변수입니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `FRONTEND_PORT` | `3001` | 브라우저에서 접속할 호스트 포트 |
| `DOCKER_API_BASE_URL` | `http://gateway-service:8080` | 컨테이너 안에서 쓸 Gateway 주소 |
| `ITDA_BACKEND_NETWORK` | `itda_default` | 연결할 백엔드 Docker 네트워크 |

### 주의사항

- `localhost`는 위치에 따라 뜻이 다릅니다. 브라우저의 `localhost`는 내 PC이고, 컨테이너 안의 `localhost`는 그 컨테이너 자신입니다. 그래서 컨테이너에서는 `gateway-service`로 접근합니다.
- 로그인 쿠키는 `Secure` 쿠키입니다. 접속 주소는 `http://localhost:포트`(또는 HTTPS)를 쓰세요. 다른 호스트 이름의 HTTP로 접속하면 로그인이 유지되지 않을 수 있습니다.
- `docker compose config`는 `.env` 값을 그대로 출력합니다. 결과를 공유할 때는 비밀값이 없는지 확인하세요.
- Vercel 배포에는 영향이 없습니다. standalone 출력은 Docker 빌드에서만 켜집니다.
