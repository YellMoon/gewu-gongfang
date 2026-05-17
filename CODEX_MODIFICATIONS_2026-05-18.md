# Codex 修改记录（截至 2026-05-18）

本文记录最近几轮围绕格物工坊题库模块、Word 解析、试题预览、试题编辑、组卷、回收站、构建发布所做的主要修改。

## 当前版本与发布

- 当前安装包版本：`3.0.26`
- 最新提交：`c63d247 自动发布 2026-05-17`
- 上一轮完整功能提交：`e465d6a 自动发布 2026-05-17`
- 安装包路径：`dist/格物工坊 Setup 3.0.26.exe`
- 已推送远程：
  - `origin git@github.com:YellMoon/scheduling-system.git`
  - `gewu git@github.com:YellMoon/gewu-gongfang.git`
- 已按项目规则使用 `node scripts/upload-quark-clean.js` 上传到夸克网盘。

## Word 解析相关修改

涉及文件：

- `modules/question-bank/parsers/parse_word.py`
- `backend/src/services/questionBankService.js`
- `scripts/prepare-python-runtime.js`（沿用既有 Python runtime 打包流程）

主要变化：

- 继续使用既定讲义/试卷解析规则，不重写题号规则。
- 增强 DOCX 富内容解析：
  - 读取 `word/document.xml`
  - 读取 `word/_rels/document.xml.rels`
  - 抽取 DrawingML 图片
  - 抽取 VML 图片
  - 抽取 Word 自带公式 OMML
  - 抽取 Word 域代码公式
  - 抽取 MathType/OLE 公式对象
- 新增段落级富内容归属逻辑：
  - 图片/公式跟随当前题目解析流程挂载，避免图片跨题串题。
  - 空段落中只有图片/公式时，挂到当前题目，不再被后续题目误收。
  - 试卷格式富内容按题号递进挂载，不再粗暴按全文段落序号补挂。
- 新增普通 Word 上下标识别：
  - 识别 `w:vertAlign=subscript`
  - 识别 `w:vertAlign=superscript`
  - 转成 `<sub>...</sub>` / `<sup>...</sup>` 保存到题干文本中。
- 新增 OMML 简化文本转换：
  - 支持分式、上下标、根式、上下限、函数等常见结构的可读文本表达。
  - 避免页面出现 `romml`、`mHomml`、`komml` 等调试式残留。
- 区分普通题图和公式预览图：
  - 普通图片仍作为 `image` 展示。
  - MathType/OLE 预览图作为 `formula_preview`，归入公式区域。

验证样本：

- `D:\BaiduNetdiskDownload\2026届高三复习讲义-专题01-运动学.docx`
- 检查结果：
  - 解析题数：`88`
  - 含选项题数：`88`
  - 含公式题数：`49`
  - 上下标标记命中：`40`
  - 文本中不再残留独立 `omml` 字样。

## 试题预览显示修改

涉及文件：

- `src/pages/QuestionBankPreview.tsx`
- `src/components/QuestionPreviewCard.tsx`
- `src/components/QuestionRichContent.tsx`
- `src/components/QuestionRichText.tsx`
- `src/components/QuestionOptionsView.tsx`

主要变化：

- 新增公共试题卡片 `QuestionPreviewCard`，统一预览页、编辑页、组卷页的题目展示方式。
- 新增富文本显示组件 `QuestionRichText`：
  - 支持安全显示 `<sub>` / `<sup>`。
  - 对已入库纯文本中的常见物理量自动下标化，例如 `m1`、`v0`、`I0`、`Bz`、`T2`。
  - 保留搜索高亮能力。
- 新增选项显示组件 `QuestionOptionsView`：
  - 支持字符串选项。
  - 支持 `{ label, content }` 对象选项。
  - 支持把被挤在一行的 `A. ... B. ... C. ... D. ...` 拆成独立选项。
  - 4 个选项按长度自动选择 4 列、2 列或 1 列。
  - 5 个及以上选项固定每个选项一行。
  - 多列显示时每列使用 `repeat(n, minmax(0, 1fr))` 均分整行宽度。
- 预览页题目卡片现在显示：
  - 科目
  - 题型
  - 考试类型
  - 状态
  - 图片/公式标记
  - 题干
  - 选项
  - 图片
  - 公式可读文本/公式预览
  - 答案
  - 解析
  - 知识点
  - 模型
  - 来源
  - 编辑按钮
  - 加入/移出试题篮按钮

## 试题编辑页面修改

涉及文件：

- `src/pages/QuestionBankEdit.tsx`
- `src/components/QuestionPreviewCard.tsx`
- `src/components/QuestionRichContent.tsx`
- `src/components/QuestionOptionsView.tsx`

主要变化：

- 试题编辑页从表格展示改为与试题预览页一致的题目卡片展示。
- 默认显示待编辑/未编辑题目。
- 每道题卡片支持：
  - 编辑
  - 删除
- 编辑弹窗保留并支持：
  - 题干
  - 答案
  - 解析
  - 选项
  - 科目
  - 题型
  - 难度
  - 学年
  - 年级
  - 学期
  - 考试类型
  - 地区
  - 学校
  - 来源
  - 知识点
  - 模型
  - 公式
  - 图片
- 批量标注功能保留。
- 新增回收站入口。

## 删除与回收站机制

涉及文件：

- `backend/src/schema.sql`
- `backend/src/database.js`
- `backend/src/services/questionBankService.js`
- `backend/src/routes/questionBank.js`
- `src/services/browserDatabase.ts`
- `src/pages/QuestionBankEdit.tsx`
- `src/types/index.ts`

主要变化：

- `questions` 表新增 `deleted_at` 字段。
- 后端数据库迁移补齐 `deleted_at`。
- 删除题目时不再立即删除题干、图片、公式、知识点、模型关联。
- 删除行为改为：
  - `questions.deleted = 1`
  - 写入 `deleted_at`
  - 推送搜索删除任务
  - 写入事件总线 `question.changed`，action 为 `trash`
- 新增后端接口：
  - `GET /api/question-bank/questions-trash`
  - `POST /api/question-bank/questions/:id/restore`
- 新增 7 天回收站保留逻辑：
  - 7 天内可以恢复。
  - 超过 7 天后可清理内容、资产、知识点、模型关联。
- 本地 `browserDatabase` 同步增加：
  - `getDeletedQuestions()`
  - `restoreQuestion()`
  - `deleteQuestion()` 改为本地软删除并写入 `deleted_at`

## 组卷页面修改

涉及文件：

- `src/pages/QuestionBankPaper.tsx`
- `src/components/QuestionOptionsView.tsx`
- `src/components/QuestionRichContent.tsx`

主要变化：

- 组卷页显示题目时补充选项展示。
- 组卷页沿用富内容组件显示图片和公式。
- 修复加入试题篮后组卷页题目内容展示不完整的问题。

## 后端题目数据处理修改

涉及文件：

- `backend/src/services/questionBankService.js`

主要变化：

- 后端 `normalizeOptions()` 不再把 `{ label, content }` 选项对象强制压平成字符串。
- 保留选项结构，方便前端按 A/B/C/D 正确排版。
- 公式对象会继续规范化为 `question_assets` 中的公式资产。
- `_mapQuestion()` 返回 `deleted_at`。

## 前端类型与本地数据修改

涉及文件：

- `src/types/index.ts`
- `src/services/browserDatabase.ts`

主要变化：

- `Question` 增加：
  - `deleted?: boolean`
  - `deleted_at?: string`
- 本地题库读取时过滤回收站题目。
- 本地回收站题目 7 天后自动清理。
- 本地删除不再直接移除题目和版本记录。

## 验证命令

已运行并通过：

```powershell
python -m py_compile modules\question-bank\parsers\parse_word.py
npx tsc --noEmit
npm test
npm run build
npm run dist:win
```

构建说明：

- `npm run dist:win` 会自动执行：
  - 版本号递增
  - React 生产构建
  - Python runtime 准备
  - Electron native 依赖重建
  - Windows NSIS 安装包构建
  - Node 版本的 `better-sqlite3` 重建

## 已知注意事项

- 当前公式转换是“可读文本 + 上下标/分式等常见结构”的工程化展示，不是完整 LaTeX/MathML 排版引擎。
- MathType/OLE 的真实对象内容依赖 Word 内嵌对象本身；当前会保留 OLE 资产和预览图，并提取可识别文本。
- 旧数据中已经以纯文本形式入库的公式，显示层会尽量修正常见下标，但复杂公式仍需要重新导入或后续引入专业公式渲染库。
- Electron 打包期间 `better-sqlite3` 预编译包下载会出现 404/超时提示，但构建会 fallback 到源码构建，最终安装包已成功生成。

## 关键新增文件

- `src/components/QuestionPreviewCard.tsx`
- `src/components/QuestionOptionsView.tsx`
- `src/components/QuestionRichText.tsx`
- `CODEX_MODIFICATIONS_2026-05-18.md`

## 关键修改文件

- `modules/question-bank/parsers/parse_word.py`
- `backend/src/services/questionBankService.js`
- `backend/src/routes/questionBank.js`
- `backend/src/database.js`
- `backend/src/schema.sql`
- `src/pages/QuestionBankPreview.tsx`
- `src/pages/QuestionBankEdit.tsx`
- `src/pages/QuestionBankPaper.tsx`
- `src/components/QuestionRichContent.tsx`
- `src/services/browserDatabase.ts`
- `src/types/index.ts`
- `package.json`
- `src/generated/version.ts`
