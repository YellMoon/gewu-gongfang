# 未认可学生、公开申请与会员边界验证记录

verification_status: partial

redacted_evidence_only: true

release_status: not-published

当前基线版本为 `6.1.0`，工作分支为 `codex/unrecognized-student-experience`。本记录只保存脱敏测试结论、样卷哈希和错误码，不记录微信 code、phoneCode、JWT、access token、手机号、设备私钥、本机密码或恢复因子。统一矩阵完成前不推送、不打包、不部署。

## 当前结论

- Task 7–11 的生产实现已存在于 `gewu/master`，此前计划未回填；2026-07-22 已按原计划命令重新验证通过。
- 未认可身份由 Backend 单一签发，正式业务默认拒绝；Gateway 旧 review-demo 路由固定 410。
- 小程序使用唯一微信手机号登录动作，未认可账号只得到固定示例题、隔离 Word/PDF 和公开申请能力。
- 17 个注册页面、六类角色与申请/空态/离线/无权限/有限写入状态均进入静态覆盖门禁。
- 当前微信账号可以正常获取 access token 和生成官方小程序码；URL Link 返回权限码 `85407`。这不是服务器 IP 白名单故障，桌面身份入口已在本地实现仅针对该权限码的小程序码回退。
- 真实微信逐页证据、真实桌面扫码、当前主机 bootstrap、第二台电脑批准与统一多端发布尚未完成，所以状态仍为 `partial / not-published`。

## 固定示例题来源边界

- 只读核验源文件 SHA-256：`CC32C9804373A906F6799522DA77F24882C85FDEC447701B0F09002894A132AD`。
- 人工与脚本核对题号 1、2、4、11 的答案依次为 A、C、B、AC。
- 生产固定数据只包含四道脱敏题；第 2 题不包含照片 relationship 或媒体文件，运行时不读取 D 盘，不携带整卷、页眉页脚或个人填写栏。
- `unrecognizedExperienceData`、隔离沙箱和 HTTP 测试覆盖列表、组卷、Word、PDF、取消、过期、跨会话、越界 ID、大小限制与无 D 盘依赖，全部通过。

## Fresh 自动化证据（2026-07-22，Asia/Shanghai）

| 范围 | 命令/证据 | 结果 |
| --- | --- | --- |
| 微信身份入口 | 生产账号脱敏诊断：access token 成功、URL Link `85407`、`wxa/getwxacode` 返回 JPEG | 根因确认；不是 IP 白名单 |
| 小程序码回退 RED/GREEN | 微信服务、普通桌面挑战、主机挑战、客户端、身份门、设备中心六组测试 | 先按缺少接口失败，实施后全部退出 0 |
| 身份与主机矩阵 | `test:desktop-identity`、`test:primary-host`、`test:identity-device-center`、`test:sync-identity` | 全部退出 0 |
| 类型检查 | 根项目 `npm run typecheck`；`npm --prefix miniapp run typecheck` | 全部退出 0 |
| Task 7–11 原计划矩阵 | 固定数据、沙箱、防火墙、410、会话、申请 UI、隐私、17 页覆盖和发布脚本测试 | 全部退出 0 |
| 项目全量 | `npm test` | 退出 0；未跳过测试或更新快照 |
| 生产小程序 | `npm run miniapp:release-check` | WeApp 编译成功；发布 smoke 退出 0 |
| 桌面身份发布门禁 | `npm run check:desktop-identity-release` | 退出 0 |
| 生产安全探针 | 短时未认可令牌直连 Backend/Gateway；只记录状态码、错误码和泄漏布尔值 | 允许接口 3/3 为 200；正式 Backend 入口 9/9 为 403；Gateway 入口 2/2 为 401；旧审核入口 2/2 为 410；无不匹配 |
| 生产隐私探针 | 检查 4 个 PM2 日志文件的本次请求增量与 `miniapp_login_events` 表结构 | 未发现探针令牌/Authorization 头；无 code、phoneCode、JWT、access token、完整请求体字段；数据库 `quick_check=ok` |
| Git 差异 | fresh `git fetch gewu --prune` 后比较 `gewu/master...HEAD` | 主线已含 PR #5；已跟踪工作区仅有本次小程序码修复 |

## 安全与数据边界

- 生产脱敏探针确认：未认可 token 的本人身份、本人申请、固定示例题接口为 200；学员、课程、题库、云快照、桌面身份、桌面配对、同步、管理员和权限等正式 Backend 入口均返回 403 + `UNRECOGNIZED_SCOPE_FORBIDDEN`。
- 同一短时令牌访问 Gateway 权限和云任务入口均在身份查库前返回 401 + `EXPERIENCE_TOKEN_NOT_ACCEPTED_BY_GATEWAY`；旧 review-demo 登录和路由固定返回 410 + `REVIEW_DEMO_REMOVED`。
- 探针前后比较 4 个 PM2 日志文件的请求增量，未发现完整令牌或 Authorization 头；生产 `miniapp_login_events` 表不存在 code、phoneCode、JWT、access token 或完整请求体字段，生产库 `quick_check=ok`。
- 体验导出只使用 Backend 临时目录，不读取权威题库快照、移动题库盘、`miniapp_tasks` 或本地主机业务库，不上传 OSS。
- 身份切换通过统一 session committer 先清业务缓存与权限再写新 identity/token；服务端防火墙独立成立。
- 180 天隐私保留测试覆盖登录事件、拒绝/撤回申请和稳定已批准 payload 的删除或匿名化；认证身份手机号和审计摘要按设计保留，临时 code/JWT 不入表。
- 小程序码响应只接受不超过 2 MiB 的 JPEG/PNG 魔数，桌面端只渲染服务端验证后的 data URL；网络、配置和非 `85407` 上游错误不回退。

## 真实运行时状态

- 当前微信开发者工具可完成生产 WeApp 编译，AppID 与项目配置一致。
- 当前 IDE Stable `2.01.2510290` 可开启自动化监听，但最新版 `miniprogram-automator 0.12.1` 在 IPv4/IPv6 端点均停留于协议握手；探针 15 秒超时退出，没有生成或伪造当前版本截图。
- 既有 `output/miniapp-review-5.14.4/`、`output/miniapp-task12/` 和桌面隔离 Electron 截图只作为历史证据，不冒充当前 6.1.0 的 17 页真实微信矩阵。

## 仍待完成的统一矩阵

1. 恢复可用的微信开发者工具自动化协议，或在真实微信运行时逐页采集 17 页和六类角色关键状态证据。
2. 完成当前版本阿里云部署前备份与部署，使生产桌面身份挑战可返回官方小程序码。
3. 构建并安装数据主机专属桌面包，完成真实微信扫码、当前主机 bootstrap 与恢复包离线交付确认。
4. 用第二台普通桌面端完成同一人的注册、异机批准和角色保持验证；未获明确换机指令时不执行主机切换。
5. 完成小程序上传/核验、OSS 普通与主机 feed、Node ABI 恢复、本地主机健康/题库盘/同步/heartbeat 验证，再按证据报告完成、部分发布或受阻。
