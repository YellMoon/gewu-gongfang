FROM node:24-alpine
WORKDIR /app
COPY cloud-business-api/package.json ./
RUN npm install --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com --fetch-timeout=30000 --fetch-retries=2
COPY cloud-business-api/server.js ./
COPY cloud-business-api/src ./src
COPY cloud-business-api/sql ./sql
COPY cloud-business-api/scripts ./scripts
COPY backend/assets/fonts ./assets/fonts
COPY shared /shared
USER node
EXPOSE 3002
CMD ["node", "scripts/startVerified.js"]
