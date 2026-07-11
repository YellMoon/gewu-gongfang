# 统一角色与数据权限验证记录（2026-07-12）

## 结论

- 运行时权限体系仅保留 `super_admin`、`admin`、`teacher`、`student`、`pending`；固定手机号 `13732250653` 为不可停用的超级管理员。
- 普通管理员无 `users:review`；老师绑定唯一 `teacher_id`，业务快照和同步数据按该身份裁剪；学生保持本人范围；待审核用户无业务能力。
- 题库为公共数据域，老师可查看和编辑；已提交到题库盘的试题仅可信本地数据主机桌面端可删除，其他端只能管理同步前的本机草稿。
- 菜单结构管理页面、邀请码页面、邀请授权和任意模块授权矩阵均已从运行时界面移除。

## 自动化验证

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过，包含权限、同步范围、手机号认证、题库删除矩阵、遗留体系扫描及 UI 回归 |
| `npm run build` | 通过，桌面生产构建成功 |
| `npm --prefix miniapp run typecheck` | 通过 |
| `npm run miniapp:release-check` | 通过，微信小程序构建成功 |
| `npm --prefix miniapp run build:h5` | 通过，用于真实 H5 运行时验证 |

测试覆盖固定超级管理员审核、普通管理员拒绝、老师数据隔离、学生范围、待审核拒绝、手机号并发绑定、授权降级刷新、题库提交后删除限制与请求竞态。

## 运行时验证

### 桌面端

- URL：`http://localhost:3010/`，真实 React 开发运行时。
- 路径：展开侧栏 → 系统与数据 → 权限管理。
- 页面身份、非空渲染、搜索/角色/状态筛选控件、空态和 API 错误态均可见；“菜单结构管理”不存在。
- 首次截图发现 JSX 字面 Unicode 转义，随后提交 `23b84ce` 修复；复验 DOM 不再包含字面 `\uXXXX`。
- 浏览器环境没有 Electron bridge，因此用户 API 显示预期错误态，控制台仅有“Electron API is not available”的已解释开发浏览器警告；真实身份审核交互由 backend/gateway HTTP 测试覆盖。

截图：

- `C:\Users\83423\AppData\Local\Temp\gewu-unified-auth-2026-07-12\desktop-permission-error-state.png`

### 小程序 H5

- URL：`http://127.0.0.1:3011/#/pages/login/index`，Taro H5 产物通过本地 HTTP 运行。
- 登录页非空、无框架错误覆盖层、无控制台错误；微信一键登录控件可见。
- 本地运行时没有微信手机号凭证，未伪造登录或真实账号数据；超级管理员/普通管理员/老师/学生/待审核状态由注入式授权会话测试、真实 HTTP 权限契约测试和全页面 coverage 验证。
- 浏览器临时移动视口截图返回白图，但 DOM 仍非空；恢复默认视口后截图正常，记录为工具限制，不作为页面失败。

截图：

- `C:\Users\83423\AppData\Local\Temp\gewu-unified-auth-2026-07-12\miniapp-h5-login-default.png`

## 残留审计

- `gateway/src/app.js` 的旧邀请码使用路由仅保留 `410 Gone` 兼容墓碑，不能创建授权或写入权限。
- `gateway/src/db/schema.sql` 中 `invite_code` 仅为旧数据库兼容字段，运行时权限决策不读取它。
- 旧 grant/invitation 表只为加法迁移与回滚保留；遗留运行时扫描测试禁止界面、导航、本地授权存储和写入端点重新出现。

## 数据与回滚

- 修改前生产数据库备份：`/root/scheduling-data/prod/scheduling-pre-unified-auth-20260711-204817.db`（692224 bytes）。
- 数据库变更均为加法迁移；代码可通过版本提交回滚，旧授权表不会在新运行时参与决策。
