# 题库公式编辑与组卷导出验证记录（2026-07-14）

## Task 12：导出偏好与多端任务运行时

- 桌面组卷页提供 Word 自带公式、EQ 域、MathType 兼容和 LaTeX 矢量公式四种模式，并明确 MathType 无可审计 writer 时按策略回退，不声称生成原生 MathType OLE。
- 普通电脑不再禁用导出；它会把精确、有序的题目 ID、答案位置和公式模式作为 V2 任务提交到云中继。云端未确认或没有在线主机时仅保留本地草稿，不显示为已受理。
- 任务记录持久化并可在重启后恢复，覆盖排队、主机不可用、领取、快照、渲染、校验、发布、完成、失败、取消和超时；支持取消、用新幂等键重试、刷新以及鉴权下载。
- 完成产物先以 JWT/设备身份换取短期 artifact header token；410 时只换签一次，下载 URL 和日志不携带 token。
- 桌面 Playwright 真实运行验证：提交后轮询到完成并下载 `paper.pdf`；取消中的 55% 渲染任务后状态变为“已取消”；新鲜会话控制台 0 error、0 warning。
- 桌面 720px 验证：`documentWidth = viewportWidth = 720`，无横向溢出；导出偏好、任务卡、题目编辑区及答案预览均可见。截图位于本地验证产物 `output/playwright/desktop-task12-720.png`。
- 小程序仅消费最小题目预览索引，索引不包含答案、解析、富文本、公式原始载荷或 OLE；同租户角色裁剪和草稿可见性在 backend/gateway 合同测试中通过。
- 微信开发者工具 Stable v2.01.2510290、基础库 3.15.2 真机模拟验证：`pages/question-bank/index` 可呈现题库组卷、答案位置、四种公式模式、离线提示、三个真实任务入口及任务记录；没有页面渲染异常。
- 开发者工具本地环境将 `http://127.0.0.1:3999` 判为非合法 request 域名，预览请求重试后进入“离线或云端不可达”状态。该错误属于本地测试域名限制，已保留为发布前真实域名/白名单检查项，不把本地离线态误报为云端联通成功。

## 已执行门禁

- `npm run test:paper-export-desktop`
- 题目预览索引、组卷 workflow、授权策略、backend/gateway relay HTTP、host task 聚焦测试
- `npx tsc --noEmit`
- `npm --prefix miniapp run typecheck`
- `npm --prefix miniapp run build:weapp`

## 后续验证边界

- Task 13 已用同一复杂题目完成四种 DOCX 模式及对应 PDF 的逐页检查，证据见下节。
- DOCX 已由 Microsoft Word 真实打开、导出并逐页检查；LibreOffice 仍不可用，因此本次不把 LibreOffice 作为额外渲染器证据。
- Task 14 仍需完成阿里云、本地数据主机、小程序上传和桌面 OSS 更新矩阵，任一端受平台或权限阻断时只能记录为部分发布或受阻。

## Task 13: formula render matrix

- The same complex rich-content fixture generated 16 artifacts: four requested formula
  modes, two answer positions, and DOCX/PDF for every combination.
- Every artifact passed the final formula-visible gate with seven indexed formulas and no
  visible LaTeX source, unresolved marker, missing relationship, crop, or zero-size result.
- DOCX Word-native and EQ modes stayed editable with zero fallback. MathType-compatible
  DOCX used the explicit audited-policy fallback to LaTeX vector because no MTEF/OLE writer
  is available. PDF requests for native/EQ/MathType also reported vector fallback.
- All eight DOCX files opened without repair in Microsoft Word and were exported by Word
  to PDF. All 16 Word-rendered pages were rasterized and reviewed at 150 DPI.
- All eight direct PDF files (16 pages) were independently rasterized and reviewed at
  150 DPI. Fractions, roots, integrals, cases, Greek symbols, the embedded image, choice
  summary, footer, and both answer layouts remained visible without clipping or overlap.
- Visual review found and regression-tested five production defects: rich choice summaries
  leaking LaTeX source; valid Word-normalized OMML tags being rejected; generated relationship
  IDs overwriting template footer references; OPC content-type defaults being emitted after
  overrides; and answer blocks splitting across pages. The final matrix includes the fixes.
- LibreOffice remains unavailable in this environment. Microsoft Word is therefore the
  authoritative DOCX renderer for this verification, not a structural-only substitute.
