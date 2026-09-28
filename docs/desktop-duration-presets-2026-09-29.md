# 40 / 80 分钟排课与费用统计

范围：课程信息的默认时长、课表排课时长和选课带入均准确支持 40 / 80 分钟。
根据用户最终补充要求，费用明细和汇总底层使用整数分钟；按小时计费保持小时显示，
按次计费显示时长及各时长节数，混合汇总分别列出小时和按次节数；
仅按小时收费时使用实际分钟 / 60 计算金额，金额最后保留到分，按次计费保持不变。
修复费用日期筛选对 UTC 早课误归前一天的问题。已保存历史金额继续作为快照读取，
不批量重算历史账目。云端学生学费 SQL 同步消除时长提前舍入；接口、数据库结构、
权限边界不变。小程序和 NAS 源码不变，发布时验证兼容矩阵及运行状态。

验证计划：40 / 80 分钟真实选课与保存函数；分钟/节数汇总；学费与教师费用、
按次/按小时/请假取消/历史金额保护；PostgreSQL 实际 SQL；完整 npm 生命周期及
类型检查；打包桌面真实交互、Node ABI 恢复；云端代码/数据库备份和部署健康；
OSS 安装包与 feed 哈希。状态：本次桌面/云端交付完成；整体多端正式发布仍为部分发布（小程序仅开发版）。

## 阶段验证

- 类型检查通过：`C:/Users/83423/AppData/Local/Temp/gewu-sync-duration-minute-typecheck-20260928-0nt0dg19`。
- 完整 429 项 npm 生命周期全部通过：`C:/Users/83423/AppData/Local/Temp/gewu-sync-segmented-20260928-3e6g43tl`。
- PostgreSQL 学生学费查询测试（第 134 项）通过。
- 定向测试确认 40/80 分钟选择、结束时间、保存金额与云端草稿一致；
  120 元/小时对应 80/160 元，100 元/小时对应 66.67/133.33 元，
  三节 40 分钟底层累计 120 分钟，按小时计费汇总显示 2 小时。
- 云端部署前代码备份：`/root/scheduling-backups/cloud-code/20260928-195238`，
  SHA-256 `7ad55dac89cf9f8bc2d0fd8bd998cc0923b8e647db25d5fd81f11551b102c41c`。
  本地回执：`output/desktop-duration-20260929/cloud-code-backup.json`。

测试共 430 次执行：第 273 项 Node 进程异常退出（3221226505，无断言日志），
检查环境后原代码重跑通过，其余 428 项首次通过。未为通过测试修改业务断言。

## 显示单位补充要求

用户在首次构建期间要求非按次计费只显示原有单位。桌面 OSS 尚未发布，
保留 8.9.24 版本号重新构建。云端 8.12.5 已部署成功，计算逻辑不变。
显示调整定向测试及类型检查通过：
`C:/Users/83423/AppData/Local/Temp/gewu-sync-duration-display-typecheck-20260928-mow7loex`。
云端数据库备份并隔离恢复验证：`/root/scheduling-backups/postgres/20260928-201017`。
云端/NAS 运行回执：`C:/Users/83423/AppData/Local/Temp/gewu-live-closeout-20260929-4jws7977/receipt.json`。
首次打包 UI 测试的添加课程按钮包含图标，精确可访问名称匹配超时；截图确认按钮存在，
已修正测试定位器。测试身份/会话清理为零，无真实业务写入。

## 最终发布和验收

- 代码提交 `632c0429`，显示单位补充提交 `10cb518a`，均已推送 `gewu/master`。
- 桌面 **8.9.24**：默认时长和排课可选 40/80 分钟；按小时课程统计保持小时显示，
  底层整数分钟累计；按次课程按时长列出节数。金额仅在最终计算时保留到分。
- 云端 **8.12.5**：学生学费 SQL 使用实际分钟计算；备份、隔离恢复校验、部署、
  内外网健康与旧写入入口关闭检查通过。没有新增数据库结构或历史金额批量修改。
- 最终 `test:business-parity` 通过：
  `C:/Users/83423/AppData/Local/Temp/gewu-sync-duration-final-parity-20260928-vnxasqmo`。
- 最终桌面构建通过：
  `C:/Users/83423/AppData/Local/Temp/gewu-sync-duration-final-dist-20260928-a7dxzm1l`。
  安装包 Electron ABI 119；构建结束及 OSS 发布后 root/backend Node ABI 137 均验证通过。
- 最终真实安装包运行验证通过：`output/desktop-duration-20260929/runtime/report.json`。
  验证课程默认值 40/80、07:00 排课结束 07:40/08:20、单一同步窗口、原生失败草稿
  冲突暂停与放弃、冷启动不恢复已放弃记录。隔离只读费用数据三节40加一节80，
  显示3.33小时、学费400元、教师费用200元；没有真实业务写入，测试会话清理为零。
  定位器的按钮图标、Select 内部搜索框、嵌套统计卡匹配问题均已修正，最终页面错误为零。
- 包装内 renderer 清单与本次生产构建 SHA-256 一致：
  `e22c1b73a35c3e6ce7b2b8df09454408cdfd2fde79e09ced49cb58b58daccd37`。
- 安装包启动 smoke 通过：
  `C:/Users/83423/AppData/Local/Temp/gewu-sync-duration-final-smoke-20260928-f7u7quab`。
- OSS live/archive `latest.yml` 均为 8.9.24，完整公网下载 **150,370,883 字节**，
  SHA-512 `RtkawfrndgYDEKIuX1NFdfRJ6FGp7vpvxW/d9YApPqhuFC3UK/cyt3wSa3f+Hp9s9xrmSBlAKUKbVPw91jgt0g==`。
  核验：`output/release-matrix-desktop-8.9.24__cloud-business-8.12.5__storage-proxy-8.8.3__miniapp-8.8.26/oss-runtime-verification.json`。
- NAS 8.8.3 运行回执与合约正常。小程序源码/合约不变，沿用8.8.26已核验开发版上传；
  没有本次新上传或正式发布，不能宣称整体多端正式发布完成。
- 未提交或改写其他用户文件；`docs/desktop-device-name-2026-09-24.md` SHA-256 保持
  `13c7144c09d1260ffbb12f11a6c8a191a4c57a680629fa1a5aebee3f49c88e72`。
