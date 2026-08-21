FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.js ./
COPY src ./src
USER node
EXPOSE 3002
CMD ["node", "server.js"]
