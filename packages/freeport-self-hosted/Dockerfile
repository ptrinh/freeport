# Self-hosted Freeport in a box: web app + MCP + push notifier + Nostr relay
# + Telegram bridge, one container, port 1988 (+1989 for the relay WS).
# Build from the REPO ROOT: docker build -f packages/freeport-self-hosted/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
# protocol + agent are both bundled into the http.js output (the Telegram guest
# bridge uses FreeportAgent), so both must be built before the esbuild step can
# resolve and inline them.
COPY packages/protocol packages/protocol
COPY packages/agent packages/agent
COPY packages/freeport-self-hosted packages/freeport-self-hosted
RUN npm install --no-audit --no-fund \
 && npm run build -w @freeport/protocol -w @freeport/agent -w freeport-self-hosted

# The web app itself (served at /). Its own stage so server-only changes reuse
# the cached export; drop this stage + its COPY in runtime for API-only images.
FROM node:22-alpine AS web
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol packages/protocol
COPY packages/agent packages/agent
COPY packages/freeport-self-hosted packages/freeport-self-hosted
COPY apps/mobile apps/mobile
RUN npm install --no-audit --no-fund \
 && npm run build -w @freeport/protocol -w @freeport/agent \
 && npm install --no-audit --no-fund --prefix apps/mobile \
 && bash packages/freeport-self-hosted/build-web.sh

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=1988 RELAY_HOST=0.0.0.0
COPY --from=build /repo /repo
COPY --from=web /repo/packages/freeport-self-hosted/web-dist /repo/packages/freeport-self-hosted/web-dist
WORKDIR /repo/packages/freeport-self-hosted
EXPOSE 1988 1989
CMD ["node", "dist/http.js"]
