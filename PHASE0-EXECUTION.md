# Phase 0: 基础设施重构 — 详细执行方案

> 目标：将现有单体后端拆分为 Gateway + 独立模块，不改变现有功能

## 当前状态

- 后端代码：`backend/src/` (Express + SQLite，单体)
- 小程序代码：`miniapp/src/` (Taro 3 + Vue 3)
- 已部署在阿里云：`physicsedu.xyz/scheduling/` → :3001

## 执行步骤

### Step 1: 创建 monorepo 目录结构

在 `scheduling-system/` 下创建：
```
gateway/src/{middleware,routes,config,db}
gateway/src/config/
modules/scheduling/
modules/question-bank/
modules/teaching-tools/
modules/assets/
shared/types/
shared/validators/
shared/utils/
```

### Step 2: 创建 Gateway 骨架

文件：`gateway/src/app.js`
- Express 应用主入口
- CORS、JSON 解析、请求日志
- 健康检查 `/api/health`
- 动态加载模块路由 (从 config/modules.json 读取)
- 统一错误处理

文件：`gateway/package.json`
- 依赖：express, cors, jsonwebtoken, better-sqlite3, uuid

### Step 3: 实现 JWT 认证中间件

文件：`gateway/src/middleware/auth.js`
- `authMiddleware`: 验证 JWT token，提取 user 信息
- `optionalAuth`: 可选认证（公开接口用）
- Token 签发/刷新/验证

文件：`gateway/src/routes/auth.js`
- POST `/api/auth/login` — 微信登录 ( openid → 签发 token )
- POST `/api/auth/register` — 注册 (含邀请码注册)
- POST `/api/auth/refresh` — Token 刷新

### Step 4: 实现权限校验中间件

文件：`gateway/src/middleware/permission.js`
- `requirePermission(module, action)` — 检查用户是否有指定权限
- `requireType(types)` — 检查用户类型是否在允许列表中
- 管理员跳过所有检查

### Step 5: 创建 Gateway 数据库 Schema

文件：`gateway/src/db/schema.sql`
- users 表 (含 user_type, invited_by, invite_code)
- modules 表
- permissions 表 (含 allowed_types)
- user_permissions 表
- invitations 表

文件：`gateway/src/db/database.js`
- 数据库初始化 + 表创建

### Step 6: 实现管理员 API

文件：`gateway/src/routes/admin.js`
- GET `/api/admin/users` — 用户列表
- PUT `/api/admin/users/:id/type` — 设置用户类型
- GET `/api/admin/users/:id/permissions` — 查询用户权限
- POST `/api/admin/users/:id/permissions` — 授予权限
- DELETE `/api/admin/users/:id/permissions/:pid` — 撤销权限

### Step 7: 实现邀请码 API

文件：`gateway/src/routes/invitations.js`
- POST `/api/invitations/create` — 创建邀请码 (管理员)
- GET `/api/invitations/list` — 查询邀请码列表 (管理员)
- POST `/api/invitations/use` — 使用邀请码 (被邀请者)
- DELETE `/api/invitations/:id` — 撤销邀请码 (管理员)

### Step 8: 迁移排课模块

将 `backend/src/` 中的代码迁移到 `modules/scheduling/`：
- 复制 routes/、database.js、schema.sql
- 修改为模块化导出 (module.exports = router)
- 保持所有 API 路径不变

### Step 9: 模块注册配置

文件：`gateway/src/config/modules.json`
```json
[
  {
    "id": "scheduling",
    "name": "排课管理",
    "route_prefix": "/api/scheduling",
    "db_path": "../modules/scheduling/data/scheduling.db"
  }
]
```

文件：`gateway/src/config/permissions.json`
- 排课模块权限定义 (view/edit/delete/admin)
- 每个权限的 allowed_types

### Step 10: Gateway 路由挂载

在 `gateway/src/app.js` 中：
- 根据 modules.json 动态加载各模块路由
- 为每个模块路由添加权限中间件

### Step 11: 本地测试

- 启动 Gateway
- 测试健康检查
- 测试登录/注册
- 测试排课模块所有 API
- 测试权限校验

### Step 12: 部署到阿里云

- 上传 Gateway + 排课模块到服务器
- 更新 Nginx 配置
- PM2 启动/重启
- 验证线上功能

## 验收标准

1. Gateway 启动无报错
2. 所有排课 API 正常工作 (与迁移前一致)
3. JWT 认证正常 (签发/验证/刷新)
4. 权限校验中间件工作正常
5. 管理员可创建邀请码、分配权限
6. 被邀请者可通过邀请码注册
7. 线上访问正常
