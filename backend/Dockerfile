# 教务管理系统后端 Docker 镜像
# 基于 Node.js 20 Alpine

FROM node:20-alpine

# 安装 better-sqlite3 构建依赖
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# 复制 package 文件
COPY package.json package-lock.json* ./

# 安装依赖
RUN npm ci --production && apk del python3 make g++

# 复制应用代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/data

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]
