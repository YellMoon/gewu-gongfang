# Agent 持久指令

## 自动发布流程（所有项目通用）

每次修改代码后，自动执行以下流程：

1. **Git 提交推送**
   - `git add -A && git commit -m "自动发布 YYYY-MM-DD"`
   - 推送到所有远程仓库（origin、gewu 等）

2. **打包安装包**
   - 执行项目对应的构建命令（如 `npm run dist:win`、`npm run build` 等）
   - 找到生成的安装包/构建产物

3. **上传夸克网盘**
   - 上传到夸克网盘 `opencode项目/当日日期/` 文件夹
   - 如文件夹不存在则自动创建
   - 使用项目内的 upload 脚本（如 `node scripts/upload-quark.js`）

## 适用范围

- 当前项目：`scheduling-system`（格物工坊）
- 所有其他项目
