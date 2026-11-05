# ITDA 프론트엔드 production 이미지 (Next.js 16 standalone)
#
# - NEXT_PUBLIC_* 값은 `next build` 때 브라우저 번들에 들어간다 → 빌드 인자(ARG)로 받는다. 바꾸면 이미지를 다시 빌드해야 한다
# - API_BASE_URL(서버 전용 Gateway 주소)은 실행할 때 환경변수로 넣는다 (docker-compose.yml). 이미지에 넣지 않는다
# - .env 파일은 .dockerignore로 빌드 컨텍스트에서 빠진다 (비밀값이 이미지에 남지 않게)

# ── 1. 의존성 ──
FROM node:22-alpine AS deps
WORKDIR /app
# 일부 네이티브 패키지가 glibc 호환 계층을 찾는다
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. 빌드 ──
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_MODE=mock
ARG NEXT_PUBLIC_API_FEATURES=
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS=
ARG NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION=
ENV NEXT_PUBLIC_API_MODE=${NEXT_PUBLIC_API_MODE} \
    NEXT_PUBLIC_API_FEATURES=${NEXT_PUBLIC_API_FEATURES} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS=${NEXT_PUBLIC_ENABLE_DEMO_SHORTCUTS} \
    NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION=${NEXT_PUBLIC_ENABLE_EQUIPMENT_DOWNTIME_REGISTRATION} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── 3. 실행 (필요한 파일만) ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# standalone 서버 + 정적 파일 (server.js가 public·.next/static을 직접 서빙한다)
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# node 이미지의 기본 non-root 사용자
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
