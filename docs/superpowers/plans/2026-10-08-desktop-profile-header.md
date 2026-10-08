# 桌面个人中心与标题栏实现计划

> For agentic workers: apply subagent-driven-development for the independent cloud profile task and reviews; execute coupled desktop tasks in sequence in the same isolated checkout. User approved the integrated layout on 2026-10-08.

**Goal:** 合并我的、设备与更新，并消除全部桌面页面的重复抬头及账号栏遮挡。

**Architecture:** 登录门禁通过 React Context 提供账号控件，AppShell 在标题栏正常布局中呈现。我的使用现有设备与更新组件，个人资料由已认证云端读取。旧导航进入对应个人中心区域；同步保留全局面板，审核留在管理区。

**Tech Stack:** React、TypeScript、Ant Design、Electron、Node、PostgreSQL、Playwright。

## 任务一 账号资料

- [x] 在云端新增自有资料读取测试，证明缺失或失效会话不能读取、不能通过输入账号标识读取别人资料、教师资料按实际关联标识读取。
- [x] 实现已认证个人资料读取，返回账号名、姓名、联系电话、科目及有来源的微信资料；缺失字段返回 null，OpenID 不得当作微信号。
- [x] 运行 `npm --prefix cloud-business-api run test:desktop-profile`，测试必须先失败后通过。主代理复核权限与字段来源。

## 任务二 标题栏布局

- [x] 新增真实浏览器几何回归检查：在 900、1200、1536 px 窗口中，用长姓名和双角色证明账号菜单、同步与刷新按钮均可点击且不重叠，标题只出现一次。
- [x] 创建 `src/components/DesktopAccountContext.tsx` 提供 `controls: React.ReactNode`，门禁使用 `<DesktopAccountContext.Provider value={{ controls }}>` 包裹业务应用。
- [x] 修改 `AppShell.tsx`，通过 `useContext(DesktopAccountContext)` 将 controls 放到 PageHeaderBar actions；同步也放到 actions，取消导航说明副标题。
- [x] 将 `.desktop-identity-runtime-bar` 改为正常布局控件，删除固定定位与 350/540 px 避让。AppShell 主体使用 flex 布局分配内容区，移除标题高度写死的计算。
- [x] 运行新浏览器回归与 `npm run test:desktop-layout`；证明旧定位会令回归失败，改后通过。

## 任务三 我的与管理导航

- [x] 导航测试验证 `normalizeNavigationTarget('system-params').page === 'my-account'`、旧设备路由进入我的设备区域；云同步仍打开既有全局面板。
- [x] 新增 `MyAccount.tsx`：个人资料卡片、默认收起的登录设备、软件更新区域。加载失败提供重试；离线明确最近资料状态，不伪造账号信息。
- [x] SystemSettings 提取为软件更新区域，正常状态只呈现版本和检查更新；下载、安装按钮按状态出现。
- [x] IdentityDeviceCenter 只管理本人设备；角色申请审核从我的分离成独立 `account-review` 路由，保留云端权限验证，教师导航不显示此入口。
- [x] 修订已有源码检查以符合新产品结构，运行身份、设备、更新、导航和同步相关检查。

## 任务四 工作台与全部页面

- [x] 工作台不再读取同步队列，仅保留课程、费用与题库三个快捷卡片；日期并入统一抬头。
- [x] 清理工作台重复说明、正常同步提醒和题库重复文案；保留原有真实课程、费用和试题提醒跳转。
- [x] 检查全部导航状态页；题库工具移除“压缩工作台”与重复说明，试题编辑的页面级标题迁入统一抬头，保留编辑操作和数量。
- [x] 通过实际组件渲染，逐页记录标题、操作可见性、滚动和角色差异。截图保存在 `output/desktop-profile-ui-20261008/` 的任务产物目录。

## 任务五 验证与发布

- [ ] 运行相关测试、TypeScript 与正式构建，执行完整 `npm test`；界面验证覆盖教师和超级管理员、离线与窄窗口。
- [x] 按最终组件改动自动判断版本增量，运行现有版本脚本和发布兼容检查，不递增未改动组件。
- [x] 由独立代理先检查设计符合性，再检查代码质量；所有发现修复后复核。
- [ ] 提交信息使用“自动发布 2026-10-08”；仅整合此工作区变更到 master，保留原目录已有文档与日志。
- [ ] 推送 `gewu/master`；若云端新增接口，先按既有脚本备份、部署并核验健康与权限契约，取得适用组件发布证据。
- [ ] 执行 `npm run dist:win` 和 `npm run publish:desktop-update`，核对 OSS feed 与安装包版本；恢复 Node ABI 后再运行相关验证。任何受阻目标如实标为部分发布。
