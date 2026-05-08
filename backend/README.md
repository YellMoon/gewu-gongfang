# 教务管理系统后端 API v3.1.0-0504

> 阿里云 ECS 部署版 · Node.js + Express + SQLite

## 📚 功能

- **REST API** 覆盖所有 CRUD：学生、课程、排课、缴费、课时消耗、老师、教室、学校、机构
- **数据同步 API**：离线优先设计的同步协议（Pull/Push/Status）
- **微信小程序登录**：预留 JWT 认证接口
- **统计报表**：收入统计、课时消耗统计、概览
- **数据导入导出**：JSON 格式备份/恢复

## 🚀 快速开始

### 1. 环境要求

- Node.js v18+
- npm

### 2. 安装

```bash
cd backend
cp .env.example .env    # 编辑配置
npm install
```

### 3. 开发运行

```bash
npm run dev
# 或
node server.js
```

服务启动在 http://localhost:3001

健康检查：`GET /api/health`

## 📡 API 接口

### 学生管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/students` | 获取所有学生 |
| GET | `/api/students/:id` | 获取单个学生 |
| POST | `/api/students` | 创建学生 |
| PUT | `/api/students/:id` | 更新学生 |
| DELETE | `/api/students/:id` | 删除学生（软删除） |
| GET | `/api/students/:id/grades` | 获取学生成绩 |
| POST | `/api/students/:id/grades` | 添加成绩 |

### 课程管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/courses` | 获取所有课程 |
| GET | `/api/courses/:id` | 获取单个课程 |
| POST | `/api/courses` | 创建课程 |
| PUT | `/api/courses/:id` | 更新课程 |
| DELETE | `/api/courses/:id` | 删除课程 |

### 排课管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schedules` | 获取排课（支持 ?start=&end=） |
| GET | `/api/schedules/:id` | 获取单个排课 |
| POST | `/api/schedules` | 创建排课（自动冲突检测） |
| PUT | `/api/schedules/:id` | 更新排课 |
| DELETE | `/api/schedules/:id` | 删除排课 |
| GET | `/api/schedules/:id/enrollments` | 获取排课学生 |
| POST | `/api/schedules/:id/enrollments` | 添加选课关联 |

### 缴费管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/payments?student_id=` | 获取缴费记录 |
| POST | `/api/payments` | 创建缴费（自动更新学生余额） |

### 课时消耗
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/consumptions?student_id=` | 获取消耗记录 |
| POST | `/api/consumptions` | 创建消耗（自动扣减余额） |

### 老师管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/teachers` | 获取所有老师 |
| POST | `/api/teachers` | 创建老师 |
| PUT | `/api/teachers/:id` | 更新老师 |
| DELETE | `/api/teachers/:id` | 删除老师 |

### 教室管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rooms` | 获取所有教室 |
| POST | `/api/rooms` | 创建教室 |
| PUT | `/api/rooms/:id` | 更新教室 |
| DELETE | `/api/rooms/:id` | 删除教室 |

### 学校管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schools` | 获取所有学校 |
| POST | `/api/schools` | 添加学校（自动去重） |

### 机构管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/institutions` | 获取所有机构 |
| POST | `/api/institutions` | 创建机构 |
| PUT | `/api/institutions/:id` | 更新机构 |
| DELETE | `/api/institutions/:id` | 删除机构 |

### 统计
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats/revenue?start=&end=` | 收入统计 |
| GET | `/api/stats/consumption?start=&end=` | 课时消耗统计 |
| GET | `/api/stats/overview` | 概览统计 |

### 数据管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/export` | 导出全部数据（JSON） |
| POST | `/api/import` | 导入数据 |

### 同步 API（核心）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sync/pull` | 拉取服务端变更 |
| POST | `/api/sync/push` | 推送本地变更 |
| POST | `/api/sync/status` | 检查同步状态 |

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/wechat-login` | 微信小程序登录 |
| GET | `/api/auth/me` | 获取当前用户 |

## 🔄 同步协议

### Pull（拉取变更）

```json
// 请求
POST /api/sync/pull
{ "last_sync_time": "2026-05-04T00:00:00.000Z", "client_id": "electron-abc123" }

// 响应
{
  "success": true,
  "changes": {
    "students": [{ "id": "...", "updated_at": "...", "deleted": 0, ... }],
    "courses": [...],
    ...
  },
  "server_time": "2026-05-04T08:30:00.000Z"
}
```

### Push（推送变更）

```json
// 请求
POST /api/sync/push
{
  "client_id": "electron-abc123",
  "changes": {
    "students": [{ "id": "...", "name": "张三", "updated_at": "...", "deleted": 0 }],
    ...
  }
}

// 响应
{ "success": true, "applied": 5, "conflicts": 0, "errors": [] }
```

### 冲突处理

服务端基于 `updated_at` 时间戳判断：如果记录在服务端的更新时间比客户端推送的新，则标记为冲突，不覆盖。

## 🐳 Docker 部署（推荐）

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down

# 数据库文件在 Docker volume 中
# 备份: docker cp scheduling-backend:/app/data/scheduling.db ./
```

## ☁️ 阿里云 ECS 部署

### 1. 购买并配置 ECS

- 系统：CentOS 7+ / Ubuntu 20.04+ / Alibaba Cloud Linux 3
- 配置：1核2G 起步（小规模使用）
- 带宽：按量付费 1Mbps+
- 安全组：开放 22 (SSH)、3001 (API)

### 2. 连接 ECS

```bash
ssh root@<公网IP>
```

### 3. 安装环境

```bash
# Ubuntu/Debian
apt update && apt install -y curl git build-essential python3 sqlite3

# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 安装 PM2（进程管理）
npm install -g pm2

# 安装 Docker（可选）
curl -fsSL https://get.docker.com | bash
```

### 4. 上传项目

```bash
# 在本地打包
cd scheduling-system/backend
tar -czf backend.tar.gz --exclude=node_modules --exclude=data .

# 上传到服务器
scp backend.tar.gz root@<公网IP>:/opt/

# 在服务器解压
ssh root@<公网IP>
cd /opt
tar -xzf backend.tar.gz -C scheduling-backend
cd scheduling-backend
```

### 5. 配置并启动

```bash
# 复制环境配置
cp .env.example .env
vim .env   # 修改 PORT、JWT_SECRET 等

# 安装依赖
npm install

# 使用 PM2 启动
pm2 start pm2.config.js
pm2 save
pm2 startup   # 设置开机自启
```

### 6. 配置 Nginx 反向代理（推荐）

```bash
apt install -y nginx

# 创建配置
cat > /etc/nginx/sites-available/scheduling-api << 'EOF'
server {
    listen 80;
    server_name <你的域名或IP>;
    
    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50m;
    }
}
EOF

ln -s /etc/nginx/sites-available/scheduling-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 7. SSL 证书（可选）

```bash
# 使用 Let's Encrypt
apt install -y certbot python3-certbot-nginx
certbot --nginx -d <你的域名>
```

### 8. 验证部署

```bash
curl http://localhost:3001/api/health
# 期望: {"ok":true,"time":"...","version":"3.1.0-0504"}

curl http://<公网IP>/api/health
```

## 📁 目录结构

```
backend/
├── server.js                # 入口
├── package.json
├── .env.example             # 配置模板
├── Dockerfile
├── docker-compose.yml
├── pm2.config.js
├── README.md
├── src/
│   ├── app.js               # Express 应用
│   ├── database.js          # 数据库层
│   ├── schema.sql           # 数据库 Schema
│   ├── middleware/
│   │   ├── auth.js          # JWT 认证
│   │   └── errorHandler.js  # 错误处理
│   └── routes/
│       ├── students.js      # 学生管理
│       ├── courses.js       # 课程管理
│       ├── schedules.js     # 排课管理
│       ├── payments.js      # 缴费管理
│       ├── consumptions.js  # 课时消耗
│       ├── teachers.js      # 老师管理
│       ├── rooms.js         # 教室管理
│       ├── schools.js       # 学校管理
│       ├── institutions.js  # 机构管理
│       ├── stats.js         # 统计
│       ├── export.js        # 导入导出
│       ├── sync.js          # 数据同步
│       └── auth.js          # 认证
└── data/                    # SQLite 数据库文件
    └── scheduling.db
```

## 🔒 安全建议

1. **修改 JWT_SECRET**：生成随机密钥 `openssl rand -hex 32`
2. **限制 CORS**：生产环境设置具体域名
3. **Nginx 限流**：防止 API 滥用
4. **定期备份**：`cp data/scheduling.db data/scheduling-backup-$(date +%Y%m%d).db`
5. **配置防火墙**：`ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`
6. **数据库不要暴露在 Web 目录**：data/ 目录在 Nginx 配置中禁止访问

## 📝 与桌面端同步工作流

1. 桌面端启动时检查网络连接
2. 在线 → POST `/api/sync/pull` 拉取云端变更 → 合并到本地
3. 用户操作 → 本地保存 → 标记为待同步
4. 在线时 → POST `/api/sync/push` 推送变更 → 清空待同步队列
5. 离线时 → 本地操作继续，变更入待同步队列
6. 恢复在线 → 弹出提示"有N条待同步变更，是否更新到云端？" → 用户确认 → 推送

---

**版本**: v3.1.0-0504  
**作者**: 小龙虾
