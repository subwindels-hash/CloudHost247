# CloudHost247 control plane container image.
#
# Multi-stage: build the Fastify app + Vite frontend with devDependencies, then ship only the
# compiled output with production dependencies.
FROM node:22-alpine AS build
WORKDIR /app
COPY cloudhost247-node/package.json cloudhost247-node/package-lock.json ./
RUN npm ci
COPY cloudhost247-node/tsconfig.json ./
COPY cloudhost247-node/src ./src
COPY cloudhost247-node/database ./database
COPY cloudhost247-node/frontend ./frontend
COPY cloudhost247-node/public ./public
COPY cloudhost247-node/server.js ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The Passenger shim (server.js) is the entrypoint; PORT is injected by the platform.
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.js ./
COPY --from=build /app/package.json ./
COPY cloudhost247-node/manifests ./manifests
EXPOSE 3000
CMD ["node", "server.js"]
