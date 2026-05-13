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
    const contentHash = hashText([stem, payload.answer, payload.explanation, JSON.stringify(payload.options || [])].join('|'));

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
      ).run(contentId, questionId, stem, payload.answer || null, payload.explanation || null, JSON.stringify(payload.options || []), contentHash, payload.oss_key || null, payload.oss_url || null, ts, ts);

      for (const knowledgePointId of payload.knowledge_point_ids || []) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, knowledgePointId, 1, ts, ts);
      }

      for (const asset of payload.assets || []) {
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
    await cache.set('knowledge_point_rollups', rows, 600);
    return rows;
  }
}

module.exports = new QuestionBankService();
