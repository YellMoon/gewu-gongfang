# 桌面人类身份、多角色、多设备与主机迁移验证记录

verification_status: partial

redacted_evidence_only: true

release_status: partial-published

基线提交：`ed39491`；当前发布提交：`261470e`（6.4.0）。本记录只保存脱敏场景名、测试命令和结果，不记录真实手机号、会话令牌、设备私钥、本机密码或一次性恢复因子。6.4.0 已完成阿里云、OSS、小程序开发版和指定数据主机的适用端发布，但真实第二台普通桌面端仍待验收，因此整体结论保持“部分发布”；未获用户实际换机要求时不执行真实主机切换。

## 自动化与运行时证据矩阵

| evidence key | 脱敏场景 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| dual-role-super-admin-teacher | 同一规范用户同时拥有超级管理员与老师角色，teacher_id 保持同一绑定 | 角色 grant、桌面 session、scope 测试与隔离 Electron 角色切换 | 自动化与真实 Electron UI 通过 |
| device-host | 设备 A：现有本地数据主机 | generation 1、6.4.0 主机安装、`primary-host/single-user` 运行配置、本地健康与权威库备份 | 自动化、真实安装与主机 bootstrap 通过；当前主机未切换 |
| device-second | 设备 B：同一用户的第二台已授权电脑 | 多设备授权与计划迁移 HTTP 测试 | 自动化通过；真实 UI 待验证 |
| device-replacement | 设备 C：替换设备，保留 replaces/replacedBy 关系 | 设备中心策略与撤销测试 | 自动化通过；真实 UI 待验证 |
| fresh-phone-challenge | 每次高风险操作重新获取微信手机号证明 | 主机 challenge 与小程序确认页测试 | 自动化通过；真实扫码待验证 |
| same-device-self-approval-rejected | 申请设备不能在同一设备自批 | 桌面身份服务失败矩阵 | 自动化通过 |
| trusted-device-approval | 同一用户的另一台可信设备可批准待审申请 | 身份设备中心策略与 HTTP 测试 | 自动化通过；真实双机待验证 |
| password-wrong-and-recovery | 本机密码错误保持锁定；忘记密码只能重新核验同一人并安全轮换凭据，不能找回明文 | vault、service、HTTP、identity gate 与隔离 Electron 密码重设 | 自动化与真实 Electron UI 通过 |
| online-offline-expired | 在线、有效离线租约、过期与断网状态分离 | desktop identity client、gate 测试与隔离 Electron 离线窄屏 | 自动化与真实 Electron UI 通过 |
| teacher-admin-scope | 老师角色只访问本人范围，超级管理员角色才有审批与全量范围 | scope、同步身份、设备中心测试与隔离 Electron 双角色切换 | 自动化与真实 Electron UI 通过 |
| revocation | 撤销后现有会话、排队同步与主机写入均被拒绝 | session、sync scope 与 cloud relay 测试 | 自动化通过；真实 UI 待验证 |
| host-bootstrap | generation 1 需要本地签名 receipt、数据库和题库 authority evidence | primary-host 聚合套件、真实 HTTP 链与 6.4.0 生产脱敏审计 | 自动化与真实 bootstrap 通过；生产仅有一个 active generation |
| transfer-failure-and-success | 任一预检失败不退役旧主机；全部通过才 CAS 激活 generation+1 | 主机服务、预检证明、SQLite 备份与 HTTP 测试 | 自动化通过；不执行真实换机 |
| recovery-missing-factor-rejected | 缺少或已使用恢复因子、旧主机仍可达、权威备份不符均拒绝恢复 | 主机恢复失败矩阵 | 自动化通过；不执行真实恢复 |
| electron-host-wide | 数据主机配置、宽窗口、超级管理员工作台、设备中心与主机标识 | Electron 28.3.3 / Chromium 120 隔离运行时与截图 | 通过；无渲染/主进程意外错误 |
| electron-client-narrow | 普通客户端配置、窄窗口、密码重设、老师角色、离线租约、恢复包和 OSS 更新入口 | Electron 28.3.3 / Chromium 120 隔离运行时与截图 | 通过；无横向溢出或网络失败 |

## 已完成的 fresh 命令

- `npm run test:primary-host`：通过全部主机身份命令；当前 schema 为 3110。
- Task 10 指定的六命令 GREEN 矩阵：通过。
- `npm run test:desktop-authorization`：通过。
- `npm run test:identity-device-center`：通过。
- `npm run test:sync-identity`：通过。
- `node src/uiRegression.test.js` 与 `node scripts/publish-oss-feed.test.js`：通过，普通桌面客户端重新显示阿里云 OSS 检查、下载和安装入口。
- 2026-07-19 00:24–00:29（Asia/Shanghai）fresh `npm test`：退出码 0，用时 343.6 秒，回传 697 行；主机身份、后端、网关、小程序、公式/导出和桌面回归全部通过。
- 2026-07-19 00:30 fresh `npm run build`：退出码 0，React 生产构建成功，build tag 为 `20260719-0030`。
- 首次 fresh 小程序 typecheck 准确发现管理员用户页联合响应类型和缺少 `Picker` 导入；修复后 `npm --prefix miniapp run typecheck` 退出码 0，用时 6.2 秒。
- fresh `npm --prefix miniapp run build:weapp`：退出码 0，Webpack 编译用时 13.45 秒。
- fresh 构建后再次执行身份架构、源码/构建安全门禁和全页面 UI coverage：全部通过。
- 2026-07-19 密码重设聚焦矩阵：service、HTTP、vault、desktop client、identity gate、device center 和小程序确认运行时全部通过；服务端交换重试幂等，设备数量和授权 ID 不变，旧会话只在凭据成功轮换后失效。
- 2026-07-19 `npm run check:desktop-identity-release`：通过；源码与生产构建均存在密码重设协议、恢复包交付协议和 OSS 更新检查入口，且未发现明文密码找回实现。
- 2026-07-19 22:44–22:46（Asia/Shanghai）fresh `npm test`：退出码 0、703 行、114.7 秒；schema 3108、主机恢复包、身份/同步、题库和 Word/PDF 导出链路全部通过。
- 2026-07-19 22:47 fresh 专门矩阵：`npm run typecheck`、小程序 typecheck、`test:desktop-identity`、`test:identity-device-center`、`test:sync-identity` 与身份发布门禁均退出码 0。
- 2026-07-19 22:48 fresh 非版本变更构建：`npx craco build` 成功，小程序 `build:weapp` 成功（Webpack 19.11 秒）；未打包、上传或部署。
- 2026-07-22 生产脱敏审计：schema 3110，但当前没有主机 epoch、桌面授权、双设备用户或双角色规范用户；本机安装配置虽为 `primary-host`，仍缺托管 epoch/generation，因此真实 bootstrap 尚未完成。
- 2026-07-22 已复现安装版首次注册 `WECHAT_URL_LINK_FAILED`。同一生产微信账号可正常获取 access token；URL Link 返回权限码 `85407`，官方 `wxa/getwxacode` 返回 JPEG，证明不是 IP 白名单问题。
- 2026-07-22 本地按 RED→GREEN 实现只针对 `85407` 的官方小程序码回退；`test:desktop-identity`、`test:primary-host`、`test:identity-device-center`、`test:sync-identity`、根/小程序 typecheck、`npm test` 与小程序生产构建均退出 0。该修复尚未部署。
- 2026-07-23 6.4.0 统一发布已完成：部署前云端备份位于 `/root/scheduling-backups/unified-release/20260723-135533`，本机主机备份位于 `D:\GewuDataHost\backups\release-6.4.0-20260723-135335`；源库与备份库 `PRAGMA quick_check` 均为 `ok`。
- 2026-07-23 生产脱敏审计确认 active host epoch 为 generation 1、active desktop authorization 为 1；本地主机配置为 `primary-host/single-user`，本地与公网健康均为 6.4.0。该证据完成真实 bootstrap，但也直接证明尚无第二台真实普通桌面端。
- 2026-07-23 普通端与主机端 OSS feed 均为 6.4.0，普通端安装包 150685745 bytes、主机端安装包 150693969 bytes；小程序开发版上传成功（953634 bytes），正式审核/发布继续受微信主体与平台流程限制。
- 2026-07-23 fresh Task 10/11 回归：六项主机 bootstrap/迁移/恢复聚焦命令、发布安全门禁、`npm test`、桌面生产构建、小程序 typecheck 与 WeApp 构建均退出码 0；构建产生的临时时间戳已恢复，未新增发布或部署。

## 真实 Electron 隔离运行时

- 证据目录：`output/task11-primary-host-recovery-delivery/`。入口使用生产 `public/preload.js` 与生产 `build/index.html`，Electron `28.3.3`、Chromium `120.0.6099.291`，临时隔离 userData 和仅回环传输；没有连接真实账号、真实主机或真实业务数据库。
- 密码重设：显示安全入口、手机号重新核验、异机管理员批准、新密码保存并进入业务运行时；密码框眼睛只显示当前输入，不提供历史明文找回。
- 恢复包交付：弹窗无关闭按钮，Esc/遮罩不可关闭；页面刷新和 Electron 进程重启后仍保留；首次确认网络故障后秘密仍在，重试确认后才清除。唯一主进程诊断为测试主动注入的首次确认故障，其余渲染错误、主进程意外错误和网络失败均为 `0`。
- 角色与布局：老师窄屏、超级管理员工作台、离线租约窄屏和数据主机宽屏设备中心均通过；窄屏文档宽度断言无横向溢出，截图人工复核无空白、裁切或缓存串角色。
- 更新入口：系统参数中的“软件更新”卡片可见且“检查更新”返回 OSS feed 地址。另以只读 GET 检查现有 `latest.yml` 得到 HTTP `200`；本轮没有上传或改写 OSS。

## 本机密码重设的数据边界

- 本机密码和私钥明文从未存入服务端，因此只能重设，不能找回旧密码；每台电脑继续使用各自独立的本机密码。
- 重设必须由原授权设备发起，微信重新核验的规范用户必须与原授权所有者一致，并由另一台已授权管理员设备批准；不允许同设备自批。
- 交换成功时只原子轮换该设备的公钥、指纹和 credential version，保留原 `authorizationId`、`deviceId`、`userId` 和设备数量。旧授权在交换前保持可用；交换后旧密码/旧密钥失效，新密码生效。
- vault 原子性测试证明：取消、锁定或中途退出不会覆盖旧 vault；只有新凭据封装成功才提交。既有本机业务文件、待同步队列和业务数据库没有删除路径，测试中的业务文件在重设后仍可读取。

## 隐私与发布边界

- 文档中的设备 A/B/C、用户和哈希均为脱敏概念，不保存真实身份材料。
- 服务端恢复因子只存慢哈希；主机凭据由 Electron 主进程本地生成并通过系统加密存储，renderer 和云端响应不接收明文主机凭据。
- 一次性恢复包在界面显示前的页面刷新和 Electron 进程退出窗口已由隔离真实运行时验证；真实 bootstrap 已完成，计划换机只做失败矩阵和隔离 dry-run，未获用户实际换机要求时不激活 generation 2；紧急恢复不在正常运行主机上实做。
- 版本 6.4.0 已完成代码推送、阿里云部署、两条 OSS feed、小程序开发版上传和指定数据主机升级。微信正式审核/发布与第二台普通桌面端真实验收尚未完成，因此不得写“完整发布完成”。

## 下一步

1. 当前数据主机先由用户在安装版中输入本机密码解锁；自动化不得读取、代填或绕过本机密码。
2. 在另一台真实电脑安装普通桌面端 6.4.0，完成一次性注册、主机自动批准、同一 identity/双角色/teacher_id、teacher scope、super-admin 操作、同步和撤销验证。
3. 第二台电脑完成后补计划换机 dry-run 与恢复包生成证据，但不激活 generation 2。微信正式审核/发布继续按用户后续企业主体安排推进；此前整体状态保持“部分发布”。

## 2026-07-25 普通端在线续签与 14 天离线租约

- 根因复核确认 6.4.4 的临时修复把 `single_user_pairing` 普通端直接当作离线解锁，绕过了数据主机的在线设备挑战，因此界面能进入但无法获得可同步的在线会话。6.4.5 改为优先直连数据主机，直连不可达时使用带随机读取秘密的阿里云短时任务中继；授权、撤销状态和凭证版本仍只由数据主机权威库校验。
- 数据主机完成挑战后只向阿里云返回带共享主机密钥签名的会话证明；阿里云校验证明后换发仅允许访问 `/api/cloud` 的短期桌面中继令牌。令牌不能访问权限管理等其他业务接口，最终同步任务仍由数据主机再次校验真实会话与设备授权。
- 加密离线身份租约上限由 72 小时统一调整为 14 天，Backend、renderer 客户端和 Electron vault 的常量与边界测试一致；联网手动同步时，缺失或过期的在线会话会通过启动身份门自动续签，只有网络/主机不可达时才允许回退到仍有效的离线租约。
- `npm test`、`npm run typecheck`、桌面身份、同步、主机及云中继聚焦测试均通过；普通端和主机端隔离安装包启动冒烟分别确认 flavor 为 `desktop-client` 和 `primary-host`，打包后 Node `better-sqlite3` ABI 已恢复并可加载。
- 正式仓库 `gewu/master` 的功能与构建提交截至 `4a6abe4`。阿里云发布前备份位于 `/root/scheduling-backups/release/20260724-173311-v6.4.5`，Backend/Gateway 代码和两套数据库均有非零文件及 SHA-256，两库 `integrity_check=ok`；内网与公网 Backend/Gateway 健康接口均返回 6.4.5，云中继主机协议和匿名访问边界检查通过。
- 普通端 OSS feed 与主机专属 OSS feed 均已公网回读为 6.4.5；普通端安装包为 150698144 bytes，主机端安装包为 150706764 bytes。其他普通电脑继续按既定规则通过普通端 OSS feed 自助更新。
- 本机数据主机安装前备份位于 `D:\GewuDataHost\backups\release-6.4.5-20260724-173520`，覆盖安装后复核备份位于 `D:\GewuDataHost\backups\release-6.4.5-20260724-175545`；源库与备份库 `quick_check=ok`。真实安装版健康接口返回 6.4.5，配置仍为 `primary-host/single-user`，设备 ID、D 盘权威库和 I 盘题库路径均未改变。
- 微信小程序按用户“申请企业主体前保持不动”的要求未重新上传；本次未修改小程序代码，完整小程序兼容性与页面覆盖测试已随根项目回归通过。第二台真实普通电脑更新到 6.4.5 后的实际配对登录仍需在该设备上验收，因此整体结论保持“部分发布”。

## 2026-07-25 6.4.6 云配对路由修复与整链路复核

- 根因定位为云端两个入口使用了彼此独立的 SQLite 队列：普通端把配对申请提交到 Gateway 的 `/api/cloud/desktop-pairing/requests`，数据主机却只从 Backend 的 `/api/cloud/tasks/claim` 拉取，因此主机看不到也不可能处理该申请。6.4.6 改为数据主机优先从 Gateway 领取任务，并把领取任务的中继来源贯穿进度、完成、失败和查询回调，避免回调再次写错服务。
- 新配对码原先只等待 60 秒后台心跳发布能力，普通端可能在心跳前读到旧状态。6.4.6 在数据主机生成配对码后立即发布配对能力；后台心跳继续作为断线恢复兜底。
- 当前单人模式是“普通端手动发起、数据主机自动批准”。因此成功流程不会产生需要人工点击的“待审设备申请”；数据主机自动校验一次性配对码、设备签名和密文后直接建档，成功设备随后出现在设备列表。没有有效的一次性配对码时，公网能力接口返回 `PAIRING_HOST_OFFLINE` 属于预期的关闭暴露状态。
- 聚焦 RED→GREEN 覆盖 Gateway 优先领取、Backend 兼容回退、回调同源、主机任务路由和生成配对码后立即发布能力；`npm test` 与 `npm run typecheck` 均退出码 0。用真实权威库的只读副本执行单人模式运行时冒烟共 13 项全部通过，源库和副本 `quick_check=ok`，数据计数未变化。
- 真实公网负向验收使用临时设备、临时本机 vault 和故意错误但格式合法的配对码，验证 Gateway 收件、6.4.6 数据主机领取处理、Gateway 收到 `PAIRING_CODE_INVALID` 回调三段均通过；未创建桌面授权，临时配对 grant 已撤销，临时 vault 已删除，证据不记录配对码、密钥或令牌。验收脚本为 `scripts/live-cloud-pairing-route-smoke.js`。
- 正式代码提交为 `c137d59`。发布前云备份位于 `/root/scheduling-backups/release/20260724-185415-v6.4.6`，Backend/Gateway 数据库完整性检查均为 `ok`；公网 Backend 与 Gateway 健康接口均返回 6.4.6。
- 普通端 OSS feed 已发布 `GewuGongfang-Desktop-6.4.6-x64.exe`（150699405 bytes），主机专属 feed 已发布 `GewuGongfang-PrimaryHost-6.4.6-x64.exe`（150707455 bytes），两条公网 `latest.yml` 的版本、文件名、大小和 SHA-512 均已回读核对。普通包 flavor 为 `desktop-client` 且不含主机专属模块，主机包 flavor 为 `primary-host`。
- 本机数据主机安装前备份位于 `D:\GewuDataHost\backups\release-6.4.6-20260724-185603`。安装后程序版本为 6.4.6，仍为 `primary-host/single-user`，设备 ID、`D:\GewuDataHost\data\scheduling.db` 和 `I:/GewuQuestionBank` 均保持不变；本地健康接口返回 6.4.6，权威库 `quick_check=ok`。
- 14 天离线租约在 Backend、renderer 客户端和 Electron vault 三处常量及边界测试保持一致；体系管理的影响数量二次确认、事务级联删除、标注清理、备份、审计和恢复测试通过；小程序手动手机号输入及既有手机号绑定保护测试通过；OSS 更新入口和普通端/主机端构建隔离测试通过。
- 微信小程序继续按用户决定保持不上传、不发布，等待企业主体后再恢复平台侧工作。第二台真实普通电脑需要先更新到 6.4.6，再使用数据主机新生成的一次性配对码完成正向验收；旧版本请求或旧配对码不会被迁移复用，因此整体发布状态在该正向验收前仍记为“部分发布”。
