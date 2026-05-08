/**
 * 资产统计模块 - 记录 CRUD
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');

// 获取记录列表（支持日期范围筛选）
router.get('/', (req, res) => {
  const { startDate, endDate, type } = req.query;
  let sql = 'SELECT * FROM asset_records WHERE 1=1';
  const params = [];
  if (startDate) { sql += ' AND date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND date <= ?'; params.push(endDate); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY date DESC, created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ code: 0, data: rows });
});

// 获取单条记录
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM asset_records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' });
  res.json({ code: 0, data: row });
});

// 创建记录
router.post('/', (req, res) => {
  const { date, type, category_id, category_name, amount, student_id, student_name, note } = req.body;
  if (!date || !type || !category_id || !category_name || amount == null) {
    return res.status(400).json({ code: 400, message: '缺少必填字段' });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO asset_records (id, date, type, category_id, category_name, amount, student_id, student_name, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, date, type, category_id, category_name, amount, student_id || null, student_name || null, note || null, now, now);
  const row = db.prepare('SELECT * FROM asset_records WHERE id = ?').get(id);
  res.json({ code: 0, data: row });
});

// 更新记录
router.put('/:id', (req, res) => {
  const exist = db.prepare('SELECT id FROM asset_records WHERE id = ?').get(req.params.id);
  if (!exist) return res.status(404).json({ code: 404, message: '记录不存在' });
  const { date, type, category_id, category_name, amount, student_id, student_name, note } = req.body;
  const now = new Date().toISOString();
  db.prepare(`UPDATE asset_records SET date=?, type=?, category_id=?, category_name=?, amount=?, student_id=?, student_name=?, note=?, updated_at=? WHERE id=?`)
    .run(date, type, category_id, category_name, amount, student_id || null, student_name || null, note || null, now, req.params.id);
  const row = db.prepare('SELECT * FROM asset_records WHERE id = ?').get(req.params.id);
  res.json({ code: 0, data: row });
});

// 删除记录
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM asset_records WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ code: 404, message: '记录不存在' });
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
