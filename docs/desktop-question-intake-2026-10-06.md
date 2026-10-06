# 题库录入端解析与 NAS 存储分离（2026-10-06）

本次完善将新 Word 导入的解析、图片尺寸提取、微小网站标识清理移到统一桌面端。点击“开始解析”只在本机运行安装包内的 Python，不读取云端授权、不上传原件；解析结果在录入页供校对，所有题目部分继续使用现有富文本/LaTeX/图片编辑器。清理只影响题目候选内容，导入原件按原始字节归档。

确认生成待提交草稿后，云端授权账户与租户、重算候选摘要及校验结果，分配媒体对象和归档任务。NAS 8.8.4 使用原有加密 `relay` 协议写入原件及保留媒体，不执行新任务的 Word 解析或业务裁决。校对新增图片纳入媒体清单，删除图片退出清单；全部归档回执通过才允许准备草稿。最终题库写入仍走现有云端业务命令和同步面板整体确认流程。

生成后的本地草稿仍可编辑；后续新增图片使用既有云端附件中继流程，未验证附件不能由云端交付。候选及正式导入提交的富文本使用编辑器同一份规范校验；云端编译产物 `shared/questionRichContentContract.js` 由规范源码生成，默认测试检查漂移。

新接口为 `/api/desktop/question-imports/parsed`、`/:taskId/media/:mediaId/relay`，`relay-key` 声明 `intakeProcessing: desktop-v1`。旧云端不具备能力时拒绝提交，不回退 NAS 解析。旧导入任务保留既有解析器证明及流程。新增迁移为 `20261006-desktop-question-intake.sql`；桌面解析器摘要只作审计，不代表可信业务验证。

候选校对在当前窗口保留，尚未生成的预览不会跨退出恢复。旧版二进制 `.doc` 需要先另存为 `.docx`；原有解析器没有二进制 Word 转换能力。本次未引入外部 Word/LibreOffice 依赖。

编辑与显示要求沿用已验证的六个内容区域：题干、选项、小题、答案、解析及附加内容均可编辑文字、LaTeX 公式和图片。图片支持上传、删除、调整位置、大小与对齐；默认显示尺寸来自 Word 中每次出现的宽高，默认编辑字体与题目显示字体一致。微小标识清理规则覆盖这些内容区域，公式预览受到保护；按尺寸与明确标识信息识别，未实现图像像素 OCR，不声称识别所有未知图标。既有编辑器的六区操作与渲染证据见 `docs/question-image-editor-2026-10-06.md`。

## 验证与发布记录

- 实际内置 Python：原件摘要不变、两处微小标识清除、正常图片约 107.5 × 49 px、LaTeX 可编辑、临时目录清空。
- 客户端：解析先于任何网络请求、断网本地解析、云端能力门禁、候选摘要、加密媒体、已验证媒体跳过、未知结果重试复用原始请求。
- 真实 PostgreSQL：账户/租户隔离、篡改与摘要重算、幂等、过期隔离、旧解析器证明、原件/所有媒体回执门禁、并发回执及提交后中断恢复。
- 版本目标：桌面 8.12.0、云端 8.14.0；NAS 运行版 8.8.4 和小程序开发版 8.8.27 保持兼容。
- Chrome 151 与 Electron 28.3.3 实际离线窗口通过：0 业务请求、原图尺寸、LaTeX、文字编辑与上传新增图重开；字体实际渲染记录为 SimSun。截图与报告：`output/playwright/question-intake-20261006/`。
- 实际页面归档/草稿恢复 fixture 通过：准备响应丢失、第二条本地创建中断后恢复，仅生成两条有效草稿、任务创建一次、准备一次，无重复。
- TypeScript 检查及最终 `test:question-intake` 通过。云端完整 `npm test` 退出 0；根 `npm test` 汇总进程发生既有 Windows 原生 fast-fail（-1073740791，无断言错误），使用该完整云端结果和相同命令续跑覆盖默认套件，续跑 334–451 全部退出 0。证据：`output/question-intake-cloud-full-20261006.log`、`output/question-intake-full-tests-20261006.log`、`output/question-intake-full-tests-continuation-20261006.json`。
- 独立规格与代码质量审查已关闭回执恢复、草稿恢复去重、图片键、题型别名、陈旧响应等问题；发布前还复核富文本与媒体清单的一致性。
- 功能源码提交 `3b5eb377`、修整提交 `47eb7a8c` 已推送 `gewu/master`；本次构建与部署使用 `47eb7a8ca671fb377954c84640350c5c815ae9ee`。
- 云端 8.14.0 已部署并运行：部署前 PostgreSQL 备份 `/root/scheduling-backups/postgres/20261006-035659` 完成隔离恢复及权限校验，SHA-256 为 `247f8c531bc869579195e37d315192221614e0e28bc8ed98045f7c926cfb6d82`；旧 8.13.0 镜像及回滚容器保留。新增迁移已实际落库，文件摘要、处理位置字段、媒体中继表及不可变审计触发器核验通过。内网/公网健康、业务权威、角色权限与旧接口退役检查通过；未授权候选提交返回 403。证据：`output/question-intake-cloud-deploy-8.14.0-20261006.log`、`output/question-intake-release-20261006/cloud-verification-8.14.0.log`、`cloud-intake-schema-8.14.0.json`、`cloud-public-8.14.0.json`。
- 桌面 8.12.0 的 `dist:win`、实际安装包启动、包内 Python 导入及打包后的导入回归全部通过。包内清除两处标识、保留约 107.5 × 49 px 图片和 LaTeX；临时文件清空。打包后根项目及 backend 已恢复 Node ABI 137，包内 Electron ABI 119 验证通过。证据：`output/question-intake-dist-win-8.12.0-20261006.log`、`output/question-intake-release-20261006/packaged-smoke-8.12.0.log`、`packaged-intake-8.12.0.json`、`post-package-tests-8.12.0.log`。
- OSS 自动更新已发布：安装包、blockmap、版本归档及 `latest.yml` 上传通过。2026-10-06 12:02:53（北京时间）公开下载校验版本 8.12.0，本地与公网完整安装包均为 150450476 bytes，SHA-512 均为 `42EasFDVqRas/Pz/KlUkYEHbn2kwLZ3Mxi/BIlZ7jcStAkbUU9ICjWMzCBR7prfY6j534+4dk1I9r5LzUn3ISw==`。证据：`output/question-intake-release-20261006/oss-publish-8.12.0.log`、`oss-verification-8.12.0.json`。
- NAS 未部署更新，实际运行 8.8.4。云端新收到的运行回执 `storage_runtime_receipt_ddb76506-0649-4409-9155-55a5cd0fc03f` 于当天 11:53:55（北京时间）报告既有中继契约 3 和原解析器摘要；该版本足以存储本次桌面解析后的原件及媒体。仓库 storage-agent 8.9.0 为源码候选版本，不能冒充运行版。证据：`output/question-intake-release-20261006/nas-cloud-receipt.json`。
- 本次适用的桌面与云端更新已发布，NAS 运行兼容已核验。小程序没有代码或协议变化，沿用 8.8.27 开发版上传及兼容回执，未重新上传或声称正式版发布；统一矩阵仍保留“部分发布”，不声明所有端正式发布完成。矩阵：`output/release-matrix-desktop-8.12.0__cloud-business-8.14.0__storage-proxy-8.9.0__miniapp-8.8.27/active.json`。
