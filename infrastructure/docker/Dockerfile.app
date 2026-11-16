# Multi-stage build for the CloudHost247 Fastify/React platform (local/CI container parity with the Ubuntu 24.04 VPS).
# Build context must be the repository root (.. from infrastructure/docker/):
#   docker build -f infrastructure/docker/Dockerfile.app -t cloudhost247-app .

FROM node:22-bookworm-slim AS build
WORKDIR /repo/cloudhost247-node

COPY cloudhost247-node/package.json cloudhost247-node/package-lock.json ./
RUN npm ci

# Copy shared repository catalogs/projections and Node sources so `npm run build`
# (build:server + build:frontend + build:tools) resolves ../../modules and ../../assets cleanly.
COPY shared /repo/shared
COPY modules/addons/cloudhost247_theme/resources /repo/modules/addons/cloudhost247_theme/resources
COPY assets /repo/assets
COPY cloudhost247-node/tsconfig.json cloudhost247-node/tsconfig.scripts.json ./
COPY cloudhost247-node/scripts ./scripts
COPY cloudhost247-node/config ./config
COPY cloudhost247-node/src ./src
COPY cloudhost247-node/database ./database
COPY cloudhost247-node/frontend ./frontend
COPY cloudhost247-node/manifests ./manifests

RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as an unprivileged user (mirrors system user `cloudhost247` on the Ubuntu 24.04 VPS).
RUN groupadd -r cloudhost && useradd -r -g cloudhost -d /app cloudhost

COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/package.json ./package.json
COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/node_modules ./node_modules
COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/dist ./dist
COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/public ./public
COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/manifests ./manifests
COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/config ./config
COPY --from=build --chown=cloudhost:cloudhost /repo/cloudhost247-node/database/migrations ./database/migrations

USER cloudhost
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/server.js"]
