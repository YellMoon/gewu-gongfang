# 个人财务账单解析格式清单

更新日期：2026-10-08。本文描述解析能力与证据，不代表银行格式认证。测试文件中的样例全部是 **synthetic（合成）**，目前没有取得任何一家银行的真实脱敏导出文件。

## API 与字段契约

`parseBillCsv(content, { filename?, fieldMapping? })` 同步返回 `{ provider, templateId, records, errors, warnings }`。

`parseBillFile({ filename, base64?, buffer?, fieldMapping? })` 异步返回同一结果并附加 `fileHash`。`buffer` 接受 `Buffer` 或 `Uint8Array`，与 `base64` 二选一；`fileHash` 是原始上传字节的 SHA-256 十六进制字符串。未能取得有效文件字节时为 `null`。两种入口均返回错误诊断，不靠静默跳过错误行制造成功。

每条记录固定包含：

```js
{
  sourceTransactionId: '',
  occurredAt: '2026-10-01T12:34:56+08:00',
  date: '2026-10-01',
  amountMinor: '123456',
  currency: 'CNY',
  direction: 'debit', // debit | credit
  kind: 'expense',   // expense | income | transfer | refund | loan_drawdown
                    // debt_payment | interest | fee | unknown
  description: '', counterparty: '', category: '',
  paymentChannel: '', paymentAccountHint: '',
  balanceMinor: null, relatedReference: '',
  status: 'completed', // completed | pending | failed
  principalMinor: null, interestMinor: null, feeMinor: null,
  rawFields: {}
}
```

当前账单导入只接受人民币 `CNY`，不代表多币种账户功能只能建立人民币账户。人民币金额按分保存为十进制整数字符串；余额可为负数。解析过程中不经过浮点金额计算，不截断第三位小数，不恢复 Excel 文件已经丢失的数字精度。未带时区的本地账单时间按中国标准时间 `+08:00` 解释；带时区的输入保留其时区。仅有日期时使用当天 `00:00:00+08:00`。

`errors` / `warnings` 是 `{ line, code, message }[]`；CSV 的 `line` 是原文本物理行号，Excel 为工作表行号，PDF 为重建的文本表格行号。ZIP 文件名和工作表名写入诊断消息前缀。记录本身不增加来源字段；`rawFields` 只保存实际解释使用的映射字段，账号字段保存标准化尾号，说明、对方、类别和支付渠道中的长数字账号脱敏。未知原始列不复制到业务库，完整原件由导入服务私有加密归档。

`paymentAccountHint` 统一为四位尾号字符串：`尾号1234`、`****1234`、`中国银行(1234)` 和完整卡号都只产生 `1234`。字段缺失时，含银行/银行卡/尾号/掩码/括号尾号的支付渠道可提取尾号；无法确定尾号时为空字符串。导出的 `normalizePaymentAccountHint(value)` 可用于规范化账户的 `maskedIdentifier`，匹配前应采用相同四位尾号规范；尾号相同的多个账户不能自动确定唯一资金账户。交易流水号和关联交易号作为结构化业务标识保留，不套用卡号脱敏规则。

方向和金额有冲突、未知状态、非法日期、列数错误、非人民币、负数双列冲正等情况均进入 `errors`。`failed` 和 `pending` 记录仍保留状态，调用方不能把它们当作已入账交易。没有状态列时产生 `BILL_STATUS_ASSUMED_COMPLETED` 警告。PDF 成功提取也产生 `BILL_PDF_VERIFY_REQUIRED`，提交前必须人工核对列对齐、合计、金额和方向。

## 显式字段映射

`fieldMapping` 的键是规范字段名，值为原表头字符串或从 0 开始的列号。可映射字段为：`date`、`occurredAt`、`type`、`kind`、`direction`、`amount`、`incomeAmount`、`expenseAmount`、`sourceTransactionId`、`description`、`counterparty`、`category`、`paymentChannel`、`paymentAccountHint`、`balance`、`relatedReference`、`status`、`currency`、`principal`、`interest`、`fee`。

辅助配置为 `provider`、`defaultDirection: 'debit' | 'credit'`、`amountConvention: 'signed'`。仅在用户已核对源文件正负号含义后使用 `signed`：负数表示支出，正数表示收入。字段映射不提供任意状态值替换；未识别状态需要人工核验。未知格式给出 `BILL_HEADER_UNRECOGNIZED` 与映射提示，不依据银行名称臆测列含义。

```js
await parseBillFile({
  filename: 'bank-export.xlsx', buffer,
  fieldMapping: {
    date: '记账日', amount: '发生数额', direction: '收支标志',
    description: '交易用途', sourceTransactionId: '流水编号',
    balance: '可用余额', provider: 'custom-bank'
  }
});
```

表头别名全集以 `billCsv.js` 中导出的 `BILL_FIELD_ALIASES` 为准。金额、状态、方向的含义不能仅靠字段重命名改变。

## 模板与容器实测

| 格式/模板 | 实现与合成测试证据 | 真实样本状态 |
|---|---|---|
| 规范 `date,type,amount,category,note` | 精确金额、日期、说明、字段规范 | 无真实用户文件 |
| 支付宝 CSV 字段 | 交易创建时间、商品说明、交易号、商户订单号、收/支、金额、状态 | synthetic，待真实账单核对 |
| 微信 CSV 字段 | 交易时间、交易类型、商品、交易单号、支付方式、退款/转账、失败/待处理 | synthetic，待真实账单核对 |
| 银行通用双列 | 收入/支出金额、借方/贷方发生额、余额；零收入不遮蔽支出；负冲正拒绝自动解释 | synthetic，未认证任何银行 |
| 银行单列与借贷方向 | 日期、分开的日期/时间、流水号、对方户名、余额、借/贷、交易金额 | synthetic，未认证任何银行 |
| 云闪付通用字段 | 交易时间、交易类型、收支类型、金额、商户、订单号、状态 | synthetic，待真实账单核对 |
| 用户显式映射 | 非标准表头、已核对的金额正负号约定、字段缺失诊断 | synthetic |
| UTF-8、UTF-8 BOM、GB18030 | 真实字节编码/解码往返与哈希测试 | synthetic |
| XLS 二进制工作簿 | SheetJS 实际解析 OLE/BIFF 工作簿 | synthetic |
| XLSX 二进制工作簿 | 有界 ZIP 解压后 SheetJS 实际解析工作表；精度/公式/范围检查 | synthetic |
| HTML 表格（含 HTML `.xls`） | SheetJS HTML 解析、实体字符、显式映射；不执行脚本 | synthetic |
| ZIP | 多文件实际解压、每项解析、不支持文件诊断、条目/路径/膨胀限制 | synthetic |
| PDF 文本表格 | PDF.js 实际取字，按文字坐标重建行；永远提示人工核验 | synthetic，未覆盖复杂真实银行版式 |
| 加密/扫描文件 | PDF 加密和无文字扫描件、加密 Office 容器、加密 ZIP 给出核验/本地解密提示 | 合成加密 PDF 与 Office 容器测试；ZIP 加密标志检查 |

## 用户目标银行的真实格式验证状态

下面每一家机构都可尝试通用模板或显式映射。银行名称不意味着它的所有导出渠道、版本、地区及文件版式已支持。

| 银行/机构 | 真实样本验证 | 下一步 |
|---|---|---|
| 网商银行 | 未取得、未验证 | 取得脱敏账单与导出渠道，建立具名模板 |
| 微众银行 | 未取得、未验证 | 同上 |
| 中国工商银行 | 未取得、未验证 | 同上 |
| 中国农业银行 | 未取得、未验证 | 同上 |
| 中国银行 | 未取得、未验证 | 同上 |
| 中国建设银行 | 未取得、未验证 | 同上 |
| 中国邮政储蓄银行 | 未取得、未验证 | 同上 |
| 华夏银行 | 未取得、未验证 | 同上 |
| 杭州银行 | 未取得、未验证 | 同上 |
| 杭州联合银行 | 未取得、未验证 | 同上 |
| 江苏银行 | 未取得、未验证 | 同上 |
| 各地农村信用社/农商银行 | 未取得、未验证 | 按地区和导出渠道分别建立样本，不合并认证 |
| 中信银行 | 未取得、未验证 | 取得脱敏账单与导出渠道，建立具名模板 |
| 平安银行 | 未取得、未验证 | 同上 |
| 交通银行 | 未取得、未验证 | 同上 |
| 招商、兴业、浦发、光大、民生、广发、北京、上海、宁波、浙商等其他主流银行 | 未取得、未验证 | 每家逐步取得脱敏样本，不能由通用模板推导全覆盖 |

## 资源边界与缺口

- 原文件最多 10 MiB；CSV 共享入口文本最多 20 MiB；合计最多 10000 条记录。
- ZIP 最多 32 个条目，XLSX 内部最多 256 个条目；单条实际解压最多 20 MiB，累计最多 32 MiB。大于 1 MiB 的条目膨胀比不得超过 200。中央目录预检后仍对实际流式解压累计计数，拒绝伪造尺寸、重复/越界路径、分卷、ZIP64和嵌套 ZIP。
- 最多 10 个工作表，每表最多 10000 条记录、100 行前后说明和 128 列；超限拒绝而不截断导入。公式单元格、绝对值达到 `10^13` 或有效数字超过 15 位的 Excel 数字需先人工核验并以文本导出；金额保留两位小数的精度预算。文本金额没有该 Excel 数值限制。
- PDF 最多 100 页；文字提取量最多 20 MiB；无 OCR，不自动解析扫描件。复杂跨行、跨页、文字碎片、合计与空列版式可能不能还原为正确表格，错误与核验警告必须在预览中展示。
- 云端解码使用独立工作线程，堆限额 256 MiB、时限 20 s，每进程最多并发两次解析；资源超限、超时和繁忙有显式诊断。线程限制不是整个进程 RSS 的绝对上限，服务部署仍需容器资源限额。
- CSV/TXT 当前接受逗号分隔；未实现 TSV、分号 CSV、OCR、PDF密码输入、ZIP密码输入、XLSB、自动汇率换算或对所有银行的格式认证。
- `provider` 是表头/文件提示识别结果或用户映射标签，不是银行真实性验证。业务入账、重复检测、权限与批量确认由调用方的云端账本流程裁决。

## 依赖与测试入口

云端新增 `iconv-lite@0.7.2`、`pdfjs-dist@6.4.299`（Node.js 22.13+ / 24+）及 SheetJS CE `0.20.3` 官方 tarball。当前云端 Docker 基础镜像为 `node:24-alpine`。不使用主项目的旧 `xlsx@0.18.5` 处理新云端不可信文件。

官方文档：[SheetJS Node.js 安装](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)、[SheetJS 读取参数](https://docs.sheetjs.com/docs/api/parse-options/)、[PDF.js Node 文本提取示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs)。

```powershell
node --test shared/personal-finance/billCsv.test.js cloud-business-api/src/billFileDecoder.test.js
```

该测试入口验证规范化与真实容器读入；不替代真实银行样本验证，不代表前端整合、端到端入账、多端发布完成。
