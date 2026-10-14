# 试题导出图片与选项排版修复

默认独立图片随题干排版，位于选项和小题之前。已有富文本图片继续保留明确的题干、选项、小题、答案位置；附件清单不会重复插入已定位图片或公式预览。

Word 和 PDF 共用图片尺寸计算：以原图比例等比缩放，源宽高作为边界，默认限制为 420 × 280 CSS px，不放大小图；PDF 将 CSS px 转换为物理点。源数据中的不等比宽高不会继续拉伸图片。选项统一为全角点 U+FF0E，例如 A．内容，点后不添加空格，并清理选项内容起始的空白。

验证覆盖无尺寸、仅宽、仅高、宽高冲突、横图、竖图、小图、显式插图位置、图片选项分栏与分页、Word/PDF 物理尺寸一致性。新增回归入口为 `cloud-business-api/src/paperExportImageDefaults.test.js`，接入现有导出测试。

视觉证据位于 `output/paper-layout-20261014/`。两页 PDF 均已渲染检查；DOCX 由本机 Microsoft Word 导出 PDF 后，两页均已检查。内置 render_docx.py 因缺少 LibreOffice 无法运行，采用实际 Word 渲染补充。PDF 文本提取确认 A 后为 U+FF0E，且没有半角点加空格。样张为合成回归数据，不代表历史导出文件已经重写。

本次为兼容性修复，无接口、权限、数据结构、NAS 协议或小程序源码变更。版本为桌面 8.22.1、云业务 8.20.1；NAS 8.9.2、小程序 8.10.1 沿用已有兼容版本。

完整云端导出回归、桌面/小程序实际导出调用检查、38 项公式导出检查，以及版本与兼容矩阵检查均通过。修复提交为 `c3a44cf84657a87931cc83dd4eda869dc807e95f`。

云业务 8.20.1 已部署，内网/公网健康和权限契约检查通过。代码镜像备份为 `/root/scheduling-backups/cloud-code/20261014-051307/cloud-image.tar.gz`，SHA-256 为 `513fa66580adcf5776442d29b91c919517273c7c9fb2650596640cf4688b165a`。数据库备份为 `/root/scheduling-backups/postgres/20261014-052253`，SHA-256 为 `0aacc0e1c4f3bc166a202e0d33de2dfdc33b2f5b04553349527f3439b2b982fd`，隔离恢复、所有权与权限核验通过。

首次部署在切换前因服务器磁盘满导致备份恢复校验失败。只清理 Docker 构建缓存，保留数据库、旧镜像和备份；对已构建镜像的 542 个文件逐一验证 SHA-256 并运行新增回归后复用镜像，继续标准备份、迁移、候选服务及推广锁流程。迁移全部为已应用状态。证据保存在 `output/paper-layout-20261014/cloud-resume.log`。

桌面 8.22.1 已从独立干净工作区构建并发布 OSS。安装包为 150164346 字节；公开下载回读的 SHA-512 为 `CmRYXTj8s13xBXZIAIXFNeK4BQC1RSeKUadqI4tLcS9O2PVqPgSsEsfrC2252v6hx0m30jJS0Xp8F7UymbGqTw==`，与更新 feed 一致；公开 `latest.yml` 与本地产物逐字一致。安装包 Electron ABI 119 验证通过，打包后根目录及 backend 均已恢复 Node ABI 137，SQLite GC/退出与 questionBankService 验证通过。证据为 `desktop-build.log`、`desktop-publish.log` 和 `oss-verification.json`。

本次云端和 OSS 桌面更新已完成。全项目矩阵仍为部分发布：未变更的小程序 8.10.1 沿用已有开发版上传证据，不能据此声称小程序正式版已发布。原有未提交文档与浏览器记录均保留，未混入修复提交。历史导出文件不会自动改变，需要重新导出。
