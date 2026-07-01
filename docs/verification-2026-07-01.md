# 格物工坊后续验证记录

日期：2026-07-01  
范围：多端数据架构验证、小程序 UI 可视化验证、阿里云公网连通性、发布准备项和任务约束留痕。

## 1. 新增持续约束

已将以下长期要求写入 `AGENTS.md`，并同步到本地优先架构设计与实施计划：

- 架构目标保持为“指定本地数据主机 + 移动硬盘题库独立存储 + 多电脑离线编辑后授权同步 + 阿里云服务端中继 + 微信小程序只读/有限写入”。
- 本地数据主机保存全量权威业务数据，阿里云只做认证、设备、心跳、中继、快照、小程序 API 和任务队列。
- 其他电脑离线本地可写，但联网后必须经用户确认和授权后同步到本地数据主机。
- 微信小程序以只读为主，只允许财务个人资产导入、题库选题组卷、Word/PDF 导出等有限写入任务。
- 工作顺序为先验证底层架构，再逐步设计和优化微信小程序 UI，最后部署阿里云和小程序。
- 小程序 UI 优化不能只停留在首页；后续每一个小程序页面都必须逐页优化、逐页验证，并留下截图或检查记录。

## 2. 小程序 UI 与构建验证

已补齐 H5 预览依赖：

- `@tarojs/plugin-platform-h5@3.6.40`

验证结果：

| 项目 | 命令/方式 | 结果 |
| --- | --- | --- |
| H5 构建 | `npm --prefix miniapp run build:h5` | 通过，有 webpack 体积警告：`js/app.js` 255 KiB，入口 404 KiB |
| H5 首页可视化 | Playwright + 本地 H5 预览 + mock 登录态/API/本地缓存 | 通过 |
| 首页关键文案 | `格物工坊`、`运营面板`、`数据快照`、`核心入口`、`课程表`、`题库`、`财务`、`运营快捷入口` | 全部命中 |
| 首页统计 | 今日课程 `1`、今日收入 `¥280`、本月收入 `¥760`、学生总数 `3` | 命中 |
| 状态面板 | 快照时间 `07-01 16:30` | 已修复窄屏截断 |
| 控制台 | Playwright console/pageerror 捕获 | 无异常；仅有一个 404 静态资源请求，不影响首页渲染 |
| 微信小程序 release check | `npm run miniapp:release-check` | 通过 |

截图留痕：

- 移动端：首页 `C:\Users\83423\AppData\Local\Temp\gewu-qa\miniapp-home-mobile-after-status-fix.png`
- 桌面视口：首页 `C:\Users\83423\AppData\Local\Temp\gewu-qa\miniapp-home-desktop-after-status-fix.png`

说明：本次 UI 可视化只完成首页复核和局部修正；后续 UI 优化必须覆盖小程序全部页面，不能以首页优化作为完成标准。

## 3. 本地云中继验证

本地临时启动 gateway，使用本地测试 `JWT_SECRET` 签发 admin smoke token，执行：

```powershell
node scripts/check_cloud_relay.js http://127.0.0.1:4181
```

结果：通过。

覆盖链路：

- `/api/cloud/host/heartbeat`
- `/api/cloud/snapshots/publish`
- `/api/cloud/snapshots/read`
- `/api/cloud/tasks`
- `/api/cloud/tasks?status=pending_host`
- `/api/cloud/tasks/:id/complete`
- `/api/cloud/tasks/:id/result`

临时生成的 `gateway/data/gateway.db*` 已在路径校验后清理。

## 4. 本地存储与部署准备

| 项目 | 命令 | 结果 | 说明 |
| --- | --- | --- | --- |
| 本地存储 readiness | `node scripts/check_local_storage_readiness.js` | 未通过 | 当前机器缺少 `C:\Users\83423\AppData\Roaming\gewu-gongfang\gewugongfang.config.json` |
| 部署 readiness | `node scripts/check_deploy_readiness.js` | 未通过 | 缺少 `DEPLOY_HOST`、`BACKEND_JWT_SECRET`、`DEPLOY_PASSWORD or DEPLOY_KEY_PATH` |
| 小程序配置 | `node scripts/check_deploy_readiness.js` 内置检查 | 通过 | appid 为 `wx3d570539bbe6ba1b`，生产 API 为 `https://physicsedu.xyz/scheduling` |

结论：本地代码与小程序配置可继续验证；真实部署前需要补齐运行时配置和部署密钥/主机环境变量。

## 5. 阿里云公网连通性

检查结果：

- DNS：`physicsedu.xyz` 解析到 `39.106.172.132`。
- TCP：`39.106.172.132:443` 可连通。
- TCP：`39.106.172.132:3001` 不可连通。
- HTTPS：`https://physicsedu.xyz/scheduling/api/health` 连接被 reset。
- HTTP：`http://physicsedu.xyz/scheduling/api/health` 返回 `403 Forbidden`，页面标题为 `Non-compliance ICP Filing`。
- 后端端口直连：`http://39.106.172.132:3001/api/health` 超时，无法连接。

结论：当前公网问题不是前端构建问题；域名/备案/反向代理/TLS 和 3001 端口暴露需要在阿里云侧继续处理。

## 6. 完整测试

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 完整项目测试 | `npm test` | 通过 |
| 小程序发布检查 | `npm run miniapp:release-check` | 通过 |
| H5 可视化构建 | `npm --prefix miniapp run build:h5` | 通过，有体积警告 |

待收尾：

- 运行 `git diff --check`。
- 提交并推送到 `gewu/master`。
- 后续如继续 UI 优化，需要建立小程序全页面截图清单，而不是只验首页。
