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

function normalizeOssRef(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const ossKey = value.oss_key || value.ossKey || value.key || null;
  const ossUrl = value.oss_url || value.ossUrl || value.url || null;
  if (!ossKey && !ossUrl) return null;
  return { oss_key: ossKey, oss_url: ossUrl };
}

function normalizeAsset(asset = {}, fallbackType = 'attachment') {
  const ref = normalizeOssRef(asset);
  if (!ref?.oss_key) throw new Error('question asset oss_key is required');
  return {
    asset_type: asset.asset_type || asset.assetType || asset.type || fallbackType,
    file_name: asset.file_name || asset.fileName || asset.name || null,
    mime_type: asset.mime_type || asset.mimeType || null,
    size_bytes: Number(asset.size_bytes ?? asset.sizeBytes ?? asset.size ?? 0) || 0,
    oss_key: ref.oss_key,
    oss_url: ref.oss_url || null,
    content_hash: asset.content_hash || asset.contentHash || null,
  };
}

function normalizeQuestionAssets(payload = {}) {
  const assets = [];
  for (const asset of payload.assets || []) {
    assets.push(normalizeAsset(asset));
  }

  const coverPayload = payload.cover || payload.cover_image || payload.title_image;
  if (normalizeOssRef(coverPayload)) {
    assets.push(normalizeAsset(coverPayload, 'cover'));
  }

  for (const attachment of payload.attachments || []) {
    assets.push(normalizeAsset(attachment, 'attachment'));
  }

  return assets;
}

function normalizeOptions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(option => {
      if (typeof option === 'string') return option.trim();
      if (!option) return '';
      const label = option.label ? `${option.label}. ` : '';
      return `${label}${option.content || option.text || ''}`.trim();
    }).filter(Boolean);
  }
  return parseJsonArray(value);
}

function normalizeImportItem(item = {}, defaults = {}) {
  const questionTypes = Array.isArray(item.question_types) ? item.question_types : [];
  const type = item.type ||
    (questionTypes.includes('single') ? 'single' :
      questionTypes.includes('multi') ? 'multi' :
        questionTypes.includes('experiment') ? 'experiment' :
          questionTypes.includes('calculation') || questionTypes.includes('problem') ? 'problem' :
            questionTypes[0]) ||
    defaults.type ||
    'fill';
  return {
    ...item,
    subject_id: item.subject_id || defaults.subject_id || null,
    chapter_id: item.chapter_id || defaults.chapter_id || null,
    type,
    difficulty: Number(item.difficulty || defaults.difficulty || 3),
    stem: String(item.stem || item.content || '').trim(),
    answer: item.answer !== undefined ? String(item.answer || '').trim() : '',
    explanation: item.explanation !== undefined ? item.explanation : item.analysis,
    options: normalizeOptions(item.options),
    source: item.source || defaults.source || null,
    knowledge_point_ids: normalizeKnowledgePointIds(item).length > 0
      ? normalizeKnowledgePointIds(item)
      : normalizeKnowledgePointIds(defaults),
  };
}

function contentHashForQuestion(item) {
  return hashText([
    item.stem || item.content || '',
    item.answer || '',
    item.explanation !== undefined ? item.explanation : item.analysis || '',
    JSON.stringify(normalizeOptions(item.options)),
  ].join('|'));
}

function validateImportItem(item) {
  const errors = [];
  const warnings = [];
  if (!item.stem) errors.push('missing_stem');
  if (!item.type) errors.push('missing_type');
  if (item.stem && item.stem.length < 4) warnings.push('short_stem');
  if (item.options.length > 0 && item.options.length < 2) warnings.push('few_options');
  if (!item.answer) warnings.push('missing_answer');
  if (item.difficulty < 1 || item.difficulty > 5) warnings.push('difficulty_out_of_range');
  const score = Math.max(0, Math.round((1 - errors.length * 0.45 - warnings.length * 0.12) * 100) / 100);
  return { errors, warnings, score };
}

class QuestionBankService {
  ensureTenant(db, tenantId = 'default') {
    const existing = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
    if (!existing) {
      const ts = now();
      db.prepare(
        `INSERT INTO tenants (id, name, status, plan, deleted, created_at, updated_at)
         VALUES (?, ?, 'active', 'standard', 0, ?, ?)`
      ).run(tenantId, tenantId === 'default' ? '榛樿绉熸埛' : tenantId, ts, ts);
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
    const contentRef = normalizeOssRef(payload);
    const assets = normalizeQuestionAssets(payload);

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO questions
         (id, tenant_id, subject_id, chapter_id, type, difficulty, source, status, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`
      ).run(questionId, tenantId, payload.subject_id || null, payload.chapter_id || null, payload.type, payload.difficulty || 3, payload.source || null, ts, ts);

      db.prepare(
        `INSERT INTO question_contents
         (id, tenant_id, question_id, stem, answer, explanation, options_json, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)`
      ).run(contentId, tenantId, questionId, stem, payload.answer || null, explanation || null, JSON.stringify(options), contentHash, contentRef?.oss_key || null, contentRef?.oss_url || null, ts, ts);

      for (const knowledgePointId of knowledgePointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, knowledgePointId, 1, ts, ts);
      }

      for (const asset of assets) {
        db.prepare(
          `INSERT INTO question_assets
           (id, tenant_id, question_id, asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash, deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(uuidv4(), tenantId, questionId, asset.asset_type, asset.file_name || null, asset.mime_type || null, asset.size_bytes || 0, asset.oss_key, asset.oss_url || null, asset.content_hash || null, ts, ts);
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
      oss_key: row.content_oss_key || null,
      oss_url: row.content_oss_url || null,
      oss: row.content_oss_key || row.content_oss_url ? {
        oss_key: row.content_oss_key || null,
        oss_url: row.content_oss_url || null,
      } : null,
      knowledge_point_ids: knowledgeIds,
      knowledge_ids: knowledgeIds,
      assets,
      cover: assets.find(asset => asset.asset_type === 'cover') || null,
      attachments: assets.filter(asset => asset.asset_type !== 'cover'),
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
    const where = ['q.deleted = 0', 'q.tenant_id = ?'];
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
      this._questionSelectSql('WHERE q.id = ? AND q.deleted = 0 AND q.tenant_id = ?')
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
    const contentRef = normalizeOssRef(payload) || {
      oss_key: existing.content_oss_key || existing.oss_key || null,
      oss_url: existing.content_oss_url || existing.oss_url || null,
    };

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
         (id, tenant_id, question_id, stem, answer, explanation, options_json, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(uuidv4(), tenantId, id, stem, answer || null, explanation || null, JSON.stringify(options), contentHash, (existing.content_version || 1) + 1, contentRef.oss_key || null, contentRef.oss_url || null, ts, ts);

      if (payload.knowledge_point_ids !== undefined || payload.knowledge_ids !== undefined) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
        for (const knowledgePointId of normalizeKnowledgePointIds(payload)) {
          db.prepare(
            `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, knowledgePointId, 1, ts, ts);
        }
      }

      if (payload.assets !== undefined || payload.cover !== undefined || payload.cover_image !== undefined || payload.title_image !== undefined || payload.attachments !== undefined) {
        db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
        for (const asset of normalizeQuestionAssets(payload)) {
          db.prepare(
            `INSERT INTO question_assets
             (id, tenant_id, question_id, asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash, deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
          ).run(uuidv4(), tenantId, id, asset.asset_type, asset.file_name || null, asset.mime_type || null, asset.size_bytes || 0, asset.oss_key, asset.oss_url || null, asset.content_hash || null, ts, ts);
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


  getImportBatch(db, batchId, tenantId = 'default') {
    const batch = db.prepare(
      'SELECT * FROM import_batches WHERE id = ? AND tenant_id = ?'
    ).get(batchId, tenantId);
    if (!batch) return null;
    const items = db.prepare(
      'SELECT * FROM import_items WHERE batch_id = ? ORDER BY item_index ASC'
    ).all(batchId).map(row => ({
      ...row,
      payload: row.payload ? JSON.parse(row.payload) : null,
    }));
    return {
      ...batch,
      quality_report: batch.quality_report ? JSON.parse(batch.quality_report) : null,
      items,
    };
  }

  listImportBatches(db, filters = {}, tenantId = 'default') {
    const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
    return db.prepare(
      `SELECT * FROM import_batches
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(tenantId, limit).map(row => ({
      ...row,
      quality_report: row.quality_report ? JSON.parse(row.quality_report) : null,
    }));
  }

  createImportBatch(db, payload, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const batchId = uuidv4();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const seen = new Set();
    let duplicateItems = 0;
    let rejectedItems = 0;
    let acceptedItems = 0;
    const duplicateSources = { in_batch: 0, existing_bank: 0 };
    const qualityBuckets = { high: 0, medium: 0, low: 0 };
    const errors = {};
    const warnings = {};

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO import_batches
         (id, tenant_id, source_type, file_name, file_hash, status, total_items, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'checking', ?, ?, ?)`
      ).run(batchId, tenantId, payload.source_type || 'manual', payload.file_name || null, payload.file_hash || null, items.length, ts, ts);

      items.forEach((item, index) => {
        const normalized = normalizeImportItem(item, payload.defaults || {});
        const contentHash = contentHashForQuestion(normalized);
        const quality = validateImportItem(normalized);
        const valid = quality.errors.length === 0;
        const inBatchDuplicate = valid && seen.has(contentHash);
        const existingDuplicate = valid && !!db.prepare(
          'SELECT 1 FROM question_contents WHERE content_hash = ? AND deleted = 0'
        ).get(contentHash);
        const duplicate = inBatchDuplicate || existingDuplicate;
        const status = !valid ? 'rejected' : duplicate ? 'duplicate' : 'accepted';
        if (!valid) {
          rejectedItems++;
        } else if (duplicate) {
          duplicateItems++;
          if (inBatchDuplicate) duplicateSources.in_batch++;
          if (existingDuplicate) duplicateSources.existing_bank++;
        } else {
          acceptedItems++;
        }
        if (valid) seen.add(contentHash);
        const bucket = quality.score >= 0.8 ? 'high' : quality.score >= 0.5 ? 'medium' : 'low';
        qualityBuckets[bucket]++;
        for (const code of quality.errors) errors[code] = (errors[code] || 0) + 1;
        for (const code of quality.warnings) warnings[code] = (warnings[code] || 0) + 1;
        db.prepare(
          `INSERT INTO import_items
           (id, batch_id, item_index, content_hash, status, quality_score, error_message, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(),
          batchId,
          index,
          contentHash,
          status,
          quality.score,
          quality.errors.length ? quality.errors.join(',') : null,
          JSON.stringify({ ...normalized, content_hash: contentHash, quality_warnings: quality.warnings }),
          ts,
          ts
        );
      });

      const qualityReport = {
        status: rejectedItems > 0 ? 'needs_review' : duplicateItems > 0 ? 'has_duplicates' : 'ready',
        total_items: items.length,
        accepted_items: acceptedItems,
        duplicate_items: duplicateItems,
        rejected_items: rejectedItems,
        duplicate_sources: duplicateSources,
        quality_buckets: qualityBuckets,
        errors,
        warnings,
      };
      db.prepare(
        `UPDATE import_batches
         SET status = 'checked', accepted_items = ?, duplicate_items = ?, rejected_items = ?, quality_report = ?, updated_at = ?
         WHERE id = ?`
      ).run(acceptedItems, duplicateItems, rejectedItems, JSON.stringify(qualityReport), ts, batchId);
    });

    transaction();
    return this.getImportBatch(db, batchId, tenantId);
  }

  commitImportBatch(db, batchId, tenantId = 'default') {
    const batch = this.getImportBatch(db, batchId, tenantId);
    if (!batch) return null;
    if (!['checked', 'partial_failed'].includes(batch.status)) {
      throw new Error(`import batch status ${batch.status} cannot be committed`);
    }
    const ts = now();
    const accepted = batch.items.filter(item => item.status === 'accepted');
    const result = { imported_items: 0, failed_items: 0, question_ids: [], errors: [] };

    const transaction = db.transaction(() => {
      db.prepare('UPDATE import_batches SET status = ?, updated_at = ? WHERE id = ?').run('importing', ts, batchId);
      for (const item of accepted) {
        try {
          const payload = item.payload || {};
          const created = this.createQuestion(db, { ...payload, content_hash: item.content_hash }, tenantId);
          db.prepare('UPDATE import_items SET status = ?, updated_at = ? WHERE id = ?').run('imported', now(), item.id);
          result.imported_items++;
          result.question_ids.push(created.id);
        } catch (err) {
          result.failed_items++;
          result.errors.push({ item_index: item.item_index, error: err.message });
          db.prepare('UPDATE import_items SET status = ?, error_message = ?, updated_at = ? WHERE id = ?')
            .run('failed', err.message, now(), item.id);
        }
      }
      const finalStatus = result.failed_items > 0 ? 'partial_failed' : 'imported';
      db.prepare('UPDATE import_batches SET status = ?, updated_at = ? WHERE id = ?').run(finalStatus, now(), batchId);
    });

    transaction();
    return { ...this.getImportBatch(db, batchId, tenantId), commit_result: result };
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
