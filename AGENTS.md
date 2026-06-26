# Agent 持久指令

## 当前项目

- 项目：`scheduling-system`（格物工坊）
- 正式远程仓库：`gewu`
- 默认推送分支：`gewu/master`

## 每次修改代码后的默认流程

1. 运行与改动相关的测试；风险较高时运行 `npm test`。
2. 执行：
   - `git add -A`
   - `git commit -m "自动发布 YYYY-MM-DD"`
   - `git push gewu master`
3. 不再默认推送 `origin/master`。
4. 不再默认打包安装包。
5. 不再默认上传夸克网盘。

## 打包和上传

只有在用户明确要求“打包”“生成安装包”“上传夸克网盘”时，才执行打包和上传流程。

如果用户明确要求打包：

1. 递增 `package.json` 版本号。
2. 执行项目构建命令，当前项目优先使用：
   - `npm run build && npx electron-builder --win`
3. 找到生成的安装包/构建产物。

如果用户明确要求上传夸克网盘：

- Codex 使用：`node scripts/upload-quark-clean.js`
- Qoder 使用：`node scripts/upload-quark-qoder.js`
- 不使用旧脚本：`node scripts/upload-quark.js`
