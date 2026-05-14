const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cache = require('./cacheService');
const eventBus = require('./eventBus');

function now() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
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

function normalizeKnowledgePointIds(payload = {}) {
  const ids = payload.knowledge_point_ids || payload.knowledge_ids || [];
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

class QuestionBankService {
  ensureTenant(db, tenantId = 'default') {
    const existing = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (!existing) {
      const ts = now();
      db.prepare(
        `INSERT INTO tenants (id, name, status, plan, deleted, created_at, updated_at)
         VALUES (?, ?, 'active', 'standard', 0, ?, ?)`
      ).run(tenantId, tenantId === 'default' ? '默认租户' : tenantId, ts, ts);
    }
  }

  createQuestion(db, payload, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const questionId = payload.id || uuidv4();
    const contentId = uuidv4();
    const stem = payload.stem || payload.content || '';
    const explanation = payload.explanation !== undefined ? payload.explanation : payload.analysis;
    const options = parseJsonArray(payload.options);
    const knowledgePointIds = normalizeKnowledgePointIds(payload);
    const contentHash = payload.content_hash || hashText([stem, payload.answer, explanation, JSON.stringify(options)].join('|'));

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO questions
         (id, tenant_id, subject_id, chapter_id, type, difficulty, source, status, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`
      ).run(questionId, tenantId, payload.subject_id || null, payload.chapter_id || null, payload.type, payload.difficulty || 3, payload.source || null, ts, ts);

      db.prepare(
        `INSERT INTO question_contents
         (id, question_id, stem, answer, explanation, options_json, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)`
      ).run(contentId, questionId, stem, payload.answer || null, explanation || null, JSON.stringify(options), contentHash, payload.oss_key || null, payload.oss_url || null, ts, ts);

      for (const knowledgePointId of knowledgePointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, knowledgePointId, 1, ts, ts);
      }

      for (const asset of payload.assets || []) {
        if (!asset.oss_key) throw new Error('question asset oss_key is required');
        db.prepare(
          `INSERT INTO question_assets
           (id, question_id, asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash, deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(uuidv4(), questionId, asset.asset_type, asset.file_name || null, asset.mime_type || null, asset.size_bytes || 0, asset.oss_key, asset.oss_url || null, asset.content_hash || null, ts, ts);
      }

      this.enqueueSearchJob(db, questionId, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', questionId, { action: 'create' }, tenantId);
    });

    transaction();
    return { id: questionId, content_hash: contentHash };
  }

  _mapQuestion(row, assets = []) {
    if (!row) return null;
    const knowledgeIds = row.knowledge_point_ids ? String(row.knowledge_point_ids).split(',').filter(Boolean) : [];
    const options = parseJsonArray(row.options_json);
    return {
      ...row,
      stem: row.stem || '',
      content: row.stem || '',
      options,
      answer: row.answer || '',
      explanation: row.explanation || '',
      analysis: row.explanation || '',
      knowledge_point_ids: knowledgeIds,
      knowledge_ids: knowledgeIds,
      assets,
    };
  }

  _questionSelectSql(whereSql) {
    return `SELECT q.*,
                   qc.id AS content_id,
                   qc.stem,
                   qc.answer,
                   qc.explanation,
                   qc.options_json,
                   qc.content_hash,
                   qc.version AS content_version,
                   qc.oss_key AS content_oss_key,
                   qc.oss_url AS content_oss_url,
                   GROUP_CONCAT(qkp.knowledge_point_id) AS knowledge_point_ids
            FROM questions q
            LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
            LEFT JOIN question_knowledge_points qkp ON qkp.question_id = q.id
            ${whereSql}
            GROUP BY q.id
            ORDER BY q.updated_at DESC`;
  }

  _getAssets(db, questionId) {
    return db.prepare(
      'SELECT * FROM question_assets WHERE question_id = ? AND deleted = 0 ORDER BY created_at ASC'
    ).all(questionId);
  }

  listQuestions(db, filters = {}, tenantId = 'default') {
    const where = ['q.deleted = 0', '(q.tenant_id = ? OR q.tenant_id IS NULL)'];
    const params = [tenantId];
    if (filters.subject_id) {
      where.push('q.subject_id = ?');
      params.push(filters.subject_id);
    }
    if (filters.type) {
      where.push('q.type = ?');
      params.push(filters.type);
    }
    if (filters.difficulty) {
      where.push('q.difficulty = ?');
      params.push(Number(filters.difficulty));
    }
    if (filters.knowledge_point_id) {
      where.push('EXISTS (SELECT 1 FROM question_knowledge_points x WHERE x.question_id = q.id AND x.knowledge_point_id = ?)');
      params.push(filters.knowledge_point_id);
    }
    if (filters.q) {
      const keyword = `%${filters.q}%`;
      where.push('(qc.stem LIKE ? OR qc.answer LIKE ? OR qc.explanation LIKE ? OR q.source LIKE ?)');
      params.push(keyword, keyword, keyword, keyword);
    }

    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const rows = db.prepare(`${this._questionSelectSql(`WHERE ${where.join(' AND ')}`)} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return rows.map(row => this._mapQuestion(row, this._getAssets(db, row.id)));
  }

  getQuestion(db, id, tenantId = 'default') {
    const row = db.prepare(
      this._questionSelectSql('WHERE q.id = ? AND q.deleted = 0 AND (q.tenant_id = ? OR q.tenant_id IS NULL)')
    ).get(id, tenantId);
    return this._mapQuestion(row, row ? this._getAssets(db, id) : []);
  }

  updateQuestion(db, id, payload, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;

    const ts = now();
    const stem = payload.stem !== undefined ? payload.stem : (payload.content !== undefined ? payload.content : existing.stem);
    const answer = payload.answer !== undefined ? payload.answer : existing.answer;
    const explanation = payload.explanation !== undefined ? payload.explanation : (payload.analysis !== undefined ? payload.analysis : existing.explanation);
    const options = payload.options !== undefined ? parseJsonArray(payload.options) : existing.options;
    const contentHash = payload.content_hash || hashText([stem, answer, explanation, JSON.stringify(options)].join('|'));

    const transaction = db.transaction(() => {
      const questionUpdates = {};
      for (const key of ['subject_id', 'chapter_id', 'type', 'difficulty', 'source', 'status']) {
        if (payload[key] !== undefined) questionUpdates[key] = payload[key];
      }
      if (Object.keys(questionUpdates).length > 0) {
        const keys = Object.keys(questionUpdates);
        db.prepare(`UPDATE questions SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND deleted = 0`)
          .run(...keys.map(key => questionUpdates[key]), ts, id);
      } else {
        db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      }

      db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
      db.prepare(
        `INSERT INTO question_contents
         (id, question_id, stem, answer, explanation, options_json, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(uuidv4(), id, stem, answer || null, explanation || null, JSON.stringify(options), contentHash, (existing.content_version || 1) + 1, payload.oss_key || existing.content_oss_key || null, payload.oss_url || existing.content_oss_url || null, ts, ts);

      if (payload.knowledge_point_ids !== undefined || payload.knowledge_ids !== undefined) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
        for (const knowledgePointId of normalizeKnowledgePointIds(payload)) {
          db.prepare(
            `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, knowledgePointId, 1, ts, ts);
        }
      }

      if (payload.assets !== undefined) {
        db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
        for (const asset of payload.assets || []) {
          if (!asset.oss_key) throw new Error('question asset oss_key is required');
          db.prepare(
            `INSERT INTO question_assets
             (id, question_id, asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash, deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
          ).run(uuidv4(), id, asset.asset_type, asset.file_name || null, asset.mime_type || null, asset.size_bytes || 0, asset.oss_key, asset.oss_url || null, asset.content_hash || null, ts, ts);
        }
      }

      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'update' }, tenantId);
    });

    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  deleteQuestion(db, id, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return false;
    const ts = now();
    const transaction = db.transaction(() => {
      db.prepare('UPDATE questions SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
      db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
      db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
      this.enqueueSearchJob(db, id, 'delete', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'delete' }, tenantId);
    });
    transaction();
    return true;
  }

  searchQuestionsFallback(db, filters = {}, tenantId = 'default') {
    return this.listQuestions(db, { ...filters, limit: filters.limit || 50 }, tenantId);
  }

  enqueueSearchJob(db, questionId, operation = 'upsert', tenantId = 'default') {
    const ts = now();
    db.prepare(
      `INSERT INTO search_index_jobs
       (id, tenant_id, entity_type, entity_id, operation, status, created_at, updated_at)
       VALUES (?, ?, 'question', ?, ?, 'pending', ?, ?)`
    ).run(uuidv4(), tenantId, questionId, operation, ts, ts);
  }

  createImportBatch(db, payload, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const batchId = uuidv4();
    const items = payload.items || [];
    const seen = new Set();
    let duplicateItems = 0;
    let rejectedItems = 0;

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO import_batches
         (id, tenant_id, source_type, file_name, file_hash, status, total_items, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'checking', ?, ?, ?)`
      ).run(batchId, tenantId, payload.source_type || 'manual', payload.file_name || null, payload.file_hash || null, items.length, ts, ts);

      items.forEach((item, index) => {
        const contentHash = hashText(JSON.stringify(item));
        const duplicate = seen.has(contentHash) || !!db.prepare(
          'SELECT 1 FROM question_contents WHERE content_hash = ? AND deleted = 0'
        ).get(contentHash);
        seen.add(contentHash);
        const valid = !!(item.stem || item.content) && !!item.type;
        const status = !valid ? 'rejected' : duplicate ? 'duplicate' : 'accepted';
        if (duplicate) duplicateItems++;
        if (!valid) rejectedItems++;
        db.prepare(
          `INSERT INTO import_items
           (id, batch_id, item_index, content_hash, status, quality_score, error_message, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(uuidv4(), batchId, index, contentHash, status, valid ? 1 : 0, valid ? null : '缺少题干或题型', JSON.stringify(item), ts, ts);
      });

      db.prepare(
        `UPDATE import_batches
         SET status = 'checked', accepted_items = ?, duplicate_items = ?, rejected_items = ?, quality_report = ?, updated_at = ?
         WHERE id = ?`
      ).run(items.length - duplicateItems - rejectedItems, duplicateItems, rejectedItems, JSON.stringify({ duplicateItems, rejectedItems }), ts, batchId);
    });

    transaction();
    return { id: batchId, total_items: items.length, duplicate_items: duplicateItems, rejected_items: rejectedItems };
  }

  async refreshKnowledgeRollups(db) {
    const rows = db.prepare(
      `SELECT qkp.knowledge_point_id,
              COUNT(*) AS direct_question_count,
              SUM(CASE WHEN q.difficulty <= 2 THEN 1 ELSE 0 END) AS easy_count,
              SUM(CASE WHEN q.difficulty = 3 THEN 1 ELSE 0 END) AS medium_count,
              SUM(CASE WHEN q.difficulty >= 4 THEN 1 ELSE 0 END) AS hard_count
       FROM question_knowledge_points qkp
       JOIN questions q ON q.id = qkp.question_id AND q.deleted = 0
       GROUP BY qkp.knowledge_point_id`
    ).all();
    const ts = now();
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO knowledge_point_rollups
       (knowledge_point_id, direct_question_count, total_question_count, easy_count, medium_count, hard_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const transaction = db.transaction(() => {
      for (const row of rows) {
        upsert.run(row.knowledge_point_id, row.direct_question_count, row.direct_question_count, row.easy_count || 0, row.medium_count || 0, row.hard_count || 0, ts);
      }
    });
    transaction();
    await cache.setKnowledgeRollups(rows);
    return rows;
  }
}

module.exports = new QuestionBankService();
