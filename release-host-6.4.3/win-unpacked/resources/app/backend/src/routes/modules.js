const { Router } = require('express');

const router = Router();

const modules = [
  {
    id: 'scheduling',
    name: '课程表',
    description: '查看课程安排',
    icon: 'calendar',
    route_prefix: '/schedule',
    sort_order: 10,
    status: 1,
  },
  {
    id: 'question-bank',
    name: '题库',
    description: '组卷与导出试卷',
    icon: 'question-bank',
    route_prefix: '/question-bank',
    sort_order: 20,
    status: 1,
  },
  {
    id: 'assets',
    name: '财务',
    description: '资产统计与财务导入',
    icon: 'assets',
    route_prefix: '/assets',
    sort_order: 30,
    status: 1,
  },
];

router.get('/', (_req, res) => {
  res.json({ success: true, data: { modules }, modules });
});

module.exports = router;
