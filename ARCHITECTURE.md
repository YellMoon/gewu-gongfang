# 教育综合服务平台 — 架构设计文档

> 版本: 4.0.0 | 日期: 2026-05-04 | 状态: 规划阶段

## 一、项目定位

从单一「教务管理系统」升级为**教育综合服务平台**，微信小程序为统一入口，按模块无限扩展：

| 模块 | 说明 | 状态 |
|------|------|------|
| 📅 排课管理 | 学生/课程/排课/收费/统计 | ✅ 已完成 (v3.1.1) |
| 📝 题库系统 | 知识点管理/组卷/练习/批改 | 🔲 待开发 |
| 🔧 教学工具 | 可插拔工具平台，无限接入新工具 | 🔲 待开发 |
| 💰 资产统计 | 收入支出/学员课时/财务报表 | 🔲 待开发 |
| 🔐 权限中心 | 管理员审核/模块权限/子权限 | 🔲 待开发 |

---

## 二、技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                   微信小程序 (Taro 3 + Vue 3 + TS)       │
│  ┌──────────┬──────────┬──────────┬──────────┬────────┐ │
│  │ 排课模块 │ 题库模块 │ 教学工具 │ 资产统计 │ 权限   │ │
│  └────┬─────┴────┬─────┴────┬─────┴────┬─────┴───┬────┘ │
│       └──────────┴──────────┴──────────┴─────────┘      │
│                    统一 API 网关层                        │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────┐
│                Nginx 反向代理 (阿里云)                    │
│           physicsedu.xyz/scheduling/ → :3001             │
│           physicsedu.xyz/question-bank/ → :3002          │
│           physicsedu.xyz/tools/ → :3003                  │
│           physicsedu.xyz/assets/ → :3004                 │
│           physicsedu.xyz/auth/ → :3001 (共享认证)        │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              API Gateway (Node.js + Express)             │
│  ┌─────────────────────────────────────────────────────┐│
│  │  JWT认证 → 权限校验 → 路由分发 → 模块服务           ││
│  └─────────────────────────────────────────────────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 排课服务 │ │ 题库服务 │ │ 工具服务 │ │ 资产服务 │  │
│  │ :3001    │ │ :3002    │ │ :3003    │ │ :3004    │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           共享层: DB / Auth / Permission          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 语言与框架选择

| 层 | 技术 | 理由 |
|---|---|---|
| **小程序** | Taro 3 + Vue 3 + TypeScript | 已有基础，跨端能力，组件化 |
| **API Gateway** | Node.js + Express | 已有基础，与小程序同语言，JSON原生 |
| **排课模块** | Node.js + Express + SQLite | 已完成，保持不变 |
| **题库模块** | Node.js + Express + SQLite | 共享技术栈，题库逻辑不需要特殊依赖 |
| **教学工具服务** | Node.js + Express (插件宿主) | 工具插件运行时加载，需Node.js |
| **资产统计** | Node.js + Express + SQLite | 复用现有基础设施 |
| **认证/权限** | Node.js (中间件层) | 嵌入Gateway，全局拦截 |
| **数据库** | SQLite (每个模块独立db文件) | 轻量部署，模块隔离，已验证 |
| **未来可选** | PostgreSQL / Redis | 用户量增长后平滑迁移 |

### 2.3 为什么选 Node.js 全栈而非混合语言

1. **已有基础**：排课模块已用 Node.js + Express 验证可行
2. **共享代码**：前后端共享 TypeScript 类型定义、验证逻辑、权限模型
3. **统一部署**：单机部署，PM2 管理，不需要 Docker Compose 编排多语言服务
4. **开发效率**：一个人维护，技术栈统一降低认知负担
5. **性能足够**：教育场景用户量有限（百级并发），Node.js 完全胜任
6. **迁移自由**：模块间通过 HTTP API 通信，未来任一模块可独立重写

---

## 三、目录结构

```
scheduling-system/                    # 根项目 (monorepo)
├── package.json                      # 根配置 + workspaces
├── gateway/                          # API Gateway (统一入口)
│   ├── src/
│   │   ├── app.js                    # Express 主应用
│   │   ├── middleware/
│   │   │   ├── auth.js               # JWT 认证中间件
│   │   │   ├── permission.js         # 权限校验中间件 (支持 user_type 级别)
│   │   │   ├── rateLimiter.js        # 限流
│   │   │   └── errorHandler.js       # 统一错误处理
│   │   ├── routes/
│   │   │   ├── auth.js               # 登录/注册/Token刷新/邀请码注册
│   │   │   ├── permissions.js        # 权限管理 API
│   │   │   ├── invitations.js        # 邀请管理 (创建/查询/撤销邀请码)
│   │   │   ├── admin.js              # 管理员 API (用户管理/权限分配)
│   │   │   └── modules.js            # 模块注册/发现
│   │   ├── config/
│   │   │   ├── modules.json          # 模块注册表
│   │   │   └── permissions.json      # 权限定义表
│   │   └── db/
│   │       ├── gateway.db            # 用户/角色/权限/邀请数据库
│   │       └── schema.sql
│   ├── package.json
│   └── Dockerfile
│
├── modules/                          # 功能模块目录
│   ├── scheduling/                   # 排课管理 (已迁移)
│   │   ├── src/
│   │   │   ├── routes/               # API路由
│   │   │   ├── models/               # 数据模型
│   │   │   └── services/             # 业务逻辑
│   │   ├── db/                       # 模块独立数据库
│   │   ├── tests/                    # 模块测试
│   │   └── package.json
│   │
│   ├── question-bank/                # 题库系统
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── questions.js      # 题目 CRUD
│   │   │   │   ├── categories.js     # 知识点分类
│   │   │   │   ├── papers.js         # 试卷管理
│   │   │   │   ├── practice.js       # 练习记录
│   │   │   │   └── grading.js        # 自动批改
│   │   │   ├── models/
│   │   │   │   ├── question.js       # 题目模型 (支持多题型)
│   │   │   │   ├── category.js       # 知识点树
│   │   │   │   └── paper.js          # 试卷模型
│   │   │   └── services/
│   │   │       ├── paperGenerator.js # 智能组卷
│   │   │       └── grader.js         # 批改引擎
│   │   ├── db/
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── teaching-tools/               # 教学工具平台
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   └── tools.js          # 工具发现/执行 API
│   │   │   ├── pluginLoader.js       # 插件加载器
│   │   │   ├── pluginRegistry.json   # 已注册工具列表
│   │   │   └── sandbox.js            # 工具沙箱执行环境
│   │   ├── plugins/                  # 工具插件目录
│   │   │   ├── wave-simulator/       # 机械波演示 (已有)
│   │   │   │   ├── plugin.json       # 插件元数据
│   │   │   │   ├── index.js          # 插件入口
│   │   │   │   ├── ui/               # 前端页面
│   │   │   │   └── package.json
│   │   │   ├── circuit-simulator/    # 电路模拟 (示例)
│   │   │   └── _template/            # 新工具模板
│   │   ├── tests/
│   │   └── package.json
│   │
│   └── assets/                       # 资产统计
│       ├── src/
│       │   ├── routes/
│       │   │   ├── income.js         # 收入管理
│       │   │   ├── expense.js        # 支出管理
│       │   │   ├── studentAssets.js  # 学员课时/余额
│       │   │   └── reports.js        # 报表生成
│       │   ├── models/
│       │   └── services/
│       ├── db/
│       ├── tests/
│       └── package.json
│
├── shared/                           # 共享库
│   ├── types/                        # TypeScript 类型定义
│   │   ├── user.ts                   # 用户/角色类型
│   │   ├── permission.ts             # 权限类型
│   │   └── module.ts                 # 模块注册类型
│   ├── validators/                   # 共享验证逻辑
│   └── utils/                        # 通用工具函数
│
├── miniapp/                          # 微信小程序 (Taro)
│   └── src/
│       ├── app.config.ts             # 路由配置 (动态加载模块页面)
│       ├── app.tsx                   # 主入口
│       ├── core/                     # 核心框架
│       │   ├── moduleLoader.ts       # 模块页面注册器
│       │   ├── auth.ts               # 认证服务
│       │   ├── permission.ts         # 权限检查 composable
│       │   └── api.ts                # 统一 API 调用层
│       ├── modules/                  # 模块页面 (每个模块独立目录)
│       │   ├── scheduling/           # 排课管理页面
│       │   ├── question-bank/        # 题库页面
│       │   ├── teaching-tools/       # 教学工具页面
│       │   └── assets/               # 资产统计页面
│       ├── components/               # 全局共享组件
│       │   ├── PermissionGate.vue    # 权限守卫组件
│       │   ├── ModuleCard.vue        # 模块入口卡片
│       │   └── TabBar.vue            # 底部导航
│       └── pages/                    # 平台页面
│           ├── login/                # 登录
│           ├── invite/               # 邀请码输入 (被邀请者注册)
│           ├── home/                 # 首页 (模块入口，按权限动态显示)
│           ├── profile/              # 个人中心
│           └── admin/                # 管理后台
│               ├── users/            # 用户管理 (列表/角色设置)
│               ├── invitations/      # 邀请管理 (创建/查询/撤销)
│               └── permissions/      # 权限分配 (按用户/按模块)
│
├── scripts/                          # 运维脚本
│   ├── deploy.sh                     # 部署脚本
│   ├── migrate.js                    # 数据库迁移
│   └── seed.js                       # 测试数据
│
└── tests/                            # 集成测试
    ├── gateway.test.js
    ├── permission.test.js
    └── modules/
```

---

## 四、权限系统设计

### 4.1 数据模型

```sql
-- ===================== 用户表 =====================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  openid TEXT UNIQUE,                    -- 微信 openid (教师/学生登录用)
  phone TEXT,
  name TEXT NOT NULL,
  avatar TEXT,
  user_type TEXT NOT NULL DEFAULT 'student',  -- 'admin' | 'teacher' | 'student' | 'invited'
  status INTEGER DEFAULT 1,             -- 1:正常 0:禁用
  invited_by TEXT,                       -- 邀请人ID (仅 invited 类型)
  invite_code TEXT,                      -- 邀请码 (仅 invited 类型)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===================== 用户类型说明 =====================
-- admin:     超级管理员，最高权限，可审核/授权/邀请
-- teacher:   教师，通过微信登录，权限由管理员分配
-- student:   学生，通过微信登录，权限由管理员分配
-- invited:   被邀请者，管理员邀请并分配权限，可访问资产等敏感模块
--
-- 共享用户池：题库、教学工具、排课共用同一套用户体系
-- 学生/教师 在各模块中为同一用户，数据互通

-- ===================== 模块注册表 =====================
CREATE TABLE modules (
  id TEXT PRIMARY KEY,                   -- 'scheduling', 'question-bank', ...
  name TEXT NOT NULL,                    -- 显示名称
  description TEXT,
  icon TEXT,
  route_prefix TEXT NOT NULL,            -- API路由前缀
  sort_order INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,             -- 1:启用 0:关闭
  created_at TEXT NOT NULL
);

-- ===================== 权限定义表 =====================
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,                   -- 'scheduling:view', 'scheduling:edit', 'question-bank:view'
  module_id TEXT NOT NULL,               -- 所属模块
  sub_module TEXT,                       -- 子模块 (如 'students', 'courses')
  action TEXT NOT NULL,                  -- 'view' | 'edit' | 'delete' | 'export' | 'admin'
  description TEXT,
  allowed_types TEXT DEFAULT '[]',       -- 允许的用户类型 JSON: ['admin','teacher','student','invited']
  is_default INTEGER DEFAULT 0,         -- 新用户默认权限
  FOREIGN KEY (module_id) REFERENCES modules(id)
);

-- ===================== 用户-模块权限表 =====================
CREATE TABLE user_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  granted_by TEXT,                       -- 授权人
  granted_at TEXT NOT NULL,
  expires_at TEXT,                       -- 过期时间 (可选)
  status INTEGER DEFAULT 1,             -- 1:有效 0:已撤销
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id),
  UNIQUE(user_id, permission_id)
);

-- ===================== 邀请记录表 =====================
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,             -- 邀请码
  invited_by TEXT NOT NULL,              -- 邀请人(管理员)
  target_name TEXT,                      -- 被邀请人姓名
  target_phone TEXT,                     -- 被邀请人手机
  permissions TEXT DEFAULT '[]',         -- 预分配权限列表 JSON
  status INTEGER DEFAULT 0,             -- 0:待使用 1:已使用 2:已过期
  expires_at TEXT NOT NULL,              -- 过期时间
  used_by TEXT,                          -- 使用者ID
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invited_by) REFERENCES users(id)
);
```

### 4.2 权限矩阵

#### 用户类型定义

| 类型 | 标识 | 来源 | 说明 |
|------|------|------|------|
| 管理员 | `admin` | 系统预设 | 最高权限，可审核/授权/邀请，全模块访问 |
| 教师 | `teacher` | 微信登录 | 由管理员分配权限，可使用排课/题库/教学工具 |
| 学生 | `student` | 微信登录 | 由管理员分配权限，可使用排课/题库/教学工具 |
| 被邀请者 | `invited` | 管理员邀请 | 管理员邀请并分配权限，可访问资产等敏感模块 |

#### 模块访问权限

```
模块              用户类型          view    edit    delete  admin   说明
──────────────────────────────────────────────────────────────────────────
排课管理          admin             ✓       ✓       ✓       ✓       完全控制
                  teacher           ✓       ✓       -       -       管理自己班级
                  student           ✓       -       -       -       只看自己的课
                  invited           ✓       ✓       -       -       可协助管理

题库系统          admin             ✓       ✓       ✓       ✓       完全控制
                  teacher           ✓       ✓       -       -       出题/批改
                  student           ✓       ✓       -       -       做题/查看成绩
                  invited           ✓       ✓       -       -       可参与题库管理

教学工具          admin             ✓       -       -       ✓       管理工具
                  teacher           ✓       -       -       -       使用工具
                  student           ✓       -       -       -       使用工具
                  invited           ✓       -       -       -       使用工具

资产统计          admin             ✓       ✓       -       ✓       完全控制
                  invited           ✓       ✓       -       -       协助管理资产
                  teacher           -       -       -       -       ❌ 无权限
                  student           -       -       -       -       ❌ 无权限
```

#### 核心规则

1. **管理员 (`admin`)**：跳过所有权限检查，全模块全操作
2. **教师/学生**：共享用户池，同一用户在排课/题库/教学工具中为同一身份
3. **被邀请者 (`invited`)**：由管理员通过邀请码创建，权限由管理员逐项分配，可访问资产模块
4. **资产模块隔离**：仅 `admin` 和 `invited` 可访问，教师/学生完全不可见
5. **权限继承**：管理员可在权限矩阵内自由分配，但不能给教师/学生分配资产模块权限

### 4.3 权限校验流程

```
请求进入 → JWT解析用户 → 识别 user_type
  → admin → 直接放行
  → 其他类型 → 查询 user_permissions 表
    → 有权限且有效 → 放行
    → 无权限 → 检查 allowed_types 是否包含该类型
      → 包含 → 放行 (类型级权限)
      → 不包含 → 拒绝 403
```

### 4.4 邀请流程

```
管理员 → 创建邀请码(预设权限+有效期) → 分享邀请码给被邀请者
被邀请者 → 小程序输入邀请码 → 微信登录绑定 → 自动获得预设权限
管理员 → 可随时调整被邀请者的权限
```

### 4.5 用户注册流程

```
教师/学生：微信授权登录 → 自动注册(user_type='student') → 等待管理员分配权限
被邀请者：输入邀请码 → 微信授权登录 → 自动注册(user_type='invited') → 获得预设权限
管理员：系统预设 或 后台手动设置
```

### 4.6 模块间用户数据打通

所有模块共享 Gateway 用户池：

```
Gateway Users Table
├── 学生张三 (user_type='student', id='stu_001')
│   ├── 排课模块: 关联到 student_id='stu_001'
│   ├── 题库模块: 关联到 user_id='stu_001'
│   └── 教学工具: 关联到 user_id='stu_001'
├── 教师李四 (user_type='teacher', id='tea_001')
│   ├── 排课模块: 关联到 teacher_id='tea_001'
│   ├── 题库模块: 关联到 user_id='tea_001'
│   └── 教学工具: 关联到 user_id='tea_001'
└── 被邀请者王五 (user_type='invited', id='inv_001')
    ├── 题库模块: 关联到 user_id='inv_001'
    ├── 教学工具: 关联到 user_id='inv_001'
    └── 资产统计: 关联到 user_id='inv_001'
```

各模块数据库中存储 `user_id` 外键引用 Gateway 用户表，不重复存储用户信息。

---

## 五、模块通信机制

### 5.1 模块间调用

模块间**不直接调用**，通过 Gateway 统一路由：

```
题库模块需要学生数据 → 请求 Gateway /api/scheduling/students → Gateway 转发到排课模块
```

### 5.2 跨模块数据引用

模块通过 `external_id` 引用其他模块的数据，不建立外键：

```json
// 试卷中引用排课模块的学生
{
  "paper_id": "xxx",
  "student_id": "stu_001",           // 本地存储
  "source_module": "scheduling",     // 数据来源模块
  "source_id": "stu_001"             // 原始ID
}
```

### 5.3 事件总线 (未来)

当模块间需要实时联动时，引入轻量事件总线：

```
排课完成 → 发布事件 'schedule.completed' → 题库模块接收 → 自动推送练习
```

当前阶段不需要，预留接口即可。

---

## 六、小程序模块化加载

### 6.1 模块注册机制

```typescript
// miniapp/src/core/moduleLoader.ts
interface ModuleDefinition {
  id: string;
  name: string;
  icon: string;
  pages: PageConfig[];
  tab?: boolean;           // 是否显示在 TabBar
  permission?: string;     // 所需权限
}

// 模块注册
const modules: ModuleDefinition[] = [
  {
    id: 'scheduling',
    name: '排课管理',
    icon: '📅',
    pages: [
      { path: '/pages/scheduling/index', name: '排课' },
      { path: '/pages/scheduling/students', name: '学生' },
      // ...
    ],
    tab: true,
    permission: 'scheduling:view'
  },
  {
    id: 'question-bank',
    name: '题库系统',
    icon: '📝',
    pages: [
      { path: '/pages/question-bank/index', name: '题库' },
      // ...
    ],
    permission: 'question-bank:view'
  }
];
```

### 6.2 动态 TabBar

根据用户权限动态生成底部导航：

```typescript
// 只显示用户有权限的模块Tab
const visibleTabs = modules.filter(m =>
  m.tab && hasPermission(m.permission)
);
```

### 6.3 教学工具的无限扩展

```typescript
// 每个教学工具是一个独立页面组件
// tools 页面通过列表展示所有已安装工具
// 点击工具 → 加载工具专属页面

// 工具定义 (plugin.json)
{
  "id": "wave-simulator",
  "name": "机械波演示",
  "icon": "🌊",
  "version": "1.0.0",
  "entry": "pages/wave-simulator/index",  // 小程序页面路径
  "backend": "/api/tools/wave-simulator",  // 可选后端API
  "permissions": ["teaching-tools:view"]
}
```

新增工具 = 新增一个 pages 目录 + 注册到 pluginRegistry.json，无需修改框架代码。

---

## 七、实施路线图

### Phase 0: 基础设施重构 (预计 2-3 天)

**目标**：将现有单体后端拆分为 Gateway + 独立模块，不改变功能

| 步骤 | 任务 | 交付物 | 验收标准 |
|------|------|--------|----------|
| 0.1 | 创建 monorepo 目录结构 | directories | 目录存在 |
| 0.2 | 提取 Gateway 骨架 | gateway/src/app.js | 启动无报错 |
| 0.3 | 实现 JWT 认证中间件 | gateway/middleware/auth.js | Token 签发/验证通过 |
| 0.4 | 实现权限校验中间件 | gateway/middleware/permission.js | 权限表设计+校验通过 |
| 0.5 | 迁移排课模块到 modules/scheduling/ | modules/scheduling/ | API 全部正常 |
| 0.6 | 创建用户/权限数据库 | gateway/db/ | 表结构创建成功 |
| 0.7 | Nginx 配置更新 | /etc/nginx/conf.d/ | 所有路由可达 |

**验收方式**：
```bash
# 启动 Gateway
node gateway/src/app.js
# 测试认证
curl -X POST /api/auth/login -d '{"phone":"xxx"}'
# 测试排课模块
curl -H "Authorization: Bearer xxx" /api/scheduling/students
```

### Phase 1: 权限系统 (预计 2 天)

**目标**：完整的 RBAC 权限管理，管理员可分配权限

| 步骤 | 任务 | 交付物 |
|------|------|--------|
| 1.1 | 权限定义表种子数据 (含 user_type 限制) | modules.json + permissions.json |
| 1.2 | 管理员 API (用户列表/角色设置/权限分配) | /api/admin/* |
| 1.3 | 邀请码 API (创建/查询/撤销/使用邀请码) | /api/invitations/* |
| 1.4 | 用户类型校验中间件 (资产模块仅 admin+invited) | middleware/typeGuard.js |
| 1.5 | 小程序端权限守卫组件 (支持 user_type) | PermissionGate.vue |
| 1.6 | 小程序端管理后台 (用户管理+邀请管理) | /pages/admin/* |
| 1.7 | 小程序端邀请码输入页面 | /pages/invite/* |

### Phase 2: 题库系统 (预计 4-5 天)

**目标**：支持多题型的题库管理 + 组卷 + 练习

| 步骤 | 任务 | 交付物 |
|------|------|--------|
| 2.1 | 题库数据库设计 + Schema | modules/question-bank/db/ |
| 2.2 | 题目 CRUD API (支持：选择/填空/判断/计算/问答) | /api/question-bank/questions |
| 2.3 | 知识点分类树 API | /api/question-bank/categories |
| 2.4 | 试卷管理 API (手动组卷/智能组卷) | /api/question-bank/papers |
| 2.5 | 练习模块 API (答题/记录/统计) | /api/question-bank/practice |
| 2.6 | 自动批改引擎 (选择/填空/判断) | services/grader.js |
| 2.7 | 小程序：题目浏览/搜索页面 | /pages/question-bank/* |
| 2.8 | 小程序：练习/答题页面 | /pages/question-bank/practice |
| 2.9 | 小程序：试卷查看/批改结果页面 | /pages/question-bank/grading |
| 2.10 | Excel 批量导入题目 | /api/question-bank/import |

### Phase 3: 教学工具平台 (预计 3-4 天)

**目标**：可插拔的工具平台，新工具零框架修改即可接入

| 步骤 | 任务 | 交付物 |
|------|------|--------|
| 3.1 | 插件加载器 + 注册机制 | pluginLoader.js |
| 3.2 | 工具 API (发现/执行/配置) | /api/tools/* |
| 3.3 | 工具沙箱环境 (安全执行) | sandbox.js |
| 3.4 | 迁移「机械波演示」为第一个插件 | plugins/wave-simulator/ |
| 3.5 | 创建新工具模板 | plugins/_template/ |
| 3.6 | 小程序：工具列表/启动页面 | /pages/teaching-tools/* |
| 3.7 | 小程序：工具渲染 WebView 容器 | ToolRenderer.vue |

### Phase 4: 资产统计 (预计 3 天)

**目标**：财务收支管理 + 学员课时统计

| 步骤 | 任务 | 交付物 |
|------|------|--------|
| 4.1 | 资产数据库设计 | modules/assets/db/ |
| 4.2 | 收入管理 API (学费/课时费) | /api/assets/income |
| 4.3 | 支出管理 API (房租/工资/耗材) | /api/assets/expense |
| 4.4 | 学员课时/余额统计 | /api/assets/student-assets |
| 4.5 | 报表生成 API (日/周/月/年) | /api/assets/reports |
| 4.6 | 小程序：收支记录页面 | /pages/assets/* |
| 4.7 | 小程序：统计图表页面 | /pages/assets/charts |

### Phase 5: 整合优化 (预计 2 天)

| 步骤 | 任务 |
|------|------|
| 5.1 | 首页模块入口设计 (卡片式) |
| 5.2 | 统一导航 + 模块切换动画 |
| 5.3 | 全局搜索 (跨模块) |
| 5.4 | 消息通知系统 |
| 5.5 | 性能优化 + 缓存策略 |
| 5.6 | 完整测试 + 部署 |

---

## 八、新增教学工具的标准流程

当需要接入一个新教学工具时：

```
1. 复制 plugins/_template/ → plugins/[new-tool]/
2. 编辑 plugin.json (名称/描述/权限/路由)
3. 实现 index.js (工具逻辑)
4. 如需前端页面，在 ui/ 目录开发
5. 注册到 pluginRegistry.json
6. 小程序自动发现并展示
```

**plugin.json 标准格式**：
```json
{
  "id": "circuit-simulator",
  "name": "电路模拟器",
  "description": "交互式电路搭建与仿真",
  "version": "1.0.0",
  "author": "physicsedu",
  "icon": "⚡",
  "permissions": ["teaching-tools:view"],
  "backend": {
    "enabled": true,
    "routes": ["simulate", "components"]
  },
  "frontend": {
    "entry": "ui/index.html",
    "height": "600px"
  }
}
```

---

## 九、部署架构

```
阿里云 ECS (39.106.172.132)
├── Nginx (Docker)
│   ├── /scheduling/   → :3001 (Gateway + 排课)
│   ├── /question-bank/ → :3002 (题库模块)
│   ├── /tools/        → :3003 (教学工具)
│   └── /assets/       → :3004 (资产统计)
│
├── PM2 进程管理
│   ├── gateway (Node.js) → :3001
│   ├── question-bank (Node.js) → :3002
│   ├── teaching-tools (Node.js) → :3003
│   └── assets-service (Node.js) → :3004
│
├── 数据文件
│   ├── /data/gateway.db
│   ├── /data/scheduling.db
│   ├── /data/question-bank.db
│   └── /data/assets.db
│
└── Docker
    └── nginx (已有)
```

**渐进式部署**：Phase 0 完成后先在 :3001 上跑 Gateway + 排课（合并进程），后续模块逐个独立部署。

---

## 十、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| SQLite 并发写入瓶颈 | 用户量增长后性能下降 | 模块独立db文件分散压力；未来迁移 PostgreSQL |
| 模块间数据一致性 | 跨模块引用数据不同步 | external_id 引用 + 定期校验脚本 |
| 微信小程序包大小限制 (2MB) | 模块页面过多 | 分包加载 (subpackages)，教学工具用 WebView |
| 单机部署单点故障 | 服务器宕机全线停摆 | 定期备份 + 数据库文件可快速迁移 |
| 权限系统过于复杂 | 管理员不愿用 | 提供「一键授权」预设角色模板 |

---

## 十一、快速开始命令

```bash
# Phase 0 执行
cd C:\Users\83423\.openclaw\workspace\scheduling-system

# 1. 创建目录结构
mkdir gateway\src\middleware, gateway\src\routes, gateway\src\db, gateway\src\config
mkdir modules\scheduling, modules\question-bank, modules\teaching-tools, modules\assets
mkdir shared\types, shared\validators, shared\utils

# 2. 初始化 Gateway
cd gateway && npm init -y && npm install express cors jsonwebtoken bcryptjs better-sqlite3

# 3. 迁移现有排课代码到 modules/scheduling/
# (从 backend/src/ 复制 routes/ + database.js + schema.sql)
```
