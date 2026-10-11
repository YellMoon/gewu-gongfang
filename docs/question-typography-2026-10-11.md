# 题目编辑与展示排版修正 · 2026-10-11

桌面编辑器的 KaTeX 默认字号原为正文的 1.21 倍，本次统一为 1em，沿用题目显示的字号，不改写公式内容及数学引擎内部上下标比例。小题题号直接插入首段前，适用于解答题和实验题共用的结构化展示；后续段落、手动换行和小题答案仍保留。小题题号和选择题字母用常规字重。

文字选项采用首行基线对齐，多列中的高分式也对齐同一行。结构化及旧格式图片选项都采用嵌入式图片基线，图片紧接字母，不再继承题干图片的块级居中与自动外边距。同排不同高度的选项图片共用底边基线。题干图片的文档尺寸与对齐仍按原稿呈现。

验证命令：`npm run test:question-typography`、`npm run test:rich-content`、`node src/components/StructuredQuestionViewer.test.js`、`npx tsc --noEmit`、`node scripts/update-version.test.js` 均通过。实际组件夹具在 Chrome 和 Electron 验证编辑输入、保存、重新打开，检查 1280 px 和 540 px 宽窗口，未发生页面运行异常。正文/公式均为 16 px，真正下标为 11.2 px；KaTeX_Math 实际加载为自带字体。文字选项基线、图片底边和选项字母基线的偏差均小于 1 px；结构化图片与字母间距约 5.6 px。多段正文和手动换行保留。

截图及测量回执：`C:/Users/83423/AppData/Local/Temp/gewu-question-typography-20261011/` 下的 `chrome-desktop.png`、`electron-desktop.png`、两端 `*-narrow.png` 和 `*-report.json`。验证使用隔离草稿与测试图片，不修改生产题库；未对附件对应的生产试题逐题回写。

桌面补丁版本自动判定为 8.18.3；云业务 8.18.2、NAS 8.9.1、小程序 8.10.0 的实现和协议未改变，保留原始核验时间并沿用对应兼容回执。最终源码提交 `37a426a7` 已推送 `gewu/master`，桌面 OSS 更新已完成并核验。小程序既有回执为开发版，多端正式发布仍为部分发布。

已有设备名称文档修改与旧浏览器日志未纳入本次提交。

用户追加的题号布局已并入本次尚未发布的 8.18.3：主题号改为与题干同字号、常规字重的“1.”，复选框位于题号下方，共用自适应窄侧栏。正文仍悬挂缩进，单数字编号在可选题卡中仅占 22 px（原布局约 74 px），三位数编号自然扩宽且小于 40 px。结构化题卡和旧格式题卡、两端窄窗口都已截图检查；勾选保持受控状态，且不误展开答案。`QuestionPreviewCard` 两项行为回归及类型检查通过。追加截图为同一证据目录下的 `*-question-card.png`、`*-question-card-narrow.png`。

最终发布核验：`npm run dist:win` 退出 0，生产构建、最终包启动检查通过；包内 Electron ABI 119、恢复后的根目录及 backend Node ABI 137 均通过，SQLite GC 和题库服务回归通过。恢复后 `npm run test:rich-content` 再次通过。OSS 安装包、版本归档安装包、公开及归档 `latest.yml` 四项上传均 HTTP 200。公开完整安装包下载校验为 176432089 bytes，SHA-512 为 `uwmxuRFFY/gxJ5y8CHONHVqfdfZAZD3asOHfroBpq5nyz0ZWXrS2MSP13OLRWM8iOadegVR81pP625yZJ82w2A==`，与本地一致；公开/归档 feed 均为 8.18.3。回执：`C:/Users/83423/AppData/Local/Temp/gewu-question-typography-20261011/oss-verification-8.18.3.json`。云端公网健康再次确认 HTTP 200、8.18.2、业务权威 cloud。桌面更新完成；小程序原有开发版回执未改变，多端正式发布仍为部分发布。
