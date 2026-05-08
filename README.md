# 教务管理系统（云平台版）

## 📚 项目简介

全平台教务管理系统，支持桌面端（Electron）、微信小程序、Web浏览器。核心特性：离线优先，本地操作后在线自动同步到云端。

## ✨ 核心功能

- **学生管理**: 学生信息、成绩记录、账户余额（课时 + 金额）
- **课程管理**: 4 种课程类型（一对一/一对二/小组课/大班课），3 种课程来源（自有/机构/混合班）
- **排课系统**: 日历视图、冲突检测、周期性排课
- **财务管理**: 学费缴纳、课时消耗、收入统计
- **数据导出**: Excel/PDF/JSON 格式
- **☁️ 云端同步**: 离线操作 → 在线确认 → 自动同步到阿里云服务器
- **📱 小程序**: 微信小程序随时随地查看和管理

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────┐
│         阿里云 ECS 服务器                     │
│  ┌─────────────────────────────────────────┐│
│  │  Node.js API Server (Express)           ││
│  │  SQLite / MySQL 数据库                   ││
│  │  REST API + 同步端点                     ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
         ↑              ↑              ↑
    ┌────────┐    ┌──────────┐   ┌────────────┐
    │Electron│    │微信小程序  │   │ Web浏览器   │
    │(桌面端) │    │(移动端)   │   │ (备用)      │
    └────────┘    └──────────┘   └────────────┘
```

## 🛠️ 技术栈

### 桌面端 (Electron)
- **框架**: Electron + React + TypeScript
- **UI**: Ant Design
- **数据库**: sql.js (SQLite)
- **同步**: 离线优先架构，自动检测网络状态

### 后端 (Alibaba Cloud)
- **框架**: Express.js
- **数据库**: SQLite (better-sqlite3) / 可迁移MySQL
- **部署**: Docker / PM2
- **认证**: JWT + 微信登录

### 微信小程序
- **框架**: Taro (React 语法)
- **UI**: 自定义组件
- **同步**: 离线队列 + 在线确认

## 🚀 快速开始

### 1. 桌面端开发

```bash
cd scheduling-system
npm install
npm run dev
```

### 2. 后端服务

```bash
cd scheduling-system/backend
npm install
npm start          # 生产模式
npm run dev        # 开发模式（nodemon热重载）
```

### 3. 微信小程序

```bash
cd scheduling-system/miniapp
npm install
npm run dev:weapp  # 微信开发者工具
```

## 📁 项目结构

```
scheduling-system/
├── src/                    # 桌面端源码
│   ├── main/               # Electron 主进程
│   ├── db/                 # 数据库 Schema
│   ├── services/           # 服务层
│   │   ├── browserDatabase.ts   # 本地数据库
│   │   ├── cloudSync.ts         # 云端同步服务
│   │   └── syncAwareDatabase.ts # 同步感知数据库
│   ├── components/         # 组件
│   │   └── SyncStatusBar.tsx    # 同步状态栏
│   ├── pages/              # 页面
│   └── types/              # 类型定义
├── backend/                # 后端API服务
│   ├── server.js           # 入口
│   ├── src/
│   │   ├── app.js          # Express 应用
│   │   ├── database.js     # 数据库
│   │   ├── routes/         # API 路由
│   │   └── middleware/     # 中间件
│   ├── Dockerfile          # Docker 配置
│   ├── docker-compose.yml  # 编排配置
│   └── pm2.config.js       # PM2 配置
├── miniapp/                # 微信小程序
│   ├── src/
│   │   ├── pages/          # 页面（9个）
│   │   ├── utils/
│   │   │   ├── api.ts      # API 封装
│   │   │   ├── storage.ts  # 本地存储
│   │   │   └── sync.ts     # 同步管理
│   │   └── types/          # 类型定义
│   └── config/             # Taro 配置
└── package.json
```

## ☁️ 云端同步机制

### 工作流程

```
离线操作 → 记录到本地队列 → 网络恢复 → 弹窗提醒 → 用户确认 → 推送到云端
```

### 同步策略

1. **离线优先**: 所有操作先写入本地，无网络时也能正常使用
2. **变更记录**: 每次增删改自动记录到 pendingChanges 队列
3. **网络检测**: 自动检测网络状态，恢复时触发同步
4. **用户确认**: 同步前弹窗列出待同步项，由用户确认
5. **冲突解决**: 基于时间戳的最后写入优先

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/sync/pull` | POST | 拉取云端变更 |
| `/api/sync/push` | POST | 推送本地变更 |
| `/api/sync/status` | GET | 同步状态 |
| `/api/students` | CRUD | 学生管理 |
| `/api/courses` | CRUD | 课程管理 |
| `/api/schedules` | CRUD | 排课管理 |
| `/api/payments` | CRUD | 缴费管理 |
| `/api/consumptions` | CRUD | 课时消耗 |
| `/api/teachers` | CRUD | 老师管理 |
| `/api/rooms` | CRUD | 教室管理 |
| `/api/schools` | CRUD | 学校管理 |
| `/api/institutions` | CRUD | 机构管理 |
| `/api/stats/revenue` | GET | 收入统计 |
| `/api/stats/consumption` | GET | 课时统计 |
| `/api/export` | GET | 数据导出 |
| `/api/import` | POST | 数据导入 |

## 🐳 部署到阿里云

### Docker 部署（推荐）

```bash
cd backend
docker-compose up -d
```

### PM2 部署

```bash
cd backend
npm install
pm2 start pm2.config.js
pm2 save
pm2 startup
```

### 环境变量

复制 `.env.example` 为 `.env`，修改配置：

```bash
PORT=3001
DB_PATH=./data/scheduling.db
JWT_SECRET=your-secret-key
```

## 📱 微信小程序发布

1. 在微信开发者工具中导入 `miniapp/` 目录
2. 修改 `app.config.ts` 中的 appid
3. 在 `utils/api.ts` 中配置后端地址
4. 上传代码并提交审核

## 📝 数据迁移

### 导出
桌面端 → 系统设置 → 导出全部数据 (JSON)

### 导入
桌面端 → 系统设置 → 导入数据 → 选择 JSON 文件

## 🔧 开发说明

### 同步层集成

桌面端使用 `syncAwareDatabase` 替代 `browserDatabase`，自动记录变更：

```typescript
// App.tsx 中动态导入
const dbModule = await import('./services/syncAwareDatabase');
dbService = dbModule.default;
```

### 新增页面

1. 在 `src/pages/` 创建页面组件
2. 在 `App.tsx` 的 `PAGE_META` 中注册
3. 同步端点自动通过 `syncAwareDatabase` 工作

## 📄 许可证

MIT

## 👨‍💻 作者

小龙虾 · 严谨专业版

---

**版本**: v3.1.0-0504
**更新日期**: 2026-05-04
**更新内容**: 新增云端同步、微信小程序、阿里云部署
