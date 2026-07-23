# 2026-07-23 历史任务与统一发布完成度审计

审计基线：`gewu/master` 本地远程引用 `84fa2bf`；当前工作分支包含 OpenCode PR #3、#4、#5 的合并提交，以及本轮桌面单人模式修复。结论只能由代码、自动化测试和运行时/发布证据共同支持。

## PR 与工作树结论

- GitHub PR #3（未认可学生体验）、#4（体系级联删除）、#5（主机 OSS feed 隔离）均已合并；合并提交分别为 `5356cfa`、`9a79ca2`、`3c4df4e`，且全部是当前分支祖先。
- `git fetch gewu --prune` 曾因本机 SSH 22 端口连接被关闭而失败；随后用正式仓库 HTTPS 地址刷新 `refs/remotes/gewu/master` 成功，仍为 `84fa2bf`。GitHub API 同时复核了 PR 合并状态，没有把失败的 SSH fetch 记为成功。
- `.codex-task-handoff/`、`.playwright-cli/`、`dist-host/`、`output/` 和 `scripts/inspect-paper-template.py` 属于既有未跟踪内容，本轮不删除、不覆盖、不纳入提交。

## 证据矩阵

| 要求 | 代码证据 | 测试证据 | 运行时/发布证据 | 当前结论 |
|---|---|---|---|---|
| 体系可增删改并同步试题标注 | `src/components/TaxonomyManager.tsx`、`src/services/taxonomyFilter.mjs`、`backend/src/services/questionBankService.js`、同步实体清单 | `npm run test:taxonomy` 退出 0；覆盖非物理空体系、增改名、标注保持、包含/排除筛选 | 隔离桌面页面显示统一“体系”、动态知识点/模型筛选；`tmp/ui-smoke/question-bank-preview.png` | `proved` |
| 二次确认后级联删除、备份、审计与恢复 | 后端删除影响预览、事务级联、`taxonomy_deletion_backups`、`operation_audit_log`；浏览器本地同等备份/审计 | `questionBankService.test.js` 覆盖影响数量、确认值变化、事务回滚、备份、审计、一次恢复 | 隔离桌面真实渲染显示影响试题/节点数量、备份审计说明和危险确认；`tmp/ui-smoke/question-bank-taxonomy-delete-confirm.png` | `proved` |
| 普通包无数据主机权限 | `desktopBuildFlavor.js`、ordinary `build.files` 排除三项主机私有模块、host config 显式加入；发布门禁 fail closed | `npm run test:desktop-build-flavor`、`check:desktop-identity-release` 退出 0 | 6.3.0 ordinary 解包边界与实际启动冒烟通过，输出 `flavor=desktop-client`；主机专属文件未进入普通包 | `proved` |
| 数据主机本地初始化、重设、迁移与恢复 | `singleUserDesktopIdentityService.js`、`primaryHostIdentityService.js`、恢复包交付链与 vault | `npm run test:primary-host`、`npm run test:desktop-identity` 退出 0；隔离 SQLite 在线副本完整性通过 | 6.3.0 host 包启动冒烟通过；但当前生产配置仍是 `desktop-client/full`，权威库没有 active epoch/authorization，覆盖安装与真实 bootstrap 尚未完成 | `incomplete` |
| 单人配对与手动同步、主机自动处理 | X25519 不透明配对信封、摘要码、原子消费、云中继、批次备份事务和冲突保留 | fresh `npm test`、`npm run test:sync-identity`、`single-user-pairing-runtime-smoke.js` 退出 0；配对码和私钥不出 schema/日志/响应 | 双 flavor 启动、隔离权威库运行检查与云中继公网合同通过；当前生产主机未 bootstrap，故尚无真实两机端到端记录 | `incomplete` |
| OSS 检查、下载、安装与 flavor 隔离 | `desktopUpdateClient.mjs`、`SystemSettings.tsx`、`electronShellPolicy.js`、ordinary/host feed 分离 | updater、发布脚本、shell policy、release readiness 测试退出 0 | 6.3.0 双 feed 已发布并公网回读；ordinary 为 `150672895` 字节，host 为 `150681078` 字节，文件名/SHA-512 与本地一致；当前主机安装仍待 UAC | `incomplete` |
| 未认可学生管理员端与学生端 | 后端 membership/sandbox/firewall、miniapp 管理与学生体验页面、20 页 coverage 清单 | 完整 `npm test` 退出 0；后端拒绝矩阵和 UI coverage 均通过 | 既有真实微信/fixture 矩阵记录于 `output/miniapp-6.1.0-ui-coverage/`；本轮按规格冻结小程序，不构建、不上传 | `proved`（本轮发布 N/A） |
| 默认菜单与密码错误展示 | 生产 shell policy 移除 File/Edit 菜单；错误映射去除 IPC 包装和本地路径；只能重设不能找回旧明文 | shell/updater/identity gate、fresh typecheck/build/全量测试退出 0 | 6.3.0 ordinary 与 host 最终包均完成真实 Electron 启动冒烟；旧版密码重设与 updater 入口截图仍有效 | `proved` |

## 当前主机只读基线

- 安装包 flavor 为 `primary-host`，但生产 runtime config 的实际角色是 `desktop-client`、身份模式为 `full`；`mainDbPath` 指向 D 盘权威库，题库路径指向 I 盘。该不一致是当前主机真实 bootstrap 尚未完成的直接证据，不能按 flavor 推断运行时权限。
- 权威库 `quick_check=ok`，当前 `users=2`、`questions=0`；体系、体系标注、体系删除备份/审计、单人 grant 和 active authorization 均为 0。
- 在线副本复制前后计数一致，SHA-256 `3b9f19014ef29594335f25ef815b8aa039c747106e467fdcfa0fc52fc9be55ca`；测试没有写生产目录。

## 2026-07-23 发布执行证据

- 本地主机发布前备份：`D:\GewuDataHost\backups\release-6.3.0-20260722-220909`；源库与备份库 `quick_check=ok`，配置/清单证据不记录凭证。
- 阿里云发布前备份：`/root/scheduling-backups/formula-pipeline/20260722-220910`；Backend/Gateway 代码与两套数据库已备份，两库 `quick_check=ok`。
- 阿里云 Backend/Gateway 已部署 6.3.0；内网 3002/3001 与公网 `/scheduling/api/health`、`/api/health` 均返回 6.3.0。首次 Backend 发布暴露了对桌面 `public/` 文件的错误依赖，部署失败后已将协议实现移入 standalone Backend、增加 fail-closed 门禁并重新部署成功。
- ordinary 与 host 两种 6.3.0 安装包、blockmap、`latest.yml` 均已生成；两种包实际启动冒烟通过。打包后已恢复 Node ABI 137，SQLite 3.53.1 查询通过。
- ordinary/host OSS feed 已正式发布并公网验证。夸克 `codex项目/2026-07-23` 已同页确认普通桌面安装包 `GewuGongfang-Desktop-6.3.0-x64.exe`；主机专属包按最小权限原则不作为普通网盘交付物，仅保留在隔离的 host OSS feed。
- fresh `npm test`、`npm run typecheck`、`npm run check:desktop-identity-release`、`git diff --check` 均退出 0。全量高负载曾触发网关本地 fixture 的 3 秒测试超时，测试专用上限放宽至 10 秒后完整套件通过；生产超时未改变。

## 当前唯一发布缺口

当前仍是“部分发布”：6.3.0 主机专版已覆盖安装，但生产核验发现并阻断了单人主机 bootstrap 前置条件循环；修复后的 6.3.1 已完成测试、云端部署、双 OSS feed 和夸克交付，本机仍需新的 UAC 确认覆盖安装 6.3.1，并由用户自行设定本机密码完成真实 bootstrap。安装、bootstrap、保数据复验成立前不得把主机/同步/OSS 安装项改为 `proved`，也不得合并推送 `gewu/master` 或宣称统一发布完成。

微信小程序明确为冻结状态：本轮不构建、不上传、不发布，不能宣称发布了新版小程序。

## 2026-07-23 6.3.1 bootstrap 修复与发布证据

- 根因：主机专版开启 `single-user` 后只更新身份模式，runtime 仍为 `desktop-client`；本地 bootstrap 路由和身份服务却要求 runtime 已是 `primary-host`，形成无法满足的循环。修复采用两阶段流程：仅主机 flavor + 单人模式 + Electron 回环本地桥可以进入候选初始化；权威库校验、在线备份和身份事务成功后才原子写入 host epoch；配置写失败可重复调用恢复，vault 完成后强制重启。
- 回归覆盖候选门禁、普通/非本地拒绝、事务后 runtime 写入、写入失败重试、单人主机无云端 host credential 的安全恢复，以及 renderer 完成本地 vault 后重启。fresh `npm test`、`npm run typecheck` 全部退出 0。
- 本地主机升级前备份：`D:\GewuDataHost\backups\release-6.3.1-20260722-234718`；源库与在线备份库 `quick_check=ok`。安装前再次只读核验为 `users=2`、`questions=0`、无 active epoch/authorization/grant。
- 阿里云发布前备份：`/root/scheduling-backups/formula-pipeline/20260722-234905`；Backend/Gateway 代码及两套 SQLite 已备份，两库 `quick_check=ok`。Backend/Gateway 内网与公网 health 均返回 6.3.1，云中继基础契约通过。
- ordinary/host 6.3.1 均完成隔离用户目录的真实 Electron 启动冒烟；包内 flavor 分别为 `desktop-client` / `primary-host`。普通安装包 `150673468` 字节，主机安装包 `150682142` 字节；打包后 Node ABI 137、SQLite 3.53.1 加载通过。
- ordinary/host OSS feed 已上传并公网回读，版本均为 6.3.1、Content-Length 与本地一致。夸克 `codex项目/2026-07-23/GewuGongfang-Desktop-6.3.1-x64.exe` 已在上传同页确认显示 143.7 MB、完成 1 项。
- 两种安装包保持相同 `appId=com.jvsclaw.gewugongfang` 和产品名“格物工坊”；变化仅是 artifact 文件名。生产配置仍指向 `D:\GewuDataHost\data\scheduling.db` 与 `I:\GewuQuestionBank`，安装器不会覆盖用户数据配置。
