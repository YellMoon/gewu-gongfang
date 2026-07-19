# 桌面人类身份、多角色、多设备与主机迁移验证记录

verification_status: completed

redacted_evidence_only: true

release_status: not-published

基线提交：`ed39491`。本记录只保存脱敏场景名、测试命令和结果，不记录真实手机号、会话令牌、设备私钥、本机密码或一次性恢复因子。统一多端矩阵完成前不推送、不打包、不部署，也不执行真实主机切换。

## 自动化与运行时证据矩阵

| evidence key | 脱敏场景 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| dual-role-super-admin-teacher | 同一规范用户同时拥有超级管理员与老师角色，teacher_id 保持同一绑定 | 角色 grant、桌面 session、scope 测试与隔离 Electron 角色切换 | 自动化与真实 Electron UI 通过 |
| device-host | 设备 A：现有本地数据主机 | 主机 generation、运行配置、凭据存储测试与隔离 Electron 数据主机配置 | 自动化与真实 Electron UI 通过；真实主机不变更 |
| device-second | 设备 B：同一用户的第二台已授权电脑 | 多设备授权与计划迁移 HTTP 测试 | 自动化通过；真实 UI 待验证 |
| device-replacement | 设备 C：替换设备，保留 replaces/replacedBy 关系 | 设备中心策略与撤销测试 | 自动化通过；真实 UI 待验证 |
| fresh-phone-challenge | 每次高风险操作重新获取微信手机号证明 | 主机 challenge 与小程序确认页测试 | 自动化通过；真实扫码待验证 |
| same-device-self-approval-rejected | 申请设备不能在同一设备自批 | 桌面身份服务失败矩阵 | 自动化通过 |
| trusted-device-approval | 同一用户的另一台可信设备可批准待审申请 | 身份设备中心策略与 HTTP 测试 | 自动化通过；真实双机待验证 |
| password-wrong-and-recovery | 本机密码错误保持锁定；忘记密码只能重新核验同一人并安全轮换凭据，不能找回明文 | vault、service、HTTP、identity gate 与隔离 Electron 密码重设 | 自动化与真实 Electron UI 通过 |
| online-offline-expired | 在线、有效离线租约、过期与断网状态分离 | desktop identity client、gate 测试与隔离 Electron 离线窄屏 | 自动化与真实 Electron UI 通过 |
| teacher-admin-scope | 老师角色只访问本人范围，超级管理员角色才有审批与全量范围 | scope、同步身份、设备中心测试与隔离 Electron 双角色切换 | 自动化与真实 Electron UI 通过 |
| revocation | 撤销后现有会话、排队同步与主机写入均被拒绝 | session、sync scope 与 cloud relay 测试 | 自动化通过；真实 UI 待验证 |
| host-bootstrap | generation 1 需要新手机号证明、本地签名 receipt、数据库和题库 authority evidence | primary-host 聚合套件与真实 HTTP 链 | 自动化通过；不执行真实 bootstrap |
| transfer-failure-and-success | 任一预检失败不退役旧主机；全部通过才 CAS 激活 generation+1 | 主机服务、预检证明、SQLite 备份与 HTTP 测试 | 自动化通过；不执行真实换机 |
| recovery-missing-factor-rejected | 缺少或已使用恢复因子、旧主机仍可达、权威备份不符均拒绝恢复 | 主机恢复失败矩阵 | 自动化通过；不执行真实恢复 |
| electron-host-wide | 数据主机配置、宽窗口、超级管理员工作台、设备中心与主机标识 | Electron 28.3.3 / Chromium 120 隔离运行时与截图 | 通过；无渲染/主进程意外错误 |
| electron-client-narrow | 普通客户端配置、窄窗口、密码重设、老师角色、离线租约、恢复包和 OSS 更新入口 | Electron 28.3.3 / Chromium 120 隔离运行时与截图 | 通过；无横向溢出或网络失败 |

## 已完成的 fresh 命令

- `npm run test:primary-host`：通过全部主机身份命令，schema 为 3108。
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
- 一次性恢复包在界面显示前的页面刷新和 Electron 进程退出窗口已由隔离真实运行时验证；真实 bootstrap、换机和恢复仍留到统一发布矩阵并需用户明确授权。
- 当前仅有本地提交，没有推送 `gewu/master`，没有 OSS 发布、阿里云部署、小程序上传或本地主机升级。

## 下一步

1. 回到未认可学生计划，从固定脱敏示例题与隔离 Word/PDF 继续，纳入桌面角色、设备和主机 generation 的统一安全矩阵。
2. 在统一矩阵完成前继续保持 `release_status: not-published`，不推送、不打包、不部署，也不执行真实 bootstrap、换机或恢复。
3. 发布阶段再补真实微信扫码、真实两台电脑和数据主机安装证据；外部端任一未完成时只报告“部分发布”或“受阻”。
