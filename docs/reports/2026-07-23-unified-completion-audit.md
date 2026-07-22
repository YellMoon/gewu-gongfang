# 2026-07-23 历史任务与统一发布完成度审计

审计基线：`gewu/master` 本地远程引用 `84fa2bf`；当前工作分支包含 OpenCode PR #3、#4、#5 的合并提交，以及本轮桌面单人模式修复。结论只能由代码、自动化测试和运行时/发布证据共同支持。

## PR 与工作树结论

- GitHub PR #3（未认可学生体验）、#4（体系级联删除）、#5（主机 OSS feed 隔离）均已合并；合并提交分别为 `5356cfa`、`9a79ca2`、`3c4df4e`，且全部是当前分支祖先。
- `git fetch gewu --prune` 因本机 SSH 22 端口连接被关闭而失败；合并状态通过 GitHub API 复核，没有把失败的 fetch 记为成功。
- `.codex-task-handoff/`、`.playwright-cli/`、`dist-host/`、`output/` 和 `scripts/inspect-paper-template.py` 属于既有未跟踪内容，本轮不删除、不覆盖、不纳入提交。

## 证据矩阵

| 要求 | 代码证据 | 测试证据 | 运行时/发布证据 | 当前结论 |
|---|---|---|---|---|
| 体系可增删改并同步试题标注 | `src/components/TaxonomyManager.tsx`、`src/services/taxonomyFilter.mjs`、`backend/src/services/questionBankService.js`、同步实体清单 | `npm run test:taxonomy` 退出 0；覆盖非物理空体系、增改名、标注保持、包含/排除筛选 | 隔离桌面页面显示统一“体系”、动态知识点/模型筛选；`tmp/ui-smoke/question-bank-preview.png` | `proved` |
| 二次确认后级联删除、备份、审计与恢复 | 后端删除影响预览、事务级联、`taxonomy_deletion_backups`、`operation_audit_log`；浏览器本地同等备份/审计 | `questionBankService.test.js` 覆盖影响数量、确认值变化、事务回滚、备份、审计、一次恢复 | 隔离桌面真实渲染显示影响试题/节点数量、备份审计说明和危险确认；`tmp/ui-smoke/question-bank-taxonomy-delete-confirm.png` | `proved` |
| 普通包无数据主机权限 | `desktopBuildFlavor.js`、ordinary `build.files` 排除三项主机私有模块、host config 显式加入；发布门禁 fail closed | `npm run test:desktop-build-flavor`、`check:desktop-identity-release` 退出 0 | 源码边界已证；最终 6.3.0 ordinary 解包与启动检查待构建 | `incomplete` |
| 数据主机本地初始化、重设、迁移与恢复 | `singleUserDesktopIdentityService.js`、`primaryHostIdentityService.js`、恢复包交付链与 vault | `npm run test:primary-host`、`npm run test:desktop-identity` 退出 0；隔离 SQLite 在线副本完整性通过 | 旧版隔离 Electron 已验证密码重设/恢复包；本轮单人 host 安装版与当前主机升级待执行 | `incomplete` |
| 单人配对与手动同步、主机自动处理 | X25519 不透明配对信封、摘要码、原子消费、云中继、批次备份事务和冲突保留 | `npm run test:sync-identity`、`single-user-pairing-runtime-smoke.js` 退出 0；配对码和私钥不出 schema/日志/响应 | 当前权威库只读副本完成运行检查；最终 ordinary/host 双安装版启动和 feed 更新待执行 | `incomplete` |
| OSS 检查、下载、安装与 flavor 隔离 | `desktopUpdateClient.mjs`、`SystemSettings.tsx`、`electronShellPolicy.js`、ordinary/host feed 分离 | updater、发布脚本、shell policy、release readiness 测试退出 0 | 旧版 Electron 更新入口截图有效；6.3.0 双 feed 发布、下载摘要与当前主机安装待执行 | `incomplete` |
| 未认可学生管理员端与学生端 | 后端 membership/sandbox/firewall、miniapp 管理与学生体验页面、20 页 coverage 清单 | 完整 `npm test` 退出 0；后端拒绝矩阵和 UI coverage 均通过 | 既有真实微信/fixture 矩阵记录于 `output/miniapp-6.1.0-ui-coverage/`；本轮按规格冻结小程序，不构建、不上传 | `proved`（本轮发布 N/A） |
| 默认菜单与密码错误展示 | 生产 shell policy 移除 File/Edit 菜单；错误映射去除 IPC 包装和本地路径；只能重设不能找回旧明文 | shell/updater/identity gate 测试、typecheck 和 build 退出 0 | 旧版 Electron 密码重设与 updater 入口已有截图；最终包启动冒烟待执行 | `incomplete` |

## 当前主机只读基线

- 配置角色：`primary-host`；权威数据库与题库 manifest 存在。
- 权威库 `quick_check=ok`，当前 `users=2`、`questions=0`；体系、体系标注、体系删除备份/审计、单人 grant 和 active authorization 均为 0。
- 在线副本复制前后计数一致，SHA-256 `3b9f19014ef29594335f25ef815b8aa039c747106e467fdcfa0fc52fc9be55ca`；测试没有写生产目录。

## 发布前必须转为 proved 的项目

以下缺口不通过修改文档消除：构建 ordinary/host 两种 6.3.0 包并运行解包边界与 Electron 启动检查；备份并部署阿里云兼容后端；升级当前数据主机且保留数据库/题库/配置；发布并校验双 OSS feed；上传夸克并核验远端文件。完成后更新本矩阵和 `task.md`，再合并推送 `gewu/master`。

微信小程序明确为冻结状态：本轮不构建、不上传、不发布，不能宣称发布了新版小程序。
