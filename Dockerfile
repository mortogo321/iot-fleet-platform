# Multi-target build: `target: server` (API + ops console) and `target: simulator`.
# Bun runs TypeScript directly — only the web app needs a build step.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/simulator/package.json apps/simulator/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run --filter web build

# Production-only node_modules (no vite/test tooling in runtime images).
FROM oven/bun:1 AS proddeps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/simulator/package.json apps/simulator/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=proddeps /app/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 8080
CMD ["bun", "apps/server/src/index.ts"]

FROM oven/bun:1 AS simulator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=proddeps /app/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/simulator apps/simulator
CMD ["bun", "apps/simulator/src/index.ts"]
