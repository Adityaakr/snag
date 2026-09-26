# syntax=docker/dockerfile:1.7
# Remit server image (BUILD_PROMPT M9): multi-stage, runs as the non-root `node` user.
# Roles: REMIT_ROLE=web (default in compose), worker, or all. See docs/operations.md.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
WORKDIR /app

# Dependencies only, cached separately from the sources.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
COPY packages/core/package.json packages/core/
COPY packages/analysis/package.json packages/analysis/
COPY packages/providers/package.json packages/providers/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/eval/package.json packages/eval/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
COPY packages/action/package.json packages/action/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Compile the server and its workspace dependencies, and build the dashboard.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm exec tsc -b --force packages/server && pnpm --filter @remit/dashboard build
# Production dependencies only.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @remit/server...

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 WORKER_PORT=3001 DATA_DIR=/data
WORKDIR /app
# Every volume mount target exists and belongs to node, so new named volumes inherit that ownership.
RUN mkdir -p /data /shared && chown node:node /data /shared
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
# Each workspace package ships its compiled output and package.json (its dependencies are symlinked in node_modules).
COPY --from=build --chown=node:node /app/packages ./packages
# Calibration files and the golden fixtures (for the local fake GitHub only).
COPY --chown=node:node eval/calibration ./eval/calibration
COPY --chown=node:node fixtures/golden ./fixtures/golden
COPY --chown=node:node fixtures/webhooks ./fixtures/webhooks
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.REMIT_ROLE==='worker'?process.env.WORKER_PORT:process.env.PORT;fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/server/dist/main.js"]
