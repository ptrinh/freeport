# Build protocol + nostr-mcp from source, then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/protocol packages/protocol
COPY packages/nostr-mcp packages/nostr-mcp
RUN npm install --no-audit --no-fund \
 && npm run build

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8788
COPY --from=build /repo /repo
WORKDIR /repo/packages/nostr-mcp
EXPOSE 8788
CMD ["node", "dist/http.js"]
