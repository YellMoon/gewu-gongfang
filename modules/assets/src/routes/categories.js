/**
 * 资产统计模块 - 分类管理
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');

// 获取所有分类
router.get('/', (req, res) => {
  const { type } = req.query;
  let sql = 'SELECT * FROM asset_categories';
  const params = [];
  if (type) { sql += ' WHERE type = ?'; params.push(type); }
  sql += ' ORDER BY created_at ASC';
  const rows = db.prepare(sql).all(...params);
  res.json({ code: 0, data: rows });
});

// 创建分类
router.post('/', (req, res) => {
  const { name, type, color } = req.body;
  if (!name || !type) return res.status(400).json({ code: 400, message: '缺少必填字段' });
  const id = 'cat-' + crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO asset_categories (id, name, type, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, name, type, color || null, now, now);
  const row = db.prepare('SELECT * FROM asset_categories WHERE id = ?').get(id);
  res.json({ code: 0, data: row });
});

// 删除分类
router.delete('/:id', (req, res) => {
  if (req.params.id.startsWith('builtin-')) {
    return res.status(400).json({ code: 400, message: '内置分类不可删除' });
  }
  // 检查是否有记录使用该分类
  const used = db.prepare('SELECT COUNT(*) as cnt FROM asset_records WHERE category_id = ?').get(req.params.id);
  if (used.cnt > 0) {
    return res.status(400).json({ code: 400, message: `该分类下有 ${used.cnt} 条记录，无法删除` });
  }
  const result = db.prepare('DELETE FROM asset_categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ code: 404, message: '分类不存在' });
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
