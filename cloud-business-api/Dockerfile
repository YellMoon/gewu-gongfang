FROM node:24-alpine
WORKDIR /app
COPY cloud-business-api/package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY cloud-business-api/server.js ./
COPY cloud-business-api/src ./src
COPY shared /shared
USER node
EXPOSE 3002
CMD ["node", "server.js"]
