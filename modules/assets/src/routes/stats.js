/**
 * 资产统计模块 - 统计数据
 */
const express = require('express');
const router = express.Router();
const db = require('../database');

// 获取统计
router.get('/', (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ code: 400, message: '缺少日期范围' });

  const records = db.prepare('SELECT * FROM asset_records WHERE date >= ? AND date <= ?').all(startDate, endDate);
  const income = records.filter(r => r.type === 'income');
  const expense = records.filter(r => r.type === 'expense');
  const totalIncome = income.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expense.reduce((s, r) => s + r.amount, 0);

  // 分类汇总
  const byCategory = (list) => {
    const map = {};
    list.forEach(r => {
      if (!map[r.category_name]) map[r.category_name] = { category: r.category_name, amount: 0, count: 0 };
      map[r.category_name].amount += r.amount;
      map[r.category_name].count++;
    });
    return Object.values(map);
  };

  // 月度趋势
  const monthlyMap = {};
  records.forEach(r => {
    const month = r.date.substring(0, 7);
    if (!monthlyMap[month]) monthlyMap[month] = { month, income: 0, expense: 0 };
    if (r.type === 'income') monthlyMap[month].income += r.amount;
    else monthlyMap[month].expense += r.amount;
  });

  res.json({
    code: 0,
    data: {
      totalIncome,
      totalExpense,
      netAmount: totalIncome - totalExpense,
      incomeByCategory: byCategory(income),
      expenseByCategory: byCategory(expense),
      monthlyTrend: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))
    }
  });
});

module.exports = router;
