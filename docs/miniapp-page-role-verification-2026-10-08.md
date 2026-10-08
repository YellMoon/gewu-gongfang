# 小程序页面与角色检查记录（2026-10-08）

本记录对齐 `miniapp/src/app.config.ts` 的全部 18 个注册页面及 `miniappUiPageInventory.js` 的真实角色矩阵。`npm run test:miniapp-ui` 已通过，其中 `miniappUiCoverage` 检查注册路由、可跳转状态页、角色、状态、功能依据和 fixture 场景映射。本轮未获得全部页面的新截图，不能据此声明“小程序 UI 全部完成”。旧日期截图不能作为此次修改的渲染证据。

角色缩写：S = `super_admin`，T = `teacher`，U = `student`，F = `family_member`，V = `visitor`，G = 未登录。学生与家庭成员使用云端裁决的学生范围；教师只读取教师范围；小程序不编辑核心教务表或题库基础数据。

| 注册路由 | 角色归属 | 策略与真实功能依据 | 本轮检查状态 | 本轮截图状态 |
| --- | --- | --- | --- | --- |
| `pages/login/index` | G | 微信手机号证明、云端登录、桌面登录确认；无手工设备审批入口 | 路由/文案/场景注册检查通过；真实登录未验证 | 未验证 |
| `pages/login/privacy` | G | 登录页隐私链接与静态政策，`privacy-guest` 场景需点击进入 | 文案与布局契约通过；点击后的视觉未验证 | 未验证 |
| `pages/index/index` | S/T/U/F/V | 按权限展示现有路由，云端派生缓存，访客申请 | 五角色导航、会话失效、退出、重试和触摸检查通过 | 未验证 |
| `pages/forbidden/index` | S/T/U/F/V | 注册的无权限状态页与安全返回 | 路由/权限/场景检查通过 | 未验证 |
| `pages/schedule/index` | S/T/U/F/V | 云端课表只读；日/周切换、上海日期导航、教师学生筛选；访客不读教务数据 | auto 旋转配置、七列样式、真实 Taro 字号编译、四正式角色交互、访客空态通过；H5 教师周/日/滚动和学生横屏已截图核验；硬件旋转未验证 | [教师周横屏](../output/personal-finance-integration-20261008/screenshots/schedule-teacher-landscape.png)、[教师日视图](../output/personal-finance-integration-20261008/screenshots/schedule-teacher-day.png)、[教师日视图滚动](../output/personal-finance-integration-20261008/screenshots/schedule-teacher-day-scroll.png)、[学生周横屏](../output/personal-finance-integration-20261008/screenshots/schedule-student-landscape.png)；S/F/V 与竖屏截图尚未验证 |
| `pages/schedule/detail/index` | S/T/U/F | 云端派生排课详情、角色范围内学生明细 | 教务页正常/缺失/缓存/会话契约通过 | 未验证 |
| `pages/schedule/edit/index` | S/T/U/F | 只读边界说明，禁止小程序编辑排课 | 实际组件正常返回/直接启动恢复、四角色只读提示通过 | 未验证 |
| `pages/students/index` | S/T | 云端学生范围、搜索、详情导航 | 列表权限、搜索、详情、失败、缓存与过期会话检查通过 | 未验证 |
| `pages/student-detail/index` | S/T/U/F | 学生信息、缴费、成绩标签；学生/家属范围限制 | 四角色、三个标签、缺失记录、重试、返回、原生下拉和过期会话通过 | 未验证 |
| `pages/courses/index` | S/T/U/F | 云端课程范围、进行中/历史课程分区 | 正常/历史/角色/缓存/失败/刷新检查通过 | 未验证 |
| `pages/teachers/index` | S/T | 云端教师列表与已有课时费字段 | 人员页权限、搜索、刷新、会话检查通过 | 未验证 |
| `pages/payments/index` | S/T | 云端缴费金额与过滤、汇总 | 单位/整数分精度、全筛选、下拉、缓存、重试、角色和会话竞态通过 | 未验证 |
| `pages/stats/index` | S/T | 已实现的财务统计、课程类型统计、月度记录 | loading/下拉/缓存失败/过期会话检查通过 | 未验证 |
| `pages/question-bank/index` | S/T/U/F/V | 云端关键词、科目、题型、来源、知识点、难度、年级、学期、考试类型、学年；分页；富文本与受控媒体；S/T 题篮 | 实际组件全部筛选参数、分页去重、小题/答案解析、图片交付 ID 与 RichText 路径、上下标/分式、题篮、只读角色、换账号刷新通过；无结果/空库/离线/无权限通过；教师 H5 最终列表/展开已审阅，两列数值单位同一行、页内绿色题篮不遮挡 | [教师列表](../output/personal-finance-integration-20261008/screenshots/question-teacher-list.png)、[教师答案解析](../output/personal-finance-integration-20261008/screenshots/question-teacher-answer.png)、[打开题篮](../output/personal-finance-integration-20261008/screenshots/question-teacher-basket.png)；最后 CSS 的打开图已审阅：标题与取消全选整行，题干/排序/移出均可见；其余角色与图片公式字形未全验证 |
| `pages/question-paper/index` | S/T（U/F/V 拒绝） | 题篮选中子集、题序、分值、分节、Word/PDF 云端导出任务 | 实际组件小题/答案、题序、4.5 分、分节、导出请求、无效输入阻断、禁止角色预读取通过；交付轮询/下载/openDocument 契约通过；教师 H5 实际题篮进入组卷成功，1 题/3 总分可见 | [教师组卷](../output/personal-finance-integration-20261008/screenshots/question-teacher-paper.png)；真实云端产物未在本轮生成，H5 Word/PDF 按钮由主任务 AX 检查 |
| `pages/assets/index` | S/T（U/F/V 拒绝） | 有限财务导入、个人金融账户/账单由并行主任务更新 | 原页确认/重试/会话/权限/读取测试通过；新增实际组件换号/过期回调/卸载/同会话选文件返回/离线/空态/重复点击与一次整批导入测试通过；H5 Summary 挂载后成功读取账户，验收银行卡 12377.00 可见 | [教师金融账户](../output/personal-finance-integration-20261008/screenshots/finance-miniapp-accounts.png)；最新截图已澄清记录收支与金融账户统计；[统计拆分](../output/personal-finance-integration-20261008/screenshots/finance-miniapp-breakdown.png)显示消费301.30/收入2500.00/现金流2319.20与现金/信用类拆分；[学生资产无权限](../output/personal-finance-integration-20261008/screenshots/finance-miniapp-student-forbidden.png)已审阅，明确拒绝学生金融访问；真实微信选文件未验证 |
| `pages/settings/index` | S/T/U/F/V | 在线状态、已有云端投影刷新、退出和访客申请 | 退出取消/过期模态、清理、网络刷新、并发、离线、访客分支检查通过 | 未验证 |
| `pages/account-application/index` | V | 云端角色申请，不向正式 U/F 暴露访客申请路径 | 本地无效输入不发请求、角色 payload、拒绝后修改/重开、提交状态与过期会话检查通过 | 未验证 |

## 本轮修复与红绿记录

1. `schedule/orientationRuntime.test.js` 初始失败：缺少 `pageOrientation: 'auto'`。页面已添加自动方向配置，保留七列周视图。
2. 相同回归使用项目实际 Sass + `postcss-pxtransform`，再次失败：`14px` 被编译为 `28rpx`。采用 Taro 支持的 `PX` 保留课名/时间 `14px`、辅文 `12px`，行高分别 `20px`/`18px`；再次运行通过。只证明配置、编译单位与交互，不冒充设备上的实际字形证据。
3. `question-bank/featureParityRuntime.test.js` 初始失败：新会话返回页面没有再次读取题目。`useDidShow` 现在按会话清除旧题目/总数/筛选/媒体/分页，并刷新当前会话。相同测试通过。
4. `question-paper/cloudDelivery.test.js` 在 Windows 检查原源码时因 CRLF 正则失败，统一读取换行为 LF 后通过；生产组卷逻辑未因该测试修改。
5. 主任务渲染发现课程表启动落入无权限页；本机请求日志确认 app 启动与页面 did-show 发出两个权限请求。`permissionConcurrentRuntime.test.js` 在真实 `permission.ts` 上先复现双请求失败，随后按身份会话共享正在进行的云端权限请求并通过。未使用持久缓存授予权限，也未放宽学生/家属范围；旧会话完成回调不能清除新会话的请求锁。
6. 对主任务新增个人财务组件执行换账号回归，初版复现新账号“正在处理…”永久 disabled。主任务修复操作代际与卸载边界后，正式 `PersonalFinanceSummary.runtime.test.js` 验证旧回调、普通文件选择 hide/show、批次确认与重复点击均通过。
7. 同一组件的挂载但无 did-show 回归初始失败：读取次数 0，预期 1。父页异步载入后才挂载组件可能错过页面 did-show；组件现于 mount effect 主动 refresh，并保留卸载代际边界，相同测试通过。
8. 实际 H5 权限通过后出现课表读取失败。HTTP + 真实 `cloudBusinessProjectionRuntime` 回归初始报 `CLOUD_BUSINESS_PROJECTION_UNAVAILABLE`，确认验收数据缺少 `payments`/`grades` 数组及非空学生的数字余额字段。隔离 3028 数据补齐后，四正式角色 12 表、42 课次与上海本周日期检查通过；默认 capture fixture 也已补齐两表，其 HTTP 契约回归通过。
9. 主任务 CUA 在 844 × 390 截图确认顶部控件与重复日期条约占 300px，课程不可见。新增回归先失败；横屏现在保留 44px 触摸尺寸，间距与导航固定 PX，折叠与各周列重复的日期条，页底仅 8px + 安全区。真实 Taro 编译检查验证全部尺寸及 390px 高度内含原生 tab 的首行预算通过。主任务落盘的四张 H5 截图已实际打开审阅：教师七列首行的时间/课名/状态/房间可见，学生首行完整且第二行开始可见；教师日视图第一张卡片完整，滚动截图显示后续 10:00 与 11:00 课次。图片证明本机 H5 字形与布局，不代表微信硬件旋转。
10. 主任务题库截图实际显示四列选项数字和单位拆行，题篮入口透明描边且整宽覆盖卡片。实际组件回归先失败 `0 N`，呈现层现在仅对明确数值/已知单位替换 NBSP，不修改源题目数据、精度或 HTML 属性；引号中的 `>` 属性另有红绿防护。420PX 媒体条件经真实 Taro H5 编译保持 420px，窄屏四列转两列。题库题篮现位于筛选面板文档流，保留同一抽屉与角色限制；H5 双类样式覆盖 Taro 的默认透明/整宽按钮，入口保留 44px 触摸尺寸。最终列表/答案截图已打开审阅，四选项数值与单位在各自两列单行，绿色页内题篮不遮挡卡片。
11. 接续最终 H5 截图暴露 PageContainer 未按 show 隐藏关闭抽屉，移动入口后 78vh 空抽屉进入首屏。`QuestionBasketOverlay.runtime.test.js` 使用实际组件并模拟 PageContainer 忽略 show，先复现关闭时 1 个抽屉（预期 0）；现关闭时不挂载内容，H5 用固定遮罩/底部对话层，WeApp 保留原生 PageContainer。打开、遮罩关闭、关闭按钮、原生 after-leave/back、卸载及受限角色均验证，导航 overlay owner 释放检查通过。
12. 打开状态截图继续发现 Taro 的整宽关闭按钮及可收缩的 checkbox 标签把“取消全选”压成逐字列。真实编译回归先失败缺少 nowrap；现抽屉按钮用父/子双类选择器固定 14px 文本与 44px 高触摸尺寸、宽度按内容，标签不缩且不拆行，选择栏可整项换行，头/尾不收缩，压缩间距并为正文留空间。编译回归与实际组件生命周期检查通过；已打开审阅11:47最终题篮图，关闭按钮不拉满宽度，取消全选标签整行，题干与排序/移出在正文空间内清晰可见。

## 已执行验证

- `npm run test:miniapp-ui`：通过，覆盖上述 18 页面清单及 fixture 契约。
- `node miniapp/src/pages/schedule/orientationRuntime.test.js`：通过。
- `node miniapp/src/pages/schedule/cloudBusinessSchedule.test.js`：通过。
- `node miniapp/src/pages/question-bank/featureParityRuntime.test.js` 与 `emptyStateRuntime.test.js`、`cloudDelivery.test.js`：通过。
- `node miniapp/src/pages/question-paper/featureParityRuntime.test.js`、`cloudDelivery.test.js`、`downloadHandler.test.js`：通过。
- 共享 `questionDisplay`、`questionPaperWorkflow`、`questionBasketStore`、`questionBasketHydrationRuntime`、`questionPaperDownload`：通过。
- `questionAssetDelivery.test.js`：通过；实际题库页另外核验题目与资产 ID 请求、交付图片路径、小题/答案解析及分式/上下标送入 RichText。图像与字形的视觉仍需截图。
- `question-bank/typography.test.js`：通过，保留数值精度/不换行空格/HTML 属性，并核验真实 Taro 编译后的窄屏两列与页内题篮。
- `QuestionBasketOverlay.runtime.test.js`、`navigationOverlayRuntime.test.js`：通过，闭合内容没有 DOM、H5/WeApp 打开与关闭、卸载与无权限路径均覆盖。
- `npm --prefix miniapp run typecheck`：通过。
- `node miniapp/src/utils/permissionConcurrentRuntime.test.js`、`miniappPermissionFetchRuntime.test.js`、`miniappAuthorizationSession.test.js`：通过。
- `node miniapp/src/components/PersonalFinanceSummary.runtime.test.js`：通过。
- `node scripts/capture-miniapp-ui-matrix.fixture.test.js`：通过，使用真正投影读取器验证 HTTP 结果。
- `node output/miniapp-parity-20261008/projection-http.test.cjs`：通过，验证隔离服务器四角色的完整投影与数字余额。
- 本机 fixture 目标 `npm --prefix miniapp run build:h5`：成功；构建仍报告入口 372 KiB 超过 360 KiB 的警告。未因此放宽预算。

## 子任务变更文件清单

工作目录：`C:/Users/83423/.codex/worktrees/audit-fixes-20261007/scheduling-system`。以下路径以该目录为基准；其他并行任务的修改不归此清单。

- 课程表：`miniapp/src/pages/schedule/index.config.ts`、`index.scss`、新增 `orientationRuntime.test.js`。
- 题库：`miniapp/src/pages/question-bank/index.tsx`、`index.scss`、新增 `questionTypography.js`、`typography.test.js`、`featureParityRuntime.test.js`；更新 `emptyStateRuntime.test.js` 的真实组件依赖、`layoutContract.test.js` 的页内入口契约。
- 组卷：新增 `miniapp/src/pages/question-paper/featureParityRuntime.test.js`；`cloudDelivery.test.js` 仅规范读取 CRLF。
- 权限并发：`miniapp/src/utils/permission.ts`、新增 `permissionConcurrentRuntime.test.js`；`miniappPageAccess.test.js` 仅补新增财务组件依赖。
- 题篮实际呈现：`miniapp/src/components/QuestionBasketOverlay.tsx`、`QuestionBasketOverlay.scss`、新增 `QuestionBasketOverlay.runtime.test.js`。
- 新财务组件复核：`miniapp/src/components/PersonalFinanceSummary.tsx` 仅增加 mount 初次 refresh；新增 `PersonalFinanceSummary.runtime.test.js`。其余组件生产逻辑由主任务拥有。
- 验收投影：`scripts/capture-miniapp-ui-matrix.js`、`capture-miniapp-ui-matrix.fixture.test.js`，仅补齐默认空投影契约。
- 页面记录：本文与 `docs/miniapp-ui-page-inventory-2026-07-02.md` 的历史说明。
- ignored 验收工具与日志：`output/miniapp-parity-20261008/` 中的隔离 H5 服务器、金融 fixture、HTTP 投影回归、22 测试汇总、构建与清单日志。主任务截图位于 `output/personal-finance-integration-20261008/screenshots/`。

## 渲染与外部限制

本机 fixture 地址 `http://127.0.0.1:3028/qa`。查询参数 `role=teacher|super_admin|student|family_member`、`route=pages/schedule/index|pages/question-bank/index`、`width=844&height=390` 或 `width=390&height=844` 控制 QA 外框；iframe 内使用实际构建的 H5 组件，不向生产接口发送请求。bootstrap 身份来自真实 `cloudSessionUser` 转换，权限仍通过正常 cloud-context/页面策略验证。该服务器是测试证据辅助工具，不是产品功能。

微信开发工具门禁返回 `versionRelation=equal`（skill 0.3.2）、`loginExpired=true`、`tokenRequired=false`。未继续调用微信业务工具；实际 WeApp 横竖屏、上传与手机运行仍需已登录开发工具。子任务 CUA 新会话分别受到 IAB 子任务 visibility 限制和 Chrome request-header policy 加载错误，主任务正在接续浏览器截图。无生产部署/发布/版本号更新由此子任务执行。
