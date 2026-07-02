# 微信小程序全页面 UI 验证记录（2026-07-02）

## 验证范围

- 目标：验证小程序 UI 优化不是只停留在首页，而是覆盖管理员、学生、登录、无权限和有限写入状态。
- 入口：Taro H5 构建产物 `miniapp/dist`，本地临时服务 `http://127.0.0.1:4176`。
- 浏览器：Codex 内置 Browser，移动视口 `390 x 844`。
- 截图目录：`C:\Users\83423\AppData\Local\Temp\gewu-miniapp-ui-2026-07-02\viewport`。
- 截图策略：使用视口截图；Taro H5 的 `fullPage` 截图在部分页面会生成白图，已弃用。

## 结果

- 25 个页面/角色截图用例全部通过：DOM 命中对应真实页面文案，截图文件均为非空白图。
- 管理员首页点击“排课”进入课程表通过，交互截图：`interaction-admin-home-to-schedule.png`。
- 最终矩阵和交互标签页 `tab.dev.logs({ levels: ['error','warn'] })` 返回空数组。
- Browser 插件自身有外部 Statsig 请求超时输出，不属于小程序页面 console。
- H5 静态 tabbar 已补 PNG 图标资产，避免空方框；微信端角色 tabbar 仍由 `custom-tab-bar` 按管理员/学生区分，且有测试覆盖。

## 截图矩阵

| 用例 | 角色 | 路由 | 截图 |
| --- | --- | --- | --- |
| guest-login | guest | `pages/login/index` | `guest-login.png` |
| admin-home | admin | `pages/index/index` | `admin-home.png` |
| student-home | student | `pages/index/index` | `student-home.png` |
| admin-schedule | admin | `pages/schedule/index` | `admin-schedule.png` |
| student-schedule | student | `pages/schedule/index` | `student-schedule.png` |
| admin-schedule-detail | admin | `pages/schedule/detail/index?id=sch1` | `admin-schedule-detail.png` |
| student-schedule-detail | student | `pages/schedule/detail/index?id=sch1` | `student-schedule-detail.png` |
| admin-schedule-edit-limit | admin | `pages/schedule/edit/index` | `admin-schedule-edit-limit.png` |
| student-schedule-edit-limit | student | `pages/schedule/edit/index` | `student-schedule-edit-limit.png` |
| admin-students | admin | `pages/students/index` | `admin-students.png` |
| admin-student-detail | admin | `pages/student-detail/index?id=s1` | `admin-student-detail.png` |
| student-student-detail | student | `pages/student-detail/index?id=s1` | `student-student-detail.png` |
| admin-courses | admin | `pages/courses/index` | `admin-courses.png` |
| admin-teachers | admin | `pages/teachers/index` | `admin-teachers.png` |
| admin-payments | admin | `pages/payments/index` | `admin-payments.png` |
| admin-stats | admin | `pages/stats/index` | `admin-stats.png` |
| admin-question-bank | admin | `pages/question-bank/index` | `admin-question-bank.png` |
| student-question-bank | student | `pages/question-bank/index` | `student-question-bank.png` |
| admin-assets | admin | `pages/assets/index` | `admin-assets.png` |
| admin-settings | admin | `pages/settings/index` | `admin-settings.png` |
| student-settings | student | `pages/settings/index` | `student-settings.png` |
| admin-users | admin | `pages/admin/users/index` | `admin-users.png` |
| admin-invitations | admin | `pages/admin/invitations/index` | `admin-invitations.png` |
| admin-forbidden | admin | `pages/forbidden/index` | `admin-forbidden.png` |
| student-forbidden | student | `pages/forbidden/index` | `student-forbidden.png` |

## 命令记录

- `npm --prefix miniapp run typecheck`
- `node miniapp/src/custom-tab-bar/roleTabBar.test.js`
- `node miniapp/src/utils/miniappUiCoverage.test.js`
- `npm --prefix miniapp run build:h5`

## 最终补充验证

- `node miniapp/src/utils/miniappAccessPolicy.test.js` 通过。
- `npm test` 通过，覆盖小程序访问策略、角色 tabbar、首页视觉约束、全页面 UI 覆盖和既有后端/桌面回归测试。
- `npm --prefix miniapp run typecheck` 通过。
- `git diff --check` 通过，仅输出换行符转换提示。
- `npm --prefix miniapp run build:h5` 通过，仅保留既有 Webpack 体积警告：`js/app.js` 约 261 KiB，入口约 410 KiB。
- `npm run miniapp:release-check` 通过，完成 WeApp 构建和小程序发布 smoke 检查。

## 设计约束落实

- `miniapp/src/utils/miniappUiPageInventory.js` 覆盖 `app.config.ts` 全部注册页面，并为每页记录真实功能依据。
- `pages/forbidden/index` 已注册到 `app.config.ts`，避免源码可跳转但运行时打不开。
- UI 文案、入口、按钮和指标需追溯到真实路由、API、任务类型、权限、本地数据或已实现流程；该约束已写入 `AGENTS.md` 和页面清单测试。
