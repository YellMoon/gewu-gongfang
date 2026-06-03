/**
 * 题库管理模块 — SQLite 数据库层
 * 使用 better-sqlite3 同步API，参照 scheduling 模块模式
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function escapeLikePattern(value) {
  return String(value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = process.env.QB_DB_PATH || path.join(__dirname, '..', 'data', 'question-bank.db');
    this._init();
  }

  _init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);

    // 迁移: 确保 student_records 有 updated_at 列
    try {
      const cols = this.db.prepare('PRAGMA table_info(student_records)').all();
      if (!cols.some(c => c.name === 'updated_at')) {
        this.db.exec('ALTER TABLE student_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT \'' + this._now() + '\'');
        console.log('[QB-DB] 迁移: student_records 添加 updated_at 列');
      }
    } catch (e) { /* 表可能还不存在 */ }

    console.log(`[QB-DB] 初始化完成: ${this.dbPath}`);
  }

  // ==================== 通用CRUD辅助 ====================

  _now() { return new Date().toISOString(); }

  _get(table, id) {
    return this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`).get(id);
  }

  _list(table, where = 'deleted = 0', params = [], orderBy = 'created_at DESC') {
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy}`).all(...params);
  }

  _insert(table, data) {
    const now = this._now();
    const record = { ...data, created_at: now, updated_at: now };
    const keys = Object.keys(record);
    const vals = Object.values(record);
    const placeholders = keys.map(() => '?').join(', ');
    this.db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).run(...vals);
    return record;
  }

  _update(table, id, updates) {
    const now = this._now();
    updates.updated_at = now;
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ? AND deleted = 0`).run(...vals, id);
    return this._get(table, id);
  }

  _softDelete(table, id) {
    const now = this._now();
    this.db.prepare(`UPDATE ${table} SET deleted = 1, updated_at = ? WHERE id = ?`).run(now, id);
    return true;
  }

  _count(table, where = 'deleted = 0', params = []) {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${where}`).get(...params);
    return row.cnt;
  }

  _paginate(table, { where = 'deleted = 0', params = [], orderBy = 'created_at DESC', page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const total = this._count(table, where, params);
    const items = this.db.prepare(
      `SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ==================== 学科管理 ====================

  getAllSubjects() {
    return this._list('subjects', 'deleted = 0', [], 'name ASC');
  }

  getSubjectById(id) {
    return this._get('subjects', id);
  }

  createSubject(data) {
    const id = uuidv4();
    return this._insert('subjects', {
      id,
      name: data.name,
      grade_level: data.grade_level || null
    });
  }

  updateSubject(id, updates) {
    const allowed = ['name', 'grade_level'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('subjects', id);
    return this._update('subjects', id, filtered);
  }

  deleteSubject(id) {
    return this._softDelete('subjects', id);
  }

  // ==================== 章节管理 ====================

  getChaptersBySubject(subjectId) {
    return this._list('chapters', 'subject_id = ? AND deleted = 0', [subjectId], 'sort_order ASC, created_at ASC');
  }

  getAllChapters() {
    return this._list('chapters', 'deleted = 0', [], 'sort_order ASC, created_at ASC');
  }

  getChapterById(id) {
    return this._get('chapters', id);
  }

  createChapter(data) {
    const id = uuidv4();
    return this._insert('chapters', {
      id,
      subject_id: data.subject_id,
      name: data.name,
      sort_order: data.sort_order || 0
    });
  }

  updateChapter(id, updates) {
    const allowed = ['subject_id', 'name', 'sort_order'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('chapters', id);
    return this._update('chapters', id, filtered);
  }

  deleteChapter(id) {
    return this._softDelete('chapters', id);
  }

  // ==================== 知识点管理 ====================

  getKnowledgePointsByChapter(chapterId) {
    return this._list('knowledge_points', 'chapter_id = ? AND deleted = 0', [chapterId], 'name ASC');
  }

  getAllKnowledgePoints() {
    return this._list('knowledge_points', 'deleted = 0', [], 'name ASC');
  }

  getKnowledgePointById(id) {
    return this._get('knowledge_points', id);
  }

  createKnowledgePoint(data) {
    const id = uuidv4();
    return this._insert('knowledge_points', {
      id,
      chapter_id: data.chapter_id,
      name: data.name,
      description: data.description || null
    });
  }

  updateKnowledgePoint(id, updates) {
    const allowed = ['chapter_id', 'name', 'description'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('knowledge_points', id);
    return this._update('knowledge_points', id, filtered);
  }

  deleteKnowledgePoint(id) {
    return this._softDelete('knowledge_points', id);
  }

  // ==================== 题目管理 ====================

  _questionRow(row) {
    if (!row) return null;
    const knowledgePointIds = row.knowledge_point_ids ? String(row.knowledge_point_ids).split(',').filter(Boolean) : [];
    const options = parseJsonArray(row.options_json);
    return {
      ...row,
      content: row.stem || '',
      options,
      knowledge_point_ids: knowledgePointIds,
      analysis: row.explanation || ''
    };
  }

  _questionSelect(whereSql) {
    return `SELECT q.*,
                   qc.stem,
                   qc.answer,
                   qc.explanation,
                   qc.options_json,
                   qc.content_hash,
                   qc.version,
                   GROUP_CONCAT(qkp.knowledge_point_id) AS knowledge_point_ids
            FROM questions q
            LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
            LEFT JOIN question_knowledge_points qkp ON qkp.question_id = q.id
            ${whereSql}
            GROUP BY q.id
            ORDER BY q.created_at DESC`;
  }

  getQuestions(filters = {}) {
    const where = ['q.deleted = 0'];
    const params = [];

    if (filters.subject_id) { where.push('q.subject_id = ?'); params.push(filters.subject_id); }
    if (filters.chapter_id) { where.push('q.chapter_id = ?'); params.push(filters.chapter_id); }
    if (filters.type) { where.push('q.type = ?'); params.push(filters.type); }
    if (filters.difficulty) { where.push('q.difficulty = ?'); params.push(filters.difficulty); }
    if (filters.keyword) {
      const keyword = `%${escapeLikePattern(filters.keyword)}%`;
      where.push("(qc.stem LIKE ? ESCAPE '\\' OR qc.answer LIKE ? ESCAPE '\\' OR qc.explanation LIKE ? ESCAPE '\\')");
      params.push(keyword, keyword, keyword);
    }
    // 按知识点筛选: knowledge_point_ids JSON数组中包含指定ID
    if (filters.knowledge_point_id) {
      where.push('EXISTS (SELECT 1 FROM question_knowledge_points x WHERE x.question_id = q.id AND x.knowledge_point_id = ?)');
      params.push(filters.knowledge_point_id);
    }

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;
    const countSql = `SELECT COUNT(DISTINCT q.id) AS cnt
      FROM questions q
      LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
      WHERE ${where.join(' AND ')}`;
    const total = this.db.prepare(countSql).get(...params).cnt;
    const items = this.db.prepare(`${this._questionSelect(`WHERE ${where.join(' AND ')}`)} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map(row => this._questionRow(row));
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  getQuestionById(id) {
    return this._questionRow(this.db.prepare(this._questionSelect('WHERE q.id = ? AND q.deleted = 0')).get(id));
  }

  createQuestion(data) {
    const id = uuidv4();
    const validTypes = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'computation'];
    if (!validTypes.includes(data.type)) {
      throw new Error(`无效题型: ${data.type}，有效值: ${validTypes.join(', ')}`);
    }
    const difficulty = data.difficulty || 3;
    if (difficulty < 1 || difficulty > 5) throw new Error('难度必须在 1-5 之间');

    const now = this._now();
    const stem = data.stem || data.content || '';
    const options = parseJsonArray(data.options);
    const explanation = data.explanation !== undefined ? data.explanation : data.analysis;
    const contentHash = hashText([stem, data.answer, explanation, JSON.stringify(options)].join('|'));
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO questions (id, subject_id, chapter_id, type, difficulty, source, status, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`
      ).run(id, data.subject_id || null, data.chapter_id || null, data.type, difficulty, data.source || null, now, now);
      this.db.prepare(
        `INSERT INTO question_contents (id, question_id, stem, answer, explanation, options_json, content_hash, version, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).run(uuidv4(), id, stem, data.answer || null, explanation || null, JSON.stringify(options), contentHash, now, now);
      for (const knowledgePointId of data.knowledge_point_ids || []) {
        this.db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`
        ).run(id, knowledgePointId, now, now);
      }
    });
    transaction();
    return this.getQuestionById(id);
  }

  updateQuestion(id, updates) {
    const existing = this.getQuestionById(id);
    if (!existing) return null;
    if (updates.difficulty !== undefined && (updates.difficulty < 1 || updates.difficulty > 5)) {
      throw new Error('难度必须在 1-5 之间');
    }
    const now = this._now();
    const stem = updates.stem !== undefined ? updates.stem : (updates.content !== undefined ? updates.content : existing.content);
    const answer = updates.answer !== undefined ? updates.answer : existing.answer;
    const explanation = updates.explanation !== undefined ? updates.explanation : (updates.analysis !== undefined ? updates.analysis : existing.explanation);
    const options = updates.options !== undefined ? parseJsonArray(updates.options) : existing.options;
    const contentHash = hashText([stem, answer, explanation, JSON.stringify(options)].join('|'));
    const transaction = this.db.transaction(() => {
      const allowed = ['subject_id', 'chapter_id', 'type', 'difficulty', 'source', 'status'];
      const filtered = {};
      for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
      if (Object.keys(filtered).length > 0) {
        const keys = Object.keys(filtered);
        this.db.prepare(`UPDATE questions SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND deleted = 0`)
          .run(...keys.map(k => filtered[k]), now, id);
      } else {
        this.db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(now, id);
      }
      this.db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(now, id);
      this.db.prepare(
        `INSERT INTO question_contents (id, question_id, stem, answer, explanation, options_json, content_hash, version, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(uuidv4(), id, stem, answer || null, explanation || null, JSON.stringify(options), contentHash, (existing.version || 1) + 1, now, now);
      if (updates.knowledge_point_ids !== undefined) {
        this.db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
        for (const knowledgePointId of updates.knowledge_point_ids || []) {
          this.db.prepare(
            `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?)`
          ).run(id, knowledgePointId, now, now);
        }
      }
    });
    transaction();
    return this.getQuestionById(id);
  }

  deleteQuestion(id) {
    const now = this._now();
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE questions SET deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
      this.db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ?').run(now, id);
      this.db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ?').run(now, id);
      this.db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
    });
    transaction();
    return true;
  }

  batchCreateQuestions(questions) {
    return questions.map(data => this.createQuestion(data));
  }

  // ==================== 试卷/题集管理 ====================

  getQuestionSets(filters = {}) {
    let where = 'deleted = 0';
    const params = [];
    if (filters.subject_id) { where += ' AND subject_id = ?'; params.push(filters.subject_id); }
    return this._paginate('question_sets', {
      where, params,
      orderBy: 'created_at DESC',
      page: parseInt(filters.page) || 1,
      limit: parseInt(filters.limit) || 20
    });
  }

  getQuestionSetById(id) {
    return this._get('question_sets', id);
  }

  getQuestionSetWithItems(id) {
    const set = this._get('question_sets', id);
    if (!set) return null;
    const items = this.db.prepare(`
      SELECT qsi.*, q.type, q.content, q.answer, q.explanation, q.options, q.difficulty, q.knowledge_point_ids
      FROM question_set_items qsi
      JOIN questions q ON qsi.question_id = q.id AND q.deleted = 0
      WHERE qsi.question_set_id = ? AND qsi.deleted = 0
      ORDER BY qsi.sort_order ASC
    `).all(id);
    // 解析 JSON 字段
    for (const item of items) {
      if (item.options) item.options = JSON.parse(item.options);
      if (item.knowledge_point_ids) item.knowledge_point_ids = JSON.parse(item.knowledge_point_ids);
    }
    set.items = items;
    return set;
  }

  createQuestionSet(data) {
    const id = uuidv4();
    return this._insert('question_sets', {
      id,
      name: data.name,
      description: data.description || null,
      subject_id: data.subject_id || null,
      total_score: data.total_score || 0,
      time_limit: data.time_limit || null,
      created_by: data.created_by || null
    });
  }

  updateQuestionSet(id, updates) {
    const allowed = ['name', 'description', 'subject_id', 'total_score', 'time_limit'];
    const filtered = {};
    for (const k of allowed) if (updates[k] !== undefined) filtered[k] = updates[k];
    if (Object.keys(filtered).length === 0) return this._get('question_sets', id);
    return this._update('question_sets', id, filtered);
  }

  deleteQuestionSet(id) {
    return this._softDelete('question_sets', id);
  }

  addItemToSet(setId, questionId, score, sortOrder) {
    const id = uuidv4();
    const item = this._insert('question_set_items', {
      id,
      question_set_id: setId,
      question_id: questionId,
      score: score || 0,
      sort_order: sortOrder || 0
    });
    // 更新试卷总分
    const totalRow = this.db.prepare(
      'SELECT SUM(score) as total FROM question_set_items WHERE question_set_id = ? AND deleted = 0'
    ).get(setId);
    this._update('question_sets', setId, { total_score: totalRow.total || 0 });
    return item;
  }

  removeItemFromSet(itemId) {
    const item = this._get('question_set_items', itemId);
    if (!item) return false;
    this._softDelete('question_set_items', itemId);
    // 更新试卷总分
    const totalRow = this.db.prepare(
      'SELECT SUM(score) as total FROM question_set_items WHERE question_set_id = ? AND deleted = 0'
    ).get(item.question_set_id);
    this._update('question_sets', item.question_set_id, { total_score: totalRow.total || 0 });
    return true;
  }

  // 随机抽题组卷
  randomPickQuestions(filters) {
    let where = 'deleted = 0';
    const params = [];
    if (filters.subject_id) { where += ' AND subject_id = ?'; params.push(filters.subject_id); }
    if (filters.chapter_id) { where += ' AND chapter_id = ?'; params.push(filters.chapter_id); }
    if (filters.type) { where += ' AND type = ?'; params.push(filters.type); }
    if (filters.difficulty) { where += ' AND difficulty = ?'; params.push(filters.difficulty); }
    const count = filters.count || 10;
    const questions = this.db.prepare(
      `SELECT * FROM questions WHERE ${where} ORDER BY RANDOM() LIMIT ?`
    ).all(...params, count);
    return questions;
  }

  // ==================== 学生做题记录 ====================

  submitRecord(data) {
    const id = uuidv4();
    // 自动批改: 选择题/判断题/填空题
    let isCorrect = null;
    let scoreEarned = 0;
    if (data.question_id && data.student_answer !== undefined) {
      const question = this._get('questions', data.question_id);
      if (question && question.answer !== null) {
        const correct = question.answer.trim().toLowerCase();
        const given = (data.student_answer || '').trim().toLowerCase();
        if (['single_choice', 'multiple_choice', 'true_false', 'fill_blank'].includes(question.type)) {
          isCorrect = correct === given ? 1 : 0;
          scoreEarned = isCorrect ? (data.score || 0) : 0;
        }
      }
    }
    return this._insert('student_records', {
      id,
      student_id: data.student_id,
      question_set_id: data.question_set_id || null,
      question_id: data.question_id,
      student_answer: data.student_answer || null,
      is_correct: data.is_correct !== undefined ? data.is_correct : isCorrect,
      score_earned: data.score_earned !== undefined ? data.score_earned : scoreEarned,
      time_spent: data.time_spent || 0
    });
  }

  getRecordsByStudent(studentId, filters = {}) {
    let where = 'sr.deleted = 0 AND sr.student_id = ?';
    const params = [studentId];
    if (filters.question_set_id) { where += ' AND sr.question_set_id = ?'; params.push(filters.question_set_id); }
    return this._paginate('student_records sr', {
      where, params,
      orderBy: 'sr.created_at DESC',
      page: parseInt(filters.page) || 1,
      limit: parseInt(filters.limit) || 20
    });
  }

  getRecordsByQuestionSet(setId) {
    return this.db.prepare(`
      SELECT sr.*, q.content as question_content, q.type as question_type
      FROM student_records sr
      JOIN questions q ON sr.question_id = q.id AND q.deleted = 0
      WHERE sr.question_set_id = ? AND sr.deleted = 0
      ORDER BY sr.created_at DESC
    `).all(setId);
  }

  getStudentStats(studentId, subjectId) {
    let where = 'sr.deleted = 0 AND sr.student_id = ?';
    const params = [studentId];
    if (subjectId) {
      where += ' AND q.subject_id = ?';
      params.push(subjectId);
    }
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sr.is_correct = 1 THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN sr.is_correct = 0 THEN 1 ELSE 0 END) as wrong,
        SUM(CASE WHEN sr.is_correct IS NULL THEN 1 ELSE 0 END) as ungraded,
        SUM(sr.score_earned) as total_score,
        SUM(sr.time_spent) as total_time
      FROM student_records sr
      JOIN questions q ON sr.question_id = q.id AND q.deleted = 0
      WHERE ${where}
    `).get(...params);
    return {
      total: stats.total || 0,
      correct: stats.correct || 0,
      wrong: stats.wrong || 0,
      ungraded: stats.ungraded || 0,
      accuracy: stats.total > 0 ? Math.round((stats.correct / (stats.correct + stats.wrong)) * 100) : 0,
      total_score: stats.total_score || 0,
      total_time: stats.total_time || 0
    };
  }

  // 按题型统计
  getStatsByType(studentId, subjectId) {
    let where = 'sr.deleted = 0 AND sr.student_id = ?';
    const params = [studentId];
    if (subjectId) { where += ' AND q.subject_id = ?'; params.push(subjectId); }
    return this.db.prepare(`
      SELECT q.type,
        COUNT(*) as total,
        SUM(CASE WHEN sr.is_correct = 1 THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN sr.is_correct = 0 THEN 1 ELSE 0 END) as wrong
      FROM student_records sr
      JOIN questions q ON sr.question_id = q.id AND q.deleted = 0
      WHERE ${where}
      GROUP BY q.type
    `).all(...params);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// 单例
let instance = null;

function getInstance() {
  if (!instance) instance = new DatabaseService();
  return instance;
}

module.exports = { DatabaseService, getInstance };
