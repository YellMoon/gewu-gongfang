# 数据主机恢复包跨崩溃安全交付设计

日期：2026-07-19

状态：用户已批准“云端暂存仅目标 Electron 设备可解密的密文，确认保存后立即清除”方案

## 背景与问题

当前 bootstrap、计划迁移激活和紧急恢复会在云端事务成功后生成一次性恢复包。服务端只保存恢复因子的慢哈希，恢复包明文只在成功响应中返回。这个边界避免了云端持久化明文，但留下一个不可接受的退出窗口：云端已经激活新主机后，若响应丢失，或 Electron 在本地 adopt、React 状态更新和恢复包显示前退出，重试只能恢复主机凭据，无法重新取得一次性恢复包。

本设计把恢复包改为“面向目标设备的耐久密文交付”。服务端仍然不能解密恢复包；目标 Electron 在用户明确确认已离线保存前，能够跨进程重启恢复显示。统一多端发布矩阵完成前只使用隔离测试数据验证，不执行真实主机 bootstrap、换机或紧急恢复。

## 目标

1. 覆盖云端提交前后、响应丢失、本地 adopt 前后、界面显示前后和确认过程中的所有进程退出窗口。
2. 阿里云数据库、日志、HTTP 状态接口和备份均不保存恢复包明文或可独立解密它的私钥。
3. 只有本次目标 Electron 设备能够解密交付信封；另一台已授权设备、管理员会话和服务端运维人员都不能解密。
4. 用户确认离线保存前，恢复包在本机加密存储中可重复显示，云端密文可重复获取，主机状态明确标记为“恢复包待确认”。
5. 用户确认后先完成云端 CAS 确认，再原子清除本机恢复包、交付私钥和云端密文；旧备份中的密文也因私钥销毁而不可恢复。
6. 新协议同时覆盖 generation 1 bootstrap、计划迁移激活和紧急恢复生成的新 generation。

## 非目标

- 不把恢复包上传为云端可解密的 KMS 密文。
- 不允许用手机号、超级管理员角色或另一台可信设备代替目标设备私钥解密。
- 不自动把恢复包复制到网盘、剪贴板历史、日志或业务数据库。
- 不在本任务执行真实数据主机切换、外部发布、OSS 发布或阿里云部署。
- 不改变恢复因子本身的一次性、归属、generation 和紧急恢复证据规则。

## 安全不变量

1. 服务端只保存恢复因子慢哈希和设备密文；数据库中不得出现 `recoveryCode` 明文。
2. 交付公钥指纹必须进入 Electron 主进程生成的规范化 operation manifest 和本地签名 receipt，服务端必须校验请求公钥与已签指纹一致，禁止 renderer 或中间人替换收件密钥。
3. 密文交付只能返回给与 `user_id + device_id + epoch_id` 同时匹配的在线 V2 桌面会话。
4. acknowledgement 必须同时通过目标桌面会话、delivery row version CAS 和交付私钥签名证明。
5. 服务端 acknowledgement 成功前不得删除本机明文副本或交付私钥；网络失败、并发冲突和服务端失败均保持可重试状态。
6. Electron 状态接口只能公开 `pendingRecoveryDelivery=true/false`、delivery ID、epoch ID 和 row version，不得把恢复包混入普通状态快照、日志或长期 renderer 存储。
7. 未确认交付时禁止开始下一次主机迁移、恢复或恢复因子轮换；界面和发布证据不得宣称主机迁移流程完成。

## 加密交付信封

### Electron 预备阶段

`primaryHostRuntime.prepareOperation()` 在生成本地主机凭据 stage 的同时生成独立的 RSA 3072 位交付密钥对：

- 公钥使用 SPKI PEM/DER 表示；
- 私钥与 staged host credential 一起写入 Windows `safeStorage` 保护的本机文件；
- 公钥指纹为 SPKI DER 的 SHA-256；
- `operationManifest.recoveryDelivery` 保存协议版本、算法和公钥指纹；
- 本地 receipt 对包含该指纹的规范化 manifest hash 签名；
- renderer 只得到公钥、指纹、stage ID 和已有非秘密证明，不得到交付私钥。

每次 bootstrap、迁移激活或恢复使用新的交付密钥对。交付密钥不得复用于桌面身份签名或主机凭据。

### 服务端封装

服务端校验目标设备、operation manifest、本地 receipt、公钥算法、RSA 位数和指纹后生成恢复包。随后：

1. 生成随机 256 位内容密钥和 96 位 GCM IV；
2. 使用 AES-256-GCM 加密规范化恢复包 JSON；
3. 使用目标设备 RSA 公钥和 RSA-OAEP-SHA256 包装内容密钥；
4. 把 `protocolVersion/epochId/factorId/deviceId/generation/recipientKeyFingerprint` 作为规范化 AAD；
5. 保存 wrapped key、IV、authentication tag、ciphertext、AAD 字段和算法标识；
6. 立即丢弃恢复包明文和内容密钥。

交付信封为版本化结构 `primary-host-recovery-delivery/v1`。任何算法、AAD、指纹、epoch、factor 或 device 不匹配都必须 fail closed，不得尝试降级为明文响应。

## 服务端持久化模型

新增 `host_recovery_deliveries`，与 `host_recovery_factors` 分离：

- `id`：交付 ID；
- `epoch_id`、`factor_id`、`user_id`、`device_id`：唯一收件范围；
- `protocol_version`、`recipient_key_fingerprint`；
- `recipient_public_key_pem`：仅用于确认签名验证，不是秘密；
- `ack_nonce`：服务端生成的 256 位随机确认挑战，只返回目标设备；
- `envelope_json`：设备密文；
- `status`：`pending` 或 `acknowledged`；
- `row_version`、`created_at`、`updated_at`、`acknowledged_at`。

一个 epoch 只能有一个恢复包交付，一个 factor 只能属于一个交付。epoch、恢复因子哈希和交付密文必须在同一数据库事务中落盘；任一步失败都不得激活 epoch。

“短期暂存”由生命周期而不是不安全的固定超时定义：密文一直保留到用户明确确认，未确认超过 24 小时和 7 天分别进入告警状态，但不得仅因超时删除唯一可恢复密文。确认后同一事务把 `status` 改为 `acknowledged`，把 `envelope_json` 和 `recipient_public_key_pem` 置空，只保留指纹和审计字段。数据库备份中可能残留历史密文，但 Electron 同时销毁私钥后无法再解密。

## API 契约

### 激活请求与响应

现有 bootstrap、transfer activation 和 recovery 请求增加 `recoveryDeliveryKey`：协议版本、公钥、算法和指纹。服务端必须验证它与签名 manifest 一致。

成功响应不再返回 `recoveryPackage` 明文，只返回：

```json
{
  "epoch": { "id": "redacted", "generation": 1 },
  "recoveryDelivery": {
    "id": "redacted",
    "rowVersion": 1,
    "status": "pending",
    "ackNonce": "redacted-random-challenge",
    "envelope": { "protocolVersion": "primary-host-recovery-delivery/v1" }
  }
}
```

同一已验证挑战或迁移操作的幂等重试必须返回同一个 pending delivery 密文，而不是 `recoveryPackage: null`。不同设备、不同用户或非目标 epoch 请求统一返回不存在或无权，不泄露交付是否存在。

### 状态恢复

`GET /api/desktop-identity/primary-host/status` 对目标设备增加 `pendingRecoveryDelivery` 密文元数据。其他设备只能看见通用的 `recoveryDeliveryPending: true`，不能取得 envelope、公钥或 factor ID。

Electron 启动后按以下优先级恢复：

1. 本机已有 decrypted pending package：直接显示阻断式保存界面；
2. 本机仍有 credential stage，云端有 pending envelope：解密、adopt、原子保存本机 pending package 后显示；
3. 本机已 adopt 但缺本地 package，云端仍有 envelope 且交付私钥存在：重新解密并保存；
4. 云端已 acknowledged：清理可能残留的本机交付材料，进入正常状态；
5. 任一对应关系或密文校验失败：保持阻断状态并显示可审计错误，不自动重建或跳过恢复因子。

### 用户确认

新增 `POST /api/desktop-identity/primary-host/recovery-deliveries/:deliveryId/acknowledge`。Electron 主进程对以下规范化内容使用交付私钥签名：

- delivery ID、epoch ID、factor ID；
- recipient key fingerprint；
- expected row version；
- acknowledgement nonce 和时间。

acknowledgement nonce 是创建 delivery 时生成并持久化的 256 位随机挑战，只随目标设备的 pending delivery 返回；签名时间与服务端时间差不得超过 5 分钟。服务端验证当前 V2 会话的 user/device、活跃 epoch、pending 状态、nonce、公钥签名和 row version 后执行 CAS 确认，并在同一事务中清空密文、公钥和 nonce。重复确认返回同一个 acknowledged 状态，不恢复密文。

renderer 只调用一个受限 IPC `primaryHostRuntime.acknowledgeRecoveryPackage({ authorization, deliveryId, expectedRowVersion })`。主进程必须按顺序：签名、请求固定控制面、验证确认响应、原子清除本机 package/私钥、返回成功。任何前置步骤失败均保留本机材料。

## Electron 本地状态

`primaryHostCredentialStore` 的加密载荷增加两个内部状态：

- `stagedRecoveryDeliveryKey`：stage ID、epoch/generation 目标、公私钥、指纹；
- `pendingRecoveryDelivery`：delivery/epoch/factor 元数据、恢复包明文和交付私钥。

这些字段与主机 credential 使用同一 safeStorage 原子文件写入，不创建明文旁路文件。`adopt()` 必须先验证 envelope，再在一次原子提交中保存 committed host credential 与 pending recovery delivery，最后更新受管 runtime config。若在 config 写入前退出，下一次 initialize 根据 committed epoch 完成配置协调；若在 UI 显示前退出，`revealRecoveryPackage()` 从安全存储重新返回。

普通 `status()` 只返回布尔和脱敏元数据。`revealRecoveryPackage()` 仅在当前设备、active epoch 和 pending delivery 全部匹配时返回恢复包。确认成功后清除交付私钥、恢复包和 stage 残留，但保留非秘密 acknowledgement 摘要用于本地诊断。

## UI 行为

`IdentityDeviceCenter` 不再直接读取激活 HTTP 响应中的恢复包。它把密文交给 Electron `adopt()`，只使用主进程解密后返回的恢复包。

任何 pending delivery 都显示不可遮罩关闭的阻断式界面：

- 明确说明主机身份已激活，但恢复包交付尚未完成；
- 提供只读恢复包和“复制紧急恢复包”；
- 最终按钮改为“我已离线保存，确认交付并重启”；
- 点击最终按钮后由单一 IPC 完成服务端确认和本机清理；
- 网络失败、并发冲突或签名失败时保持界面和恢复包可见；
- 未确认时设备中心、顶栏和部署门禁均显示待处理状态，并禁用下一次 bootstrap、迁移和恢复入口。

普通老师角色、普通桌面客户端和其他管理员设备不得显示恢复包内容。目标设备即使桌面云会话暂时失效，也可在输入本机密码后查看已经安全落盘的本地 pending package，但必须重新联网和获得有效目标设备会话才能确认交付。

## 退出窗口与恢复结果

| 退出点 | 耐久证据 | 重启后的结果 |
| --- | --- | --- |
| 云端事务前 | 本机 credential/key stage | 安全重试或取消；没有 active epoch |
| 云端提交后、响应前 | 云端 pending envelope + 本机私钥 | 状态接口取回同一密文并继续 adopt |
| 收到响应后、adopt 前 | 云端 pending envelope + 本机私钥 | 同上，不依赖丢失的 renderer 状态 |
| adopt 原子提交后、UI 显示前 | 本机 pending package + 云端 pending envelope | 重启后直接重新显示 |
| 显示或复制后、确认前 | 两端 pending | 重启后继续显示，可重复复制 |
| 云端确认失败 | 两端 pending | 保持恢复包，不清理本机材料 |
| 云端确认成功、本机清理前 | 云端 acknowledged + 本机 pending | 重启协调后清理；用户已明确确认保存 |
| 两端清理后 | 哈希因子 + acknowledgement 审计 | 正常主机状态；旧密文因私钥销毁不可解密 |

## 错误处理与审计

新增稳定错误码：

- `PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED`
- `PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID`
- `PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH`
- `PRIMARY_HOST_RECOVERY_DELIVERY_DECRYPT_FAILED`
- `PRIMARY_HOST_RECOVERY_DELIVERY_PENDING`
- `PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT`
- `PRIMARY_HOST_RECOVERY_DELIVERY_ACK_PROOF_INVALID`

日志只记录 delivery ID 摘要、epoch ID 摘要、指纹摘要、状态、row version 和错误码。禁止记录 envelope、wrapped key、ciphertext、private key、恢复包 JSON、recovery code 或 acknowledgement signature 原文。部署门禁必须扫描源代码与生产构建，确认不存在明文持久化、普通状态泄漏和旧 `recoveryPackage` HTTP 响应契约。

## 兼容性与发布顺序

数据库 schema 从 3107 递增到 3108。已有 active epoch 且没有 delivery 行的主机保持可运行，不伪造历史恢复包。新 bootstrap、迁移激活和恢复必须携带 V1 delivery key；旧桌面客户端收到 `PRIMARY_HOST_RECOVERY_DELIVERY_KEY_REQUIRED` 后停止高风险操作，不能降级为旧明文响应。

状态字段均为向后兼容的新增字段，但激活协议是有意 fail closed 的版本门槛。发布时必须遵守统一矩阵：先备份并部署支持 schema 3108 和密文交付的阿里云控制面，再升级本地数据主机与普通桌面客户端，最后才允许真实主机操作。矩阵未完成时继续保持 `not-published`。

## 验证策略

### 自动化 RED/GREEN

1. 加密单元测试：正确设备可解密；错误私钥、篡改 AAD/tag/ciphertext、错误 epoch/factor/device 全部失败。
2. 数据库测试：只出现慢哈希和 envelope；全文扫描不存在 recovery code；确认事务清空 envelope/public key 但保留因子哈希和审计摘要。
3. 服务测试：bootstrap、transfer activation、recovery 都生成 delivery；幂等重试返回同一密文；非目标设备不可读取或确认；签名/CAS 冲突 fail closed。
4. HTTP 测试：成功响应无 `recoveryPackage`；目标状态可恢复 envelope；其他设备不获得敏感元数据；acknowledgement 只允许匹配 actor。
5. Electron store 测试：safeStorage 载荷跨实例恢复；普通 status 无明文；ack 网络失败不清理；成功确认后清理；配置写入前后退出均可协调。
6. UI 契约测试：从 `adopt()`/`revealRecoveryPackage()` 获取内容；pending 时阻断关闭和后续高风险操作；确认失败保持内容。
7. 安全门禁：源码、构建产物、日志夹具和状态 JSON 均不出现测试恢复码或私钥。

### 隔离真实运行时

使用临时 Electron `userData`、临时 SQLite 和脱敏 mock 控制面验证，不触碰真实主机：

- 模拟服务端激活成功后丢弃响应并关闭 Electron；
- 重新启动 Electron，从 status envelope 恢复 adopt 和恢复包显示；
- 再次关闭于 adopt 后、React 显示前，确认下一次启动仍能显示；
- 模拟 acknowledgement 网络失败，确认恢复包不消失；
- 完成测试 acknowledgement，确认云端 envelope 清空、本地私钥/package 清空且重启后不再显示；
- 在 1200×800 和宽窗口检查阻断界面无裁切、角色不串用、无恢复包日志。

只有上述自动化、隔离 Electron、全量 `npm test`、桌面构建、小程序类型/构建和发布门禁全部通过，Task 11 才能标记完成。统一多端发布矩阵完成前仍不推送、不打包、不部署。
