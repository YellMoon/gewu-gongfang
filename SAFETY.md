# 格物工坊安全护栏

本项目允许在本机、移动硬盘、NAS、阿里云和微信小程序之间协同运行。因为本机同时可能运行 Codex 和其他 agent，任何会破坏数据、格式化磁盘、递归删除目录、重置同步队列的动作，都必须默认拒绝，只有在明确维护流程中才能继续。

## 危险操作默认规则

- 不直接执行 `Format-Volume`、`Clear-Disk`、`Remove-Item -Recurse` 等破坏性命令。
- 需要维护态的操作必须先申请 `maintenanceToken`。
- 每个危险操作必须生成一次性 `challenge`，操作者需要逐字确认后才能提交。
- `maintenanceToken` 和 `challenge` 都必须有有效期，且 `challenge` 只能使用一次。
- 审计日志不得记录令牌、确认词、密码等敏感内容。
- 磁盘级操作必须校验目标，不允许作用于系统盘、系统分区或未识别设备。

## 题库盘和数据盘边界

- 题库主存储盘必须能被识别为外接题库盘，例如当前 `GEWU_QB_SSD`。
- 题库根目录应包含 `GewuQuestionBank`，不能把整块系统盘或用户目录当作题库根目录。
- 热插拔检测只能用于发现和切换候选路径，不能自动格式化、清盘或删除数据。
- 后续如果需要格式化 SSD、迁移数据到 NAS、清理缓存，必须走维护态、确认词和审计日志。

## Agent 操作边界

- agent 可以执行读取、检测、测试、配置写入、代码修改、git commit/push。
- agent 不应自行扩大授权执行打包、上传夸克网盘、真实云部署或真实微信小程序发布。
- 当前用户已明确：阶段性目标完成时只需要 `git commit/push`，不需要打包和上传夸克网盘。
- 云部署和小程序发布需要部署环境、账号、密钥和用户确认齐备后再执行。

## 本项目落地方式

- 后端通过 `backend/src/services/safetyGuardService.js` 管理 `maintenanceToken`、一次性 `challenge`、目标磁盘校验和安全审计。
- 所有未来新增的格式化、清理、重置、迁移动作，应先接入该服务，再暴露 UI 或脚本入口。
- 测试文件 `backend/src/services/safetyGuardService.test.js` 和 `scripts/safetyPolicy.test.js` 会防止安全规则被无意删除。
