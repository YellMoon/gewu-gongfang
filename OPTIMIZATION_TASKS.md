# 格物工坊 v2.2.0 优化任务追踪

## 项目路径
`C:\Users\83423\.openclaw\workspace\scheduling-system\`

## 任务状态：🔴未开始 🟡进行中 🟢已完成 ❌跳过

---

## P0 - 核心功能修复

### T1: 🔴 课程表批量选择矩形框随滚动条移动
- 文件：`src/pages/useBatchSelection.tsx` + `src/pages/ScheduleCalendar.tsx`
- 问题：selection rect (rb) 使用 getBoundingClientRect 获取视口坐标，但渲染为 container 内 position:absolute，滚动时位置不对
- 修复方向：在计算 rb 时减掉 container 的 scrollTop/scrollLeft，或改用相对于 container 的坐标

### T2: 🔴 知识树增删改功能实现
- 文件：`src/pages/QuestionBank.tsx` + `src/services/browserDatabase.ts`
- 问题：用户反馈知识树的增删改实际未生效。需验证 CRUD 操作是否真正写入 localStorage 并在下次加载时正确读取
- 需检查：createKnowledgeNode / updateKnowledgeNode / deleteKnowledgeNode 调用 saveData()

### T3: 🟢 教学工具和云同步菜单删除下拉框
- 文件：`src/App.tsx`
- 修复：handleDropdownEnter 中 itemCount<=1 时添加 `setOpenDropdown(null)` 关闭其他已打开的下拉框
- 提交：2026-05-08 10:04

---

## P1 - 界面与体验修复

### T4: 🟡 机械波显示框自适应高度
- 文件：`src/teaching-tools/wave-demo/WaveVisualization.tsx`
- 当前：calcCanvasH() 已实现动态计算，需验证是否在所有振幅下正常工作
- 验证：测试 amplitude=5cm 时 canvas 是否足够高

### T5: 🟡 机械波质点模式速度优化
- 文件：`src/teaching-tools/wave-demo/WaveVisualization.tsx`
- 当前：已有对数压缩 effSpeed = 1 + log2(speed) * 0.35，需验证质点模式下是否仍然太快

### T6: 🔴 所有表格内容居中显示
- 文件：`src/index.css`
- 当前：已添加 CSS 规则 `text-align: center !important`，需验证所有页面表格是否生效

### T7: 🔴 恢复误删的教学工具
- 需要确认哪些工具/插件被删除，从备份恢复

### T8: 🔴 波演示窗口分离+坐标轴标注
- 文件：`WaveVisualization.tsx`
- 当前：已有三窗口（y1, y2, y合成）+ 坐标轴标注。需确认横轴(x/m)和纵轴(y/cm)标注是否正确显示

---

## P2 - 新功能开发

### T9: 🔴 操作日志模块对接真实数据
- 文件：`src/pages/OperateLog.tsx`
- 当前：只有 mock 数据

### T10: 🔴 云同步引擎实现
- 文件：`src/pages/CloudSync.tsx` + `src/services/syncEngine.ts`
- 当前：只显示"开发中"占位

### T11: 🔴 邀请功能（权限管理+小程序匹配）
- 文件：需要新建

### T12: 🔴 知识点多选模糊搜索
- 文件：`src/pages/QuestionBank.tsx`
- 当前：已有 Select mode="multiple" + filterOption，需验证模糊搜索是否完善

---

## 最后
### T13: 🔴 打包编译 + 夸克网盘上传 v2.2.0
