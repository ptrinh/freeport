# Build the monorepo (protocol + nostr-notify) then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol packages/protocol
COPY packages/agent packages/agent
COPY packages/nostr-mcp packages/nostr-mcp
COPY packages/nostr-notify packages/nostr-notify
RUN npm install --no-audit --no-fund \
 && npm run build -w @freeport/protocol -w freeport-nostr-notify

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8789 DATA_DIR=/data
COPY --from=build /repo /repo
WORKDIR /repo/packages/nostr-notify
VOLUME ["/data"]
EXPOSE 8789
CMD ["node", "dist/index.js"]
