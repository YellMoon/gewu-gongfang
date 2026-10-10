ARG NPM_CACHE_IMAGE=node:24-alpine
FROM ${NPM_CACHE_IMAGE} AS npm-cache
USER root
RUN mkdir -p /root/.npm

FROM node:24-alpine
WORKDIR /app
COPY --from=npm-cache /root/.npm /root/.npm
COPY cloud-business-api/package.json ./
RUN npm install --omit=dev --ignore-scripts --prefer-offline --registry=https://registry.npmmirror.com --fetch-timeout=30000 --fetch-retries=2
COPY cloud-business-api/server.js ./
COPY cloud-business-api/src ./src
COPY cloud-business-api/sql ./sql
COPY cloud-business-api/scripts ./scripts
COPY cloud-business-api/resources ./resources
COPY backend/assets/fonts ./assets/fonts
COPY shared /shared
USER node
EXPOSE 3002
CMD ["node", "scripts/startVerified.js"]
