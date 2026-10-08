# 个人金融统计与小程序对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成账户收支余额、跨账单关联、组合统计、借贷分析、账单邮箱采集及小程序横屏与权限内功能对齐。

**Architecture:** 云端授权服务裁决所有结构化金融数据。纯解析和统计模块复用同一契约，原始文件由私有存储适配器保存；两个终端使用正式云端会话，不恢复本地旧业务写入端点。

**Tech Stack:** Node.js CommonJS、PostgreSQL、React、Taro、AgentMail REST、项目现有部署与 OSS 发布脚本。

## 公共接口

所有金额使用十进制整数的最小货币单位字符串，禁止浮点金额累计。规范化来源行的固定字段为：

```js
{
  sourceTransactionId: '', occurredAt: '2026-10-08T12:00:00+08:00',
  date: '2026-10-08', amountMinor: '10000', currency: 'CNY',
  direction: 'debit', kind: 'expense', description: '', counterparty: '',
  category: '', paymentChannel: '', paymentAccountHint: '',
  balanceMinor: null, relatedReference: '', status: 'completed',
  principalMinor: null, interestMinor: null, feeMinor: null, rawFields: {}
}
```

`kind` 为 expense、income、transfer、refund、loan_drawdown、debt_payment、interest、fee、unknown。账户字段为 id、label、provider、type、maskedIdentifier、currency、openingBalanceMinor、openingDate、status。登录所有者与金融账户 id 分离。

桌面前缀 `/api/business/personal-finance`，小程序前缀 `/api/business/miniapp-personal-finance`：

- `GET /ledger` → `{ok:true,ledger:{accounts,observations,annotations,links,balanceSnapshots,imports,legacyRecords,revision}}`。
- `POST /imports/preview` body `{filename,base64,financialAccountId,fieldMapping?}` → `{ok:true,preview:{provider,templateId,records,errors,warnings,fileHash}}`。
- `POST /imports` body 与 preview 相同，使用 `x-idempotency-key`；有错误时整批拒绝，成功返回 receipt 并刷新 ledger。
- 桌面 `POST /accounts`、`PATCH /accounts/:id`、`POST /links`、`DELETE /links/:id`、`POST /balance-snapshots`、`PATCH /transactions/:observationId`，均限定账户所有者并支持修订冲突检测；分类与还款拆分以追加 annotation 保留原始来源，小程序不增加这些任意编辑端点。
- 桌面 `GET /mailbox`、`POST /mailbox/check` → 待确认附件列表；`POST /mailbox/preview`、`POST /mailbox/import` 按服务端核验的邮件与附件 ID 读取原件；邮箱密钥不返回客户端。

`shared/personal-finance/billCsv.js` 导出 `parseBillCsv(content,{filename,fieldMapping})`，返回 `{provider,templateId,records,errors,warnings}`。`cloud-business-api/src/billFileDecoder.js` 导出异步 `parseBillFile({filename,base64,fieldMapping})`，返回相同结果及 fileHash；解码限制和不支持格式不得静默退化为 CSV。

`shared/personal-finance/ledger.js` 导出 `buildFinanceView(ledger,{accountIds,startDate,endDate})`，返回 transactions、accountStats、currencyTotals、categoryTotals、fundingTotals、comparison 和 unresolvedAssociations。余额未知使用 null；只读统计不改变 ledger。

## 任务一 课程表与题库核验

**Files:** miniapp/src/pages/schedule/index.config.ts、index.scss、相关布局测试；miniapp/src/pages/question-bank 与 question-paper 的必要修复；页面清单与验证记录。不要修改 assets 页面与 api.ts。

- [x] 写方向和横屏布局回归测试，验证缺少方向配置的初始失败。
- [ ] 设置 `pageOrientation: 'auto'`，核验横屏七列、竖屏阅读、日/周切换、滚动和角色范围。H5 横屏/日视图/滚动已截图，真机方向和最终竖屏截图仍单独记录。
- [x] 逐项测试现有题库筛选、答案解析、题篮、题序/分值/分节、导出和学生边界；修复实际发现的问题。
- [x] 运行 `npm run test:miniapp-ui`，维护 18 页及角色状态清单，提供渲染截图证据；不得以首页证明全页面完成。

## 任务二 统一账单解析

**Files:** shared/personal-finance/billCsv.js、billCsv.test.js；cloud-business-api/src/billFileDecoder.js、billFileDecoder.test.js；格式覆盖登记。

- [x] 先执行以下回归断言并确认缺失模块或行为失败：

```js
const {parseBillCsv}=require('./billCsv');
const result=parseBillCsv('交易日期,收入金额,支出金额,摘要\n2026-10-08,0.00,88.50,消费');
require('assert').equal(result.records[0].amountMinor,'8850');
```

- [x] 实现 CSV 状态机、方向/金额/日期/币种/交易号/账户提示映射，保留原始行；错误返回具体行，不丢弃无提示。
- [x] 用真实 Excel、ZIP、PDF/HTML 解码测试覆盖附件；支持显式字段映射和加密/扫描附件的失败提示。
- [x] 单独运行 parser 和 decoder 测试，登记已实测模板及未知格式边界。不要编辑版本号和主 package scripts。

## 任务三 云端账本与统计

**Files:** shared/personal-finance/ledger.js、ledger.test.js；cloud-business-api/src/personalFinanceRepository.js、personalFinanceRoutes.js 及测试；cloud-business-api/sql/20261008-personal-finance.sql 及 PostgreSQL 验证。

- [x] 先写独立同额消费、银行卡支付多来源、转账双腿、退款、贷款/信用卡还款、余额未知和多币种回归测试，运行确认失败。
- [x] 实现所有者隔离的账户、来源记录、关联及余额快照存储；事务锁/幂等回执保证并发重试不重复入账。
- [x] 实现 `buildFinanceView`：可信引用匹配，不以同额同日硬合并；歧义明确提示；单/多/全部账户支持同一统计口径。
- [x] 注册独立路由模块，由主协调者在 app/server 接入；规范化数据由服务端校验。原始来源归档注入回调，不在数据库内存储公开文件或密钥。
- [x] 运行真实 PostgreSQL 权限、跨账户访问、事务回滚、幂等冲突、并发和迁移测试。

## 任务四 邮箱与终端接入

**Files:** cloud-business-api/src/billMailbox.js、billSourceArchive.js 及测试；cloud-business-api/src/app.js、server.js；src/pages/PersonalAssets.tsx 及独立金融页面组件/客户端；miniapp/src/pages/assets/index.tsx 与独立客户端。

- [x] 写分页、附件重复、未知来源、大小上限、下载失败和密钥不泄漏测试，再实现仅收件 AgentMail 适配器。
- [x] 原始文件使用私有受控存储，服务端密钥由受控配置注入，所有者绑定不靠客户端传入。
- [x] 桌面和小程序接入 ledger 与 preview/import；保留既有手工收支和旧账，取消虚假的本地邮箱接口承诺。
- [x] 提供账户组合、日期区间、消费/现金流视图、类别比较和本金/利息/费用展示；无依据时不显示假余额。
- [x] 验证端到端预览→整体确认→云端回执→刷新；离线草稿保持一次确认规则与会话范围隔离。

## 任务五 验证与统一发布

**Files:** package scripts、版本矩阵、项目部署和 OSS 发布脚本、output 验证证据。

- [x] 合并并进行规格与代码质量复核；相关测试及最终 `npm test` 已通过（2026-10-08 03:45 UTC）。
- [ ] 自动判断版本递增，构建小程序、桌面并验证 Node/Electron native 环境恢复。
- [ ] 备份云端代码与数据库，部署、迁移、重启，检查内网/公网及账户权限契约。
- [ ] 上传小程序并核验回执；发布 OSS 安装包与 latest.yml 并核验下载校验和。
- [ ] 提交 `自动发布 2026-10-08` 并推送 gewu/master；所有适用端有证据后才声明完整发布。

发布运行结果记录于 `output/personal-finance-integration-20261008/release-outcome.json`；此代码提交中的未勾选发布步骤不得被当作已发布证明。
