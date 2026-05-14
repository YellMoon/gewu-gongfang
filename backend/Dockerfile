# Gewu backend Docker image.
# Based on Node.js 20 Alpine.

FROM node:20-alpine

ARG APP_VERSION=dev
ARG APP_REVISION=local
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="gewu-scheduling-backend" \
  org.opencontainers.image.version="${APP_VERSION}" \
  org.opencontainers.image.revision="${APP_REVISION}" \
  org.opencontainers.image.created="${BUILD_DATE}"

ENV APP_VERSION=${APP_VERSION} \
  APP_REVISION=${APP_REVISION}

# Build dependencies for better-sqlite3.
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Copy package metadata first to keep dependency layers cacheable.
COPY package.json package-lock.json* ./

# Install production dependencies. The repo intentionally does not keep
# package-lock.json, so fall back to npm install when no lockfile exists.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --no-package-lock; fi \
  && apk del python3 make g++

# Copy application source.
COPY . .

# Persistent data directory.
RUN mkdir -p /app/data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port=process.env.PORT||3001; require('http').get('http://localhost:'+port+'/api/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]
