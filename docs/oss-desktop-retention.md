# 桌面安装包 OSS 保留策略

安装包统一保存为 `desktop/<安装包文件名>`，每个版本只上传一份 EXE。`desktop/releases/<版本>/latest.yml` 只保存回滚元数据，仍引用同一份安装包。`desktop/latest.yml` 的路径及客户端更新协议保持兼容。

每次发布先上传安装包和版本元数据，最后切换当前 feed；成功后执行清理。默认保留当前版本及两个较早版本，其他版本的文件至少保留七天；已核对大小和 ETag 一致且未被保留 feed 引用的归档重复包可直接移除。未来版本、无法识别的文件及其他目录不在清理范围内。本地安装包不受云端清理影响。

清理前核对当前及保留版本的安装包仍可访问、大小匹配；将完整对象清单写入 `output/oss-retention/`。每次删除前重读当前 feed，并核对待删除对象的 ETag、大小和修改时间；发现并发变更即停止。发布时清理失败会明确记录 `retention.status: blocked` 并输出警告，不阻断已上传更新包的使用。独立清理命令失败时返回非零退出码。清单用于审计，不是安装包内容备份。

只读预览：`node scripts/publish-oss-feed.js --cleanup-only`。

执行清理：`node scripts/publish-oss-feed.js --cleanup-only --apply`。

回滚可直接使用保留版本的 feed。更早的版本需先从本地备份恢复安装包与该版本的 feed，再执行回滚；不得将 feed 指向已清理的安装包。

发布身份 `oss-desktop-user` 需要现有读取、列举和上传权限，以及 `config/oss-desktop-retention-policy.json` 中限定至本桶 `desktop/` 的 `oss:DeleteObject` 权限。该策略不允许删除桶或修改权限，不包含其他目录。2026-11-23 首次执行清理时返回 403，审计记录显示删除数量为零；须授权后重试才能声明云端清理完成。

发布与保留测试：`node scripts/publish-oss-feed.test.js`，包含清理预览、重复包、保留版本、七天缓冲、越界文件、并发 feed 和对象变更的检查。
