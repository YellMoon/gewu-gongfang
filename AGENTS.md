# Agent 持久指令

## 自动发布流程（所有项目通用）

每次修改代码后，自动执行以下流程：

1. **版本号更新**
   - 每次生成并上传安装包前，必须递增 `package.json` 版本号。
   - 不允许重复上传同版本同文件名安装包，避免夸克网盘判定为重复或风险文件。

2. **Git 提交推送**
   - `git add -A && git commit -m "自动发布 YYYY-MM-DD"`
   - 推送到所有远程仓库（origin、gewu 等）。

3. **打包安装包**
   - 执行项目对应的构建命令。
   - 当前项目优先使用：`npm run build && npx electron-builder --win`
   - 找到生成的安装包/构建产物。

4. **上传夸克网盘**
   - 上传到夸克网盘对应 Agent 的项目文件夹：`项目文件夹/当日日期/`。
   - 如文件夹不存在则自动创建。
   - 如果当前执行者是 Codex：必须使用 `node scripts/upload-quark-clean.js`，上传到 `codex项目/当日日期/`。
   - 如果当前执行者是 Qoder：必须使用 `node scripts/upload-quark-qoder.js`，上传到 `Qoder项目/当日日期/`。
   - 不要使用旧脚本 `node scripts/upload-quark.js`。

## 适用范围

- 当前项目：`scheduling-system`（格物工坊）
- 所有其他项目
