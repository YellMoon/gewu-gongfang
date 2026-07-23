# 2026-07-23 历史任务与统一发布完成度审计

审计基线：功能与前序修复已快进合并到 `gewu/master` 的 `e1918b5`；当前收尾提交仅增加发布冒烟隔离门禁与本节最终证据。当前历史包含 OpenCode PR #3、#4、#5 的合并提交，以及本轮桌面单人模式和小程序手填手机号登录修复。结论只能由代码、自动化测试和运行时/发布证据共同支持。

## PR 与工作树结论

- GitHub PR #3（未认可学生体验）、#4（体系级联删除）、#5（主机 OSS feed 隔离）均已合并；合并提交分别为 `5356cfa`、`9a79ca2`、`3c4df4e`，且全部是当前分支祖先。
- `git fetch gewu --prune` 曾因本机 SSH 22 端口连接被关闭而失败；随后用正式仓库 HTTPS 地址刷新 `refs/remotes/gewu/master` 成功，仍为 `84fa2bf`。GitHub API 同时复核了 PR 合并状态，没有把失败的 SSH fetch 记为成功。
- `.codex-task-handoff/`、`.playwright-cli/`、`dist-host/`、`output/` 和 `scripts/inspect-paper-template.py` 属于既有未跟踪内容，本轮不删除、不覆盖、不纳入提交。

## 证据矩阵

| 要求 | 代码证据 | 测试证据 | 运行时/发布证据 | 当前结论 |
|---|---|---|---|---|
| 体系可增删改并同步试题标注 | `src/components/TaxonomyManager.tsx`、`src/services/taxonomyFilter.mjs`、`backend/src/services/questionBankService.js`、同步实体清单 | `npm run test:taxonomy` 退出 0；覆盖非物理空体系、增改名、标注保持、包含/排除筛选 | 隔离桌面页面显示统一“体系”、动态知识点/模型筛选；`tmp/ui-smoke/question-bank-preview.png` | `proved` |
| 二次确认后级联删除、备份、审计与恢复 | 后端删除影响预览、事务级联、`taxonomy_deletion_backups`、`operation_audit_log`；浏览器本地同等备份/审计 | `questionBankService.test.js` 覆盖影响数量、确认值变化、事务回滚、备份、审计、一次恢复 | 隔离桌面真实渲染显示影响试题/节点数量、备份审计说明和危险确认；`tmp/ui-smoke/question-bank-taxonomy-delete-confirm.png` | `proved` |
| 普通包无数据主机权限 | `desktopBuildFlavor.js`、ordinary `build.files` 排除三项主机私有模块、host config 显式加入；发布门禁 fail closed | `npm run test:desktop-build-flavor`、`check:desktop-identity-release` 退出 0 | 6.4.0 ordinary 解包边界与实际启动冒烟通过，输出 `flavor=desktop-client`；主机专属文件未进入普通包 | `proved` |
| 数据主机本地初始化、重设、迁移与恢复 | `singleUserDesktopIdentityService.js`、`primaryHostIdentityService.js`、恢复包交付链与 vault | `npm run test:primary-host`、`npm run test:desktop-identity` 退出 0；隔离 SQLite 在线副本完整性通过 | 6.3.2 已在当前数据主机完成真实 bootstrap、重启解锁与只读数据库复验；迁移/恢复继续以隔离库和协议测试验证，未对生产主机执行破坏性演练 | `proved` |
| 单人配对与手动同步、主机自动处理 | X25519 不透明配对信封、摘要码、原子消费、云中继、批次备份事务和冲突保留 | fresh `npm test`、`npm run test:sync-identity`、`single-user-pairing-runtime-smoke.js` 退出 0；配对码和私钥不出 schema/日志/响应 | 双 flavor 启动、隔离权威库运行检查与云中继公网合同通过；生产主机 active epoch generation 1 且云中继主机协议通过。未对用户业务库执行破坏性冲突演练 | `proved` |
| OSS 检查、下载、安装与 flavor 隔离 | `desktopUpdateClient.mjs`、`SystemSettings.tsx`、`electronShellPolicy.js`、ordinary/host feed 分离 | updater、发布脚本、shell policy、release readiness 与主机分支 UI 回归测试退出 0 | ordinary/host 6.4.0 均完成真实 Electron 冒烟；两条公网 `latest.yml` 和安装包返回 200，数据主机已覆盖安装 6.4.0 | `proved` |
| 手填手机号登录、未认可学生与微信绑定审核 | 后端登录状态机、绑定审核事务/审计/隐私留存；miniapp 手填登录、体验账号和管理员脱敏审核界面 | 身份服务、HTTP、运行时、UI coverage、typecheck 与 `ci:weapp` 均通过 | 普通管理员只读脱敏列表，超级管理员可批准/拒绝；微信开发者工具明确返回 6.4.0 `upload` 成功，上传包 953634 字节 | `proved` |
| 默认菜单与密码错误展示 | 生产 shell policy 移除 File/Edit 菜单；错误映射去除 IPC 包装和本地路径；只能重设不能找回旧明文 | shell/updater/identity gate、fresh typecheck/build/全量测试退出 0 | 6.4.0 ordinary 与 host 最终包均完成真实 Electron 启动冒烟；密码重设、标题布局、设备码隐藏和 updater 入口回归均通过 | `proved` |

## 当前主机只读基线

- 安装包 flavor 与生产 runtime config 现均为数据主机：`nodeRole=primary-host`、`desktopIdentityMode=single-user`、`deviceId=desktop_host_001`、generation 1；`mainDbPath` 仍指向 D 盘权威库，题库路径仍指向 I 盘。
- 权威库 `quick_check=ok`，当前 `users=2`、`questions=0`；恰有一个 active 主机 epoch 和一个 active `primary-host` 设备授权，来源为 `single_user_local_bootstrap`。登录挑战已消费，桌面会话有效，同一账号的超级管理员与老师角色授权均保留。
- 在线副本复制前后计数一致，SHA-256 `3b9f19014ef29594335f25ef815b8aa039c747106e467fdcfa0fc52fc9be55ca`；测试没有写生产目录。

## 2026-07-23 发布执行证据

- 本地主机发布前备份：`D:\GewuDataHost\backups\release-6.3.0-20260722-220909`；源库与备份库 `quick_check=ok`，配置/清单证据不记录凭证。
- 阿里云发布前备份：`/root/scheduling-backups/formula-pipeline/20260722-220910`；Backend/Gateway 代码与两套数据库已备份，两库 `quick_check=ok`。
- 阿里云 Backend/Gateway 已部署 6.3.0；内网 3002/3001 与公网 `/scheduling/api/health`、`/api/health` 均返回 6.3.0。首次 Backend 发布暴露了对桌面 `public/` 文件的错误依赖，部署失败后已将协议实现移入 standalone Backend、增加 fail-closed 门禁并重新部署成功。
- ordinary 与 host 两种 6.3.0 安装包、blockmap、`latest.yml` 均已生成；两种包实际启动冒烟通过。打包后已恢复 Node ABI 137，SQLite 3.53.1 查询通过。
- ordinary/host OSS feed 已正式发布并公网验证。夸克 `codex项目/2026-07-23` 已同页确认普通桌面安装包 `GewuGongfang-Desktop-6.3.0-x64.exe`；主机专属包按最小权限原则不作为普通网盘交付物，仅保留在隔离的 host OSS feed。
- fresh `npm test`、`npm run typecheck`、`npm run check:desktop-identity-release`、`git diff --check` 均退出 0。全量高负载曾触发网关本地 fixture 的 3 秒测试超时，测试专用上限放宽至 10 秒后完整套件通过；生产超时未改变。

## 最终发布结论

本轮适用端已统一发布完成：功能提交已合并正式仓库；阿里云 Backend/Gateway、微信小程序、ordinary/host 双 OSS feed 和本机数据主机均为 6.4.0；普通桌面安装包已交付夸克。其他电脑仍按既定规则只通过 ordinary OSS feed 自助更新。

微信小程序 6.4.0 已完成本地发布检查和微信开发者工具上传；企业主体与正式审核发布仍属于平台后续流程，不影响本次开发版本上传结论。

## 2026-07-23 6.3.1 bootstrap 修复与发布证据

- 根因：主机专版开启 `single-user` 后只更新身份模式，runtime 仍为 `desktop-client`；本地 bootstrap 路由和身份服务却要求 runtime 已是 `primary-host`，形成无法满足的循环。修复采用两阶段流程：仅主机 flavor + 单人模式 + Electron 回环本地桥可以进入候选初始化；权威库校验、在线备份和身份事务成功后才原子写入 host epoch；配置写失败可重复调用恢复，vault 完成后强制重启。
- 回归覆盖候选门禁、普通/非本地拒绝、事务后 runtime 写入、写入失败重试、单人主机无云端 host credential 的安全恢复，以及 renderer 完成本地 vault 后重启。fresh `npm test`、`npm run typecheck` 全部退出 0。
- 本地主机升级前备份：`D:\GewuDataHost\backups\release-6.3.1-20260722-234718`；源库与在线备份库 `quick_check=ok`。安装前再次只读核验为 `users=2`、`questions=0`、无 active epoch/authorization/grant。
- 阿里云发布前备份：`/root/scheduling-backups/formula-pipeline/20260722-234905`；Backend/Gateway 代码及两套 SQLite 已备份，两库 `quick_check=ok`。Backend/Gateway 内网与公网 health 均返回 6.3.1，云中继基础契约通过。
- ordinary/host 6.3.1 均完成隔离用户目录的真实 Electron 启动冒烟；包内 flavor 分别为 `desktop-client` / `primary-host`。普通安装包 `150673468` 字节，主机安装包 `150682142` 字节；打包后 Node ABI 137、SQLite 3.53.1 加载通过。
- ordinary/host OSS feed 已上传并公网回读，版本均为 6.3.1、Content-Length 与本地一致。夸克 `codex项目/2026-07-23/GewuGongfang-Desktop-6.3.1-x64.exe` 已在上传同页确认显示 143.7 MB、完成 1 项。
- 两种安装包保持相同 `appId=com.jvsclaw.gewugongfang` 和产品名“格物工坊”；变化仅是 artifact 文件名。生产配置仍指向 `D:\GewuDataHost\data\scheduling.db` 与 `I:\GewuQuestionBank`，安装器不会覆盖用户数据配置。

## 2026-07-23 6.3.2 主进程接线与设备 ID 展示修复证据

- 生产复现：6.3.1 点击二次确认后弹窗不关闭，配置仍为 `desktop-client/full`；主进程日志明确记录 `single-user:enable-mode` 返回 `PRIMARY_HOST_RUNTIME_MANAGER_CONFIG_REQUIRED`，没有身份表写入或密码页跳转。
- 根因：`createPrimaryHostRuntimeManager` 已要求 `writeManagedDesktopIdentityMode`，但 `public/electron.js` 没有从 `runtimeConfig` 导入，也没有在创建管理器时注入。回归测试先以“Electron 必须导入并注入该依赖”失败，再补两处最小接线并通过。
- 用户界面规则：固定设备 ID 不再作为可编辑设备名回填身份验证页，也从普通系统设置移除；只在“身份与设备”中心以只读元数据显示。普通设备的一次性配对码仍是必要输入凭据，但使用密码型输入框默认掩码。
- fresh `npm test`、`npm run typecheck`、ordinary/host 隔离真实 Electron 启动冒烟全部退出 0；包内 flavor 分别为 `desktop-client` / `primary-host`，主机包内 Electron 文件包含身份模式写入依赖的导入和注入。
- 6.3.2 普通安装包 `150673858` 字节，主机安装包 `150682220` 字节；主机包 SHA-256 为 `5DD7C497F0C772BBA21E7B7023CA56BEC3BCFAD6C1EA5A3510B13ABD60A61FF3`。
- 安装前备份为 `D:\GewuDataHost\backups\release-6.3.2-20260723-093743`；源库与备份库均 `quick_check=ok`、`users=2`、`questions=0`。6.3.2 已覆盖安装并完成真实 bootstrap，数据路径和题库 storeId 未改变。
- 当前生产配置为 `primary-host/single-user`，active epoch generation 为 1；active authorization 的 `device_kind=primary-host`、`authorization_source=single_user_local_bootstrap`、`credential_version=1`。重启密码登录挑战/交换、云端心跳与任务轮询均返回 200。
- 数据主机更新面板最初只挂载在普通桌面分支；真实页面复核发现后，以失败 UI 回归锁定并在主机分支补挂载。用户已确认看到 OSS 更新模块；公网 host feed `latest.yml` 返回 200、当前版本 6.3.1，且只指向主机专用安装包。

## 2026-07-23 6.4.0 手填手机号登录与统一发布证据

- 登录安全状态机已发布：已绑定 openid 且手机号相符可直接登录；新 openid + 新手机号进入未认可体验身份；新 openid + 既有未绑定用户进入微信绑定待审；手机号已绑定其他 openid 时拒绝。旧 `phoneCode` 路径继续兼容。
- 绑定审核由超级管理员批准或拒绝，普通管理员仅查看脱敏记录；事务、幂等、审计和隐私留存测试均通过。fresh `npm test` 退出 0，覆盖小程序身份、HTTP、权限、UI coverage、桌面身份、同步和题库体系。
- 云端发布前备份为 `/root/scheduling-backups/unified-release/20260723-135533`，Backend/Gateway 代码及两套 SQLite 均生成 SHA-256，两套源库和备份库 `quick_check=ok`。Backend/Gateway 内网与公网 health 均返回 6.4.0，云中继主机协议和匿名边界检查通过。
- 小程序从 `miniapp/dist` 的 111 个文件通过 release check；微信开发者工具返回 `√ upload`，6.4.0 上传包总大小 953634 字节。
- ordinary 安装包 `GewuGongfang-Desktop-6.4.0-x64.exe` 为 150685745 字节，host 安装包 `GewuGongfang-PrimaryHost-6.4.0-x64.exe` 为 150693969 字节。两种解包 flavor 启动冒烟通过，普通包不含主机专属运行文件；两条 OSS feed 与安装包公网均返回 200。
- 本地主机升级前备份为 `D:\GewuDataHost\backups\release-6.4.0-20260723-135335`，源库和备份库 `quick_check=ok`。6.4.0 主机专版已静默覆盖安装，真实本机 health 返回 6.4.0；配置仍为 `primary-host/single-user`，D 盘权威库、I 盘题库及 `storeId` 未变，active 主机 epoch 仍为 generation 1，`users=2`、`questions=0`。
- 发布冒烟曾复用真实用户目录并触发普通 flavor 的防御逻辑改写生产角色配置；已从发布前备份恢复，异常配置副本保留在同一备份目录。冒烟脚本现强制使用独立临时 `--user-data-dir`，等待进程退出后清理，并以回归测试和生产配置哈希不变证明不会再次污染真实配置。
- 夸克 `codex项目/2026-07-23` 同页确认 `GewuGongfang-Desktop-6.4.0-x64.exe`，页面显示 143.7 MB、上传完成 1 项。主机专版仅保留在隔离 host OSS feed，未作为普通桌面交付物上传。
