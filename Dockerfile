# syntax=docker/dockerfile:1

# Debian (glibc) rather than Alpine so better-sqlite3's prebuilt binary is used.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# --ignore-scripts: no third-party install scripts run in the build; better-sqlite3 ships its prebuilt binary.
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY server server
COPY web web
RUN npm run build

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server \
 && node -e "new (require('better-sqlite3'))(':memory:').close()" \
 && node -e "require('sharp')({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).webp().toBuffer().then(() => console.log('sharp ok'))"

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app
COPY --from=deps /app ./
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# Create the data directory before declaring the volume so a new named volume inherits this ownership.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3210) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/dist/index.js"]
