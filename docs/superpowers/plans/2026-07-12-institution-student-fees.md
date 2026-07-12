# 机构学生统一费用链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实机构学生统一承载机构课程的课时收入、支出和出勤费用编辑。

**Architecture:** 在共享的机构学生领域辅助函数中定义命名、识别和候选过滤；数据服务负责事务化创建、幂等补齐与改名联动；课程和课表 UI 只消费真实学生定价；财务工具移除虚拟纯机构费用兜底。

**Tech Stack:** React 18、TypeScript、Ant Design、Express、SQLite/better-sqlite3、Node assert 测试。

---

### Task 1: 机构学生领域规则

**Files:**
- Create: `src/utils/institutionStudent.mjs`
- Create: `src/utils/institutionStudent.test.js`
- Modify: `src/types/index.ts`

- [ ] 先写失败测试：命名、识别、每机构唯一候选与课程来源过滤。
- [ ] 运行 `node src/utils/institutionStudent.test.js`，确认因函数缺失失败。
- [ ] 实现纯函数并补充 `is_institution_student` 类型字段。
- [ ] 重跑测试并确认通过。

### Task 2: 数据生命周期与迁移

**Files:**
- Modify: `src/services/browserDatabase.ts`
- Modify: `backend/src/database.js`
- Modify: `backend/src/routes/institutions.js`
- Test: `backend/src/institutionStudentLifecycle.test.js`

- [ ] 写失败测试：创建、幂等补齐、改名联动和引用删除保护。
- [ ] 运行生命周期测试并确认预期失败。
- [ ] 用事务实现创建/补齐/改名，并为学生属性增加兼容迁移。
- [ ] 重跑生命周期测试并确认通过。

### Task 3: 课程绑定和学生定价

**Files:**
- Modify: `src/pages/CourseList.tsx`
- Modify: `src/utils/coursePricingRules.mjs`
- Modify: `src/utils/coursePricingRules.test.js`

- [ ] 写失败测试：机构排课/混合班仅允许合法机构学生，来源或机构变化清理非法绑定。
- [ ] 运行 `node src/utils/coursePricingRules.test.js` 并确认失败。
- [ ] 实现筛选规则并让添加/编辑课程统一编辑 `student_pricings`。
- [ ] 重跑测试并确认通过。

### Task 4: 移除纯机构费用兜底

**Files:**
- Modify: `src/utils/financialDetails.ts`
- Modify: `src/utils/financialDetails.test.js`
- Modify: `src/pages/ScheduleCalendar.tsx`

- [ ] 写失败测试：不再生成 `__institution_unbound__`，真实机构学生正常计算收入和支出。
- [ ] 运行 `node src/utils/financialDetails.test.js` 并确认失败。
- [ ] 删除纯机构课程费用构造器和特殊定价来源，统一课表窗口标题、内容与保存反馈。
- [ ] 重跑财务测试并确认通过。

### Task 5: 验证、提交与推送

**Files:**
- Modify: `task.md`

- [ ] 运行相关测试与 `npm run build`，再根据影响范围运行 `npm test`。
- [ ] 启动桌面端，走通机构创建、课程绑定和课表费用窗口并记录 visual_evidence_record。
- [ ] 用 `rg` 审计虚拟机构费用 ID、独立窗口文案和直接费用编辑残留。
- [ ] 更新 `task.md` 状态，检查 `git diff` 和中文 UTF-8 回读。
- [ ] 执行 `git add -A`、`git commit -m "自动发布 2026-07-12"` 并推送 `codex/institution-student-fees`。

