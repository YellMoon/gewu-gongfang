# 微信小程序审核体验统一发布验证（2026-07-15）

## 发布范围

- 统一版本：`5.14.4`
- 永久审核体验入口：管理员、学生
- 数据边界：固定脱敏示例、只读业务页、独立内存组卷与 DOCX/PDF 导出沙箱
- 发布矩阵：阿里云 Gateway/Backend、微信小程序、本地数据主机、其他电脑 OSS 桌面更新

## 本地发布前验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | 通过，150.5 秒 |
| `npm test`（提升至 `5.14.4` 并修复 lockfile 同步后） | 通过，570.4 秒 |
| `npm run build` | 通过，317.8 秒 |
| `npm run miniapp:release-check` | 通过，134.4 秒 |
| Gateway 隔离生产依赖安装与核心依赖加载 | 通过，167.7 秒 |
| Node `better-sqlite3` 原生 ABI 冒烟 | 通过 |
| 审核体验规格复核 | 通过 |
| 审核体验代码质量/安全复核 | 通过，Critical/Important/Minor 均为 0 |

## 版本一致性

- `package.json`：`5.14.4`
- `backend/package.json`：`5.14.4`
- `package-lock.json`：`5.14.4`
- `package-lock.json` 根包条目：`5.14.4`
- `src/generated/version.ts`：`5.14.4`

版本工具已增加 lockfile 同步回归测试，避免后续发布再次出现根包与 lockfile 版本漂移。

## 待完成的发布证据

以下项目在本地验证阶段尚未执行，不能据此声明统一发布完成：

- 阿里云代码与数据库备份、部署、内外网健康检查和公开审核体验冒烟
- 微信小程序开发版上传、管理员/学生路径截图与交互核验、审核提交或平台阻断记录
- 本地数据主机升级、题库盘和同步链路核验
- Windows 安装包、OSS `latest.yml`、哈希/大小、打包后 Node ABI 恢复与 packaged smoke

真实审核体验码不写入本文件或 Git；仅在受控发布环境和微信平台私密审核备注中使用。
