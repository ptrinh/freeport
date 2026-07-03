# Build the whole monorepo (protocol + nostr-mcp) then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
# protocol + agent are both bundled into the http.js output (the Telegram guest
# bridge uses FreeportAgent), so both must be built before nostr-mcp's esbuild
# step can resolve and inline them.
COPY packages/protocol packages/protocol
COPY packages/agent packages/agent
COPY packages/nostr-mcp packages/nostr-mcp
RUN npm install --no-audit --no-fund \
 && npm run build -w @freeport/protocol -w @freeport/agent -w freeport-nostr-mcp

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8788
COPY --from=build /repo /repo
WORKDIR /repo/packages/nostr-mcp
EXPOSE 8788
CMD ["node", "dist/http.js"]
