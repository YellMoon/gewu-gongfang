# 小程序页面与角色检查记录（2026-10-08）

本记录对齐 `miniapp/src/app.config.ts` 的全部 18 个注册页面及 `miniappUiPageInventory.js` 的真实角色矩阵。`npm run test:miniapp-ui` 已通过，其中 `miniappUiCoverage` 检查注册路由、可跳转状态页、角色、状态、功能依据和 fixture 场景映射。本轮未获得全部页面的新截图，不能据此声明“小程序 UI 全部完成”。旧日期截图不能作为此次修改的渲染证据。

角色缩写：S = `super_admin`，T = `teacher`，U = `student`，F = `family_member`，V = `visitor`，G = 未登录。学生与家庭成员使用云端裁决的学生范围；教师只读取教师范围；小程序不编辑核心教务表或题库基础数据。

| 注册路由 | 角色归属 | 策略与真实功能依据 | 本轮检查状态 | 本轮截图状态 |
| --- | --- | --- | --- | --- |
| `pages/login/index` | G | 微信手机号证明、云端登录、桌面登录确认；无手工设备审批入口 | 路由/文案/场景注册检查通过；真实登录未验证 | 未验证 |
| `pages/login/privacy` | G | 登录页隐私链接与静态政策，`privacy-guest` 场景需点击进入 | 文案与布局契约通过；点击后的视觉未验证 | 未验证 |
| `pages/index/index` | S/T/U/F/V | 按权限展示现有路由，云端派生缓存，访客申请 | 五角色导航、会话失效、退出、重试和触摸检查通过 | 未验证 |
| `pages/forbidden/index` | S/T/U/F/V | 注册的无权限状态页与安全返回 | 路由/权限/场景检查通过 | 未验证 |
| `pages/schedule/index` | S/T/U/F/V | 云端只读角色范围；桌面两周、每周七列的真实时间网格；上一周/本周/下一周；课名/地点/完整起止时间/共享课色；访客不读教务数据 | 实际组件与桌面 AST 结构/几何/最终静态色回归通过；5min/2.5px、默认08–23、早晚扩展、重叠顺序、14日、无额外筛选/总结/计数通过；最终H5四正式角色、横竖屏/全天/第二周/两轴滚动/底栏/三个导航按钮实测通过；微信硬件旋转未验证 | 最终 [管理员](../output/personal-finance-integration-20261008/screenshots/schedule-admin-two-weeks.png)、[教师](../output/personal-finance-integration-20261008/screenshots/schedule-teacher-two-weeks.png)、[学生](../output/personal-finance-integration-20261008/screenshots/schedule-student-two-weeks.png)、[家属](../output/personal-finance-integration-20261008/screenshots/schedule-family-two-weeks.png)已审阅；竖屏、下午、第二周及最右/最底部证据见下；前轮 aligned/corrected/普通课表图不作为本轮整体布局证据 |
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

第 1–15 项是前轮阶段记录，尤其 13–15 仅修正了卡片内容/颜色，不能证明整体课程表布局已对齐。用户最新要求以第 16 项之后的两周时间网格、三个导航按钮为准：不再保留日/周切换、学生筛选、日期区间总结或每日节数。

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
13. 用户指出旧课表卡片与桌面内容不一致。新增 `schedule/cardContentRuntime.test.js` 执行实际小程序组件，并用真实桌面 `ScheduleCalendar.tsx` 中的卡片 JSX 与 `resolveCalendarRoomDisplay` 作参照，先失败：小程序“1. 初二物理 / 大班课 · 待上课 / 旧地点”不等于桌面“初二物理 / 东湖上课点 10:05-12:35”。现卡片只有完整课名与地点/起止时间两个语义行，不再添加序号、班型和状态文字；状态采用桌面最终静态样式，详见第 15 项。地点按桌面规则优先课程当前 `room_name`，解析排课房间 ID、课程房间 ID 与逗号分隔首个地点；课名使用桌面的展示名/系统学期前缀清理规则，并保留已退选课程快照。四正式角色周/日视图及上述路径通过，显示处理不改写缓存；结束时间缺失时保留缺失，不推算时长。
14. 同轮真实 Taro 编译回归先复现竖屏卡片左右 padding 22rpx/18rpx 不对称，修为对称 22rpx；横竖屏卡片/正文均 flex 居中，文字明确居中。横屏保留课名 14px、地点/起止时间第二行 12px；长课程名可换行，起止时间范围不拆开，不因七列空间缩小字体。旧方向测试不再错误要求桌面卡片不存在的 `schedule-sub` 和单独开始时间。原详情已有班型、状态与独立开始/结束时间，桌面编辑也有课程状态/时间/地址字段；本轮未扩大删除详情内容。
15. 用户补充要求背景色与桌面一致。颜色回归先失败：旧小程序实际卡片无桌面背景色，预期 `#E3F2FD`。现使用共用的 `shared/courseColors.js` 地点调色板与亮度文字色，取消独有白底、绿色侧条、阴影和透明度。测试提取整个真实桌面最终 JSX 的 style 对象，而不是只复制状态辅助函数：后续表达式在非拖拽时把边框覆盖为 undefined、opacity 覆盖为 1，所以静态正常/已完成/取消/请假都保留原课程背景与 opacity 1，无额外状态文字。实际 SSR + Sass 检查同时覆盖背景、两行文字的对比度、无额外边框及四状态。范围子集回归先复现教师重算配色为 `#E3F2FD`，与全局 `#E8F5E9` 不同；主任务云端与共享算法现提供/优先允许课程的 `calendar_color`，小程序不需要额外课程或地点。删除该派生色的运行时变异测试仍红，正式四角色回归绿。隔离 fixture 提供管理员四课色/42课、教师三课色/32课、学生与家属两课色/22课及完整起止时间；首课按天轮换，管理员横屏第一排包含四课色，HTTP 检查角色范围、首排四色和同课跨角色派生色均通过。最终 H5 成功重建（23.65s）；主任务 CUA 捕获上述六张 aligned 图后，本子任务逐一 view_image 复核：管理员首排四课色、教师三课色、学生两课色且无教师筛选入口，地点/完整起止时间/全部课名可见；横屏窄列自然换行但时间范围同一行，竖屏卡片为完整两行。旧 corrected 或非 aligned 课表图不作为本次最终内容与配色证据。
16. 用户指出日期下节数、每天仅一排卡片及额外控件仍与桌面不一致。新 `gridGeometryRuntime.test.js` 执行真实桌面 `OneWeekRow` 的时间范围声明和 `DailyView` 的主体高度/课程定位函数，并执行真实小程序组件；初始先失败日计数 7（预期 0）。现整体与 `TwoWeeksView` 主画布对齐：当前周和下一周上下两排，每排七天固定 140px 列、8px 间距，默认 08:00–23:00 的 450px 主体；5分钟格、每格2.5px，课程按实际起止 slot 绝对定位，60分钟为30px、90分钟为45px，仅保留桌面 minHeight24。早于08点/晚于23点的正常课程按真实桌面规则扩展整小时边界，每日结尾也按 endSlot+1 延长；没有凭空折叠空白时段。整点网格线每30px一条；遗留重叠同列同left/right与zIndex10并保留缓存顺序，没有虚构错列规则。四正式角色与14日/跨年导航/刷新/详情返回/缺失时间均验证；缺失或无效起止时间不补造时长，保留在该日网格后。
17. 根据用户最新明确要求，顶部只保留上一周、本周、下一周三个44px触摸按钮。去掉学生筛选、验收学生名字、日/周切换、单独日期区间总结及每日节数，不改变云端权限或数据范围。日期只在每列两行表头展示；共享 `calendarHolidays.js` 逐字保留原2026七个假期数据，桌面 helpers 原导出保留，小程序用同一数据呈现假期红色表头及当天蓝框。卡片采用桌面12px/10px、1.2行高及居中/课名单行ellipsis，不沿用原112px卡片体积；时间范围优先占位，长地点可截短以保证结束时间完整，原始名称/地点数据不被改写。
18. 主任务实际H5发现Taro同时scrollX/scrollY时默认纵向类把overflow-x改为hidden。新增回归组合真实Taro组件CSS后先失败 hidden（预期auto）；现 `.week-view.week-view` 双类选择器明确两轴auto，真实CSS selector权重与计算样式检查通过。主任务又测得H5的tab-page祖先340px但课表100vh为390px，导致底栏覆盖；现在仅 `.taro_tabbar_page .schedule-page` 扣除HTML tabbar高度，原生页面仍100vh。最终实际CUA读取两轴计算样式均为auto；横屏scrollLeft207.2可到周日，学生竖屏scrollLeft660.8可到周末，scrollTop420.8达到最大值且第二周完整底边位于tabbar上方。WeApp编译/属性回归仍明确同时scrollX/scrollY，但此H5操作证据不冒充微信硬件触摸/旋转验证。
19. 最新隔离fixture改为两周不重叠真实课次：08:05–09:35、09:40–11:10、11:15–12:45、13:30–15:00、15:10–16:10、16:20–17:20；管理员84/教师64/学生与家属43课，各角色只返回其允许课程和地点，云派生同课色稳定。HTTP真实投影读取器验证全部12表、14日、不重叠时段及同课跨角色色通过；遗留重叠另由组件几何回归单独验证，不再用旧每小时90分钟的重叠fixture作为视觉验收样本。

## 最终整体课表渲染证据

主任务使用受支持 CUA 操作最终 H5，横屏实际外框为844 × 390，竖屏为390 × 740（适配本机浏览器可用高度，不能记录成390 × 844）。本子任务已逐一打开以下11张最终 `two-weeks` 图片审阅；这些图片取代旧卡片阶段的课表结论。

- 管理员：[横屏初始](../output/personal-finance-integration-20261008/screenshots/schedule-admin-two-weeks.png)、[横向周末](../output/personal-finance-integration-20261008/screenshots/schedule-admin-two-weeks-weekend.png)、[下午课程](../output/personal-finance-integration-20261008/screenshots/schedule-admin-two-weeks-afternoon.png)、[第二周](../output/personal-finance-integration-20261008/screenshots/schedule-admin-two-weeks-second-week.png)、[竖屏](../output/personal-finance-integration-20261008/screenshots/schedule-admin-two-weeks-portrait.png)。四色课程按真实时间纵向定位，一天多节及下午60分钟课均可读，第二周日期为10月12–18日；周末横向滚动可到周日。
- 教师：[横屏](../output/personal-finance-integration-20261008/screenshots/schedule-teacher-two-weeks.png)、[竖屏](../output/personal-finance-integration-20261008/screenshots/schedule-teacher-two-weeks-portrait.png)。仅教师允许的三课色，缺少权限内课程的时段保留时间网格空白；没有全部学生/验收学生筛选栏。
- 学生：[横屏](../output/personal-finance-integration-20261008/screenshots/schedule-student-two-weeks.png)、[竖屏](../output/personal-finance-integration-20261008/screenshots/schedule-student-two-weeks-portrait.png)、[最右与最底](../output/personal-finance-integration-20261008/screenshots/schedule-student-two-weeks-bottom.png)。仅学生允许的两课色；最后图可见第二周周六/周日、16:20–17:20完整起止时间及课程居中，第二周列底边完整位于tabbar上方。
- 家属：[横屏](../output/personal-finance-integration-20261008/screenshots/schedule-family-two-weeks.png)。同学生允许范围与同课配色，不展示额外教师/管理员课程。

主任务还逐个实际点击上一周、下一周、本周：前两者分别移动7天，本周复位。最终图片只有这三个紧凑按钮与每列两行日期表头，不存在日/周切换、独立日期区间、学生筛选、每日节数或卡片序号/班型/状态文字。15:10–16:10与16:20–17:20的30px高课卡完整居中可读，90分钟45px课卡亦完整呈现。课程名12px与地点/起止时间10px来自桌面真实规则，并有本机H5渲染证据；微信真机字形、双轴手势及方向切换仍未在本子任务验证。

## 已执行验证

- `npm run test:miniapp-ui`：通过，覆盖上述 18 页面清单及 fixture 契约。
- `node miniapp/src/pages/schedule/orientationRuntime.test.js`：通过。
- `node miniapp/src/pages/schedule/cloudBusinessSchedule.test.js`：通过。
- `node miniapp/src/pages/schedule/cardContentRuntime.test.js`：红绿通过，实际组件两周中的四角色卡片内容与桌面 JSX、最终背景/文字色/透明度/边框及范围派生色对齐；已纳入 `scripts/test-personal-finance.js`。
- `node miniapp/src/pages/schedule/gridGeometryRuntime.test.js`：红绿通过，实际两周结构、真实5分钟定位/60与90分钟课高、时间范围/整点线、14日列头、移除计数/筛选/总结/切换以及旧重叠顺序；已纳入同一测试入口。
- `node miniapp/src/pages/schedule/courseHistory.test.js`、`node miniapp/src/utils/teachingPagesRuntime.test.js`：通过；旧 harness 已注入真实共享配色依赖及 rooms 缓存，不删减原角色/会话/历史课程断言。
- `node scripts/test-personal-finance.js`：两周网格及双轴/底栏修正后的最终相关测试 exit 0，包括 IMAP、个人财务、题库、题篮、组卷与新卡片/几何回归。
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
- 本机 fixture 目标 `npm --prefix miniapp run build:h5`：双轴/底栏修正后成功（24.788s）；构建仍报告入口 372 KiB 超过 360 KiB 的警告。未因此放宽预算。

## 子任务变更文件清单

工作目录：`C:/Users/83423/.codex/worktrees/audit-fixes-20261007/scheduling-system`。以下路径以该目录为基准；其他并行任务的修改不归此清单。

- 课程表：`miniapp/src/pages/schedule/index.config.ts`、`index.tsx`、`index.scss`、`cloudBusinessSchedule.test.js`、`courseHistory.test.js`、新增 `orientationRuntime.test.js`、`cardContentRuntime.test.js`、`gridGeometryRuntime.test.js`、`desktopCourseColors.test-support.js`；`miniapp/src/utils/teachingPagesRuntime.test.js` 保留权限/会话/导航回归并对齐实际两周；`miniappUiCopyContract.test.js`、`miniappUiPageInventory.js`、`miniappUiRuntimeScenarios.js` 同步移除旧筛选与单日状态；`scripts/test-personal-finance.js` 纳入新卡片/几何回归。共享假期新增 `shared/calendarHolidays.js`、`src/utils/helpers.ts` 原导出保留；跨端共享配色与云端派生字段由主任务负责。
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

本子任务早前微信开发工具门禁返回 `versionRelation=equal`（skill 0.3.2）、`loginExpired=true`、`tokenRequired=false`，因此未继续调用该会话的微信业务工具。该本地登录状态不能作为上传的必要阻断：主任务将使用既有固定出口CI上传development版本；上传成功与否应由其真实结果确认。正式发行另受平台86000 API错误及控制台site-safety阻断，由主任务独立记录，不能与本地IDE过期或H5验证混为一项。子任务未执行生产部署/发布/版本号更新；浏览器最终截图由主任务CUA完成，微信真机运行未验证。
