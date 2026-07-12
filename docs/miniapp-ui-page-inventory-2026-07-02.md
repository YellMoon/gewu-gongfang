# 微信小程序全页面 UI 清单（2026-07-02）

本清单用于约束后续 UI 优化不能只停留在首页。完成声明必须同时满足：`miniapp/src/app.config.ts` 注册页面全部覆盖、可跳转状态页已注册且覆盖、管理员/学生双角色路径覆盖、截图或检查记录覆盖。

## 页面矩阵

| 路由 | 角色 | 页面定位 | 优化重点 | 验证状态 |
| --- | --- | --- | --- | --- |
| `pages/login/index` | guest | 手机号授权登录 | 品牌化登录、手机号授权、待审核状态 | 登录、待审核、loading |
| `pages/index/index` | admin/student | 双角色首页 | 管理员运营面板、学生学习面板、快照状态 | admin、student、空模块 |
| `pages/schedule/index` | admin/student | 课程表 | 周/日切换、课程列表、空日程 | 周视图、日视图、空态 |
| `pages/schedule/detail/index` | admin/student | 排课详情 | 状态、时间、费用、学生明细 | 正常详情、缺失记录 |
| `pages/schedule/edit/index` | admin/student | 小程序写入限制 | 明确电脑端编辑边界 | 只读限制提示 |
| `pages/students/index` | admin | 学生列表 | 搜索、学生卡、来源标签 | 搜索、列表、空态 |
| `pages/student-detail/index` | admin/student | 学生详情 | 头像、余额、信息/缴费/成绩标签页 | 三个 tab、缺失学生 |
| `pages/courses/index` | admin | 课程管理 | 横向筛选、进行中/已结课分区 | 筛选、空态 |
| `pages/teachers/index` | admin | 教师列表 | 教师卡、课时费、空态 | 列表、空态 |
| `pages/payments/index` | admin | 缴费记录 | 财务汇总、学生筛选、记录列表 | 汇总、筛选、空态 |
| `pages/stats/index` | admin | 统计分析 | 收入卡、条形统计、月度行 | 收入、课程类型、空态 |
| `pages/question-bank/index` | admin/student | 题库有限写入 | 组卷/导出任务、结果状态 | 表单、任务按钮、结果 |
| `pages/assets/index` | admin | 财务资产有限写入 | 导入任务、收支概览、分类统计 | 导入、概览、空态 |
| `pages/settings/index` | admin/student | 我的/同步设置 | 服务器、同步、待同步、退出 | 在线、离线、待同步 |
| `pages/admin/users/index` | admin | 用户权限管理 | 搜索、角色筛选、底部权限面板 | 列表、权限、授予 |
| `pages/forbidden/index` | admin/student | 无权限状态 | 非首页状态页、返回路径 | 无权限提示 |

## 不可跳过规则

- 首页截图只能证明首页，不能证明全小程序 UI 完成。
- 所有功能入口、按钮、菜单、指标和说明文字必须能追溯到真实存在的路由、API、任务类型、权限模块、本地数据字段或已实现流程；不得为了美观虚构功能或虚构可点击入口。
- 管理员路径至少覆盖：首页、课程表、学生、课程、教师、缴费、统计、题库、资产、设置、用户权限、无权限。
- 学生路径至少覆盖：首页、课程表、排课详情、题库、设置、写入限制页、无权限。
- 空态、离线状态、无权限状态、有限写入状态都属于 UI 范围，不得因为不是主流程而跳过。
- 最终记录必须写明 H5/WeApp 构建、逐页截图或逐页检查结果，以及无法真实验证的外部依赖原因。
