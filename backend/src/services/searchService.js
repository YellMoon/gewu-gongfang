function now() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
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

function hashText(value) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function tokenizeForEmbedding(value) {
  const text = String(value || '').toLowerCase();
  const tokens = text
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const cjk = text.match(/[\u3400-\u9fff]/g) || [];
  for (let index = 0; index < cjk.length; index++) {
    tokens.push(cjk[index]);
    if (index + 1 < cjk.length) tokens.push(`${cjk[index]}${cjk[index + 1]}`);
    if (index + 2 < cjk.length) tokens.push(`${cjk[index]}${cjk[index + 1]}${cjk[index + 2]}`);
  }
  return tokens;
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map(value => Math.round((value / norm) * 1000000) / 1000000);
}

function parseVector(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch (_err) {
    return [];
  }
}

function cosineSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index++) {
    const av = Number(a[index]) || 0;
    const bv = Number(b[index]) || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class SearchService {
  constructor() {
    this.endpoint = (process.env.OPENSEARCH_ENDPOINT || '').replace(/\/$/, '');
    this.index = process.env.OPENSEARCH_QUESTION_INDEX || 'questions';
    this.maxAttempts = Math.max(1, Number(process.env.SEARCH_INDEX_MAX_ATTEMPTS) || 5);
    this.batchSize = Math.max(1, Number(process.env.SEARCH_INDEX_BATCH_SIZE) || 20);
    this.embeddingModel = process.env.QUESTION_EMBEDDING_MODEL || 'local-hash-v1';
    this.embeddingDimensions = Math.min(Math.max(Number(process.env.QUESTION_EMBEDDING_DIMENSIONS) || 64, 8), 512);
    this._draining = false;
  }

  enabled() {
    return !!this.endpoint && typeof fetch === 'function';
  }

  async indexQuestion(document) {
    if (!this.enabled()) return { queued: true, reason: 'opensearch-disabled' };
    const res = await fetch(`${this.endpoint}/${this.index}/_doc/${encodeURIComponent(document.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (!res.ok) throw new Error(`OpenSearch index failed: HTTP ${res.status}`);
    return res.json();
  }

  async deleteQuestion(questionId) {
    if (!this.enabled()) return { queued: true, reason: 'opensearch-disabled' };
    const res = await fetch(`${this.endpoint}/${this.index}/_doc/${encodeURIComponent(questionId)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) throw new Error(`OpenSearch delete failed: HTTP ${res.status}`);
    return res.status === 404 ? { deleted: false, reason: 'not-found' } : res.json();
  }

  async searchQuestions(keyword, filters = {}) {
    if (!this.enabled()) return null;
    const must = [];
    if (keyword) {
      must.push({
        multi_match: {
          query: keyword,
          fields: ['stem^3', 'answer', 'explanation', 'source'],
        },
      });
    }
    for (const [field, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        must.push({ term: { [field]: value } });
      }
    }
    const res = await fetch(`${this.endpoint}/${this.index}/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { bool: { must } }, size: 50 }),
    });
    if (!res.ok) throw new Error(`OpenSearch search failed: HTTP ${res.status}`);
    return res.json();
  }

  ensureJobSchema(db) {
    const columns = db.prepare('PRAGMA table_info(search_index_jobs)').all().map(row => row.name);
    const addColumn = (name, sql) => {
      if (!columns.includes(name)) db.prepare(`ALTER TABLE search_index_jobs ADD COLUMN ${sql}`).run();
    };
    addColumn('retry_count', 'retry_count INTEGER DEFAULT 0');
    addColumn('max_attempts', `max_attempts INTEGER DEFAULT ${this.maxAttempts}`);
    addColumn('next_attempt_at', 'next_attempt_at TEXT');
    addColumn('locked_at', 'locked_at TEXT');
    addColumn('last_attempt_at', 'last_attempt_at TEXT');
  }

  buildQuestionDocument(db, questionId) {
    const row = db.prepare(
      `SELECT q.*,
              qc.stem,
              qc.answer,
              qc.explanation,
              qc.options_json,
              qc.content_hash,
              GROUP_CONCAT(qkp.knowledge_point_id) AS knowledge_point_ids
       FROM questions q
       LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
       LEFT JOIN question_knowledge_points qkp ON qkp.question_id = q.id
       WHERE q.id = ?
       GROUP BY q.id`
    ).get(questionId);
    if (!row || Number(row.deleted || 0) === 1) return null;

    const assets = db.prepare(
      `SELECT asset_type, file_name, mime_type, size_bytes, oss_key, oss_url, content_hash
       FROM question_assets
       WHERE question_id = ? AND deleted = 0
       ORDER BY created_at ASC`
    ).all(questionId);
    const knowledgePointIds = row.knowledge_point_ids ? String(row.knowledge_point_ids).split(',').filter(Boolean) : [];

    return {
      id: row.id,
      tenant_id: row.tenant_id || 'default',
      subject_id: row.subject_id,
      chapter_id: row.chapter_id,
      type: row.type,
      difficulty: row.difficulty,
      source: row.source,
      status: row.status,
      stem: row.stem || '',
      answer: row.answer || '',
      explanation: row.explanation || '',
      options: parseJsonArray(row.options_json),
      content_hash: row.content_hash,
      knowledge_point_ids: knowledgePointIds,
      assets,
      updated_at: row.updated_at,
    };
  }

  buildQuestionEmbeddingText(document = {}) {
    const options = Array.isArray(document.options) ? document.options.join(' ') : '';
    return [
      document.stem,
      options,
      document.answer,
      document.explanation,
      document.source,
      Array.isArray(document.knowledge_point_ids) ? document.knowledge_point_ids.join(' ') : '',
    ].filter(Boolean).join('\n');
  }

  createLocalEmbedding(text, dimensions = this.embeddingDimensions) {
    const vector = new Array(dimensions).fill(0);
    const tokens = tokenizeForEmbedding(text);
    for (const token of tokens) {
      const hash = hashText(token);
      for (let offset = 0; offset < 8; offset += 2) {
        const bucket = parseInt(hash.slice(offset * 2, offset * 2 + 4), 16) % dimensions;
        const sign = parseInt(hash.slice(offset * 2 + 4, offset * 2 + 6), 16) % 2 === 0 ? 1 : -1;
        vector[bucket] += sign;
      }
    }
    return normalizeVector(vector);
  }

  ensureVectorSchema(db) {
    const columns = db.prepare('PRAGMA table_info(vector_embeddings)').all().map(row => row.name);
    const addColumn = (name, sql) => {
      if (!columns.includes(name)) db.prepare(`ALTER TABLE vector_embeddings ADD COLUMN ${sql}`).run();
    };
    addColumn('content_hash', 'content_hash TEXT');
    db.prepare('CREATE INDEX IF NOT EXISTS idx_vector_entity ON vector_embeddings(entity_type, entity_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_vector_question_lookup ON vector_embeddings(tenant_id, entity_type, model, updated_at)').run();
  }

  upsertQuestionEmbedding(db, questionId, options = {}) {
    this.ensureVectorSchema(db);
    const tenantId = options.tenantId || options.tenant_id || 'default';
    const model = options.model || this.embeddingModel;
    const document = this.buildQuestionDocument(db, questionId);
    if (!document) return null;

    const text = this.buildQuestionEmbeddingText(document);
    const contentHash = hashText([model, text].join('|'));
    const existing = db.prepare(
      `SELECT id, content_hash FROM vector_embeddings
       WHERE tenant_id = ? AND entity_type = 'question' AND entity_id = ? AND model = ?
       ORDER BY updated_at DESC LIMIT 1`
    ).get(tenantId, questionId, model);
    if (existing && existing.content_hash === contentHash) {
      return { id: existing.id, entity_id: questionId, model, reused: true };
    }

    const ts = now();
    const id = existing?.id || `vec_${hashText(`${tenantId}:${questionId}:${model}`).slice(0, 24)}`;
    const vector = Array.isArray(options.vector) ? normalizeVector(options.vector.map(Number)) : this.createLocalEmbedding(text);
    db.prepare(
      `INSERT OR REPLACE INTO vector_embeddings
       (id, tenant_id, entity_type, entity_id, model, vector_json, content_hash, created_at, updated_at)
       VALUES (?, ?, 'question', ?, ?, ?, ?, COALESCE((SELECT created_at FROM vector_embeddings WHERE id = ?), ?), ?)`
    ).run(id, tenantId, questionId, model, JSON.stringify(vector), contentHash, id, ts, ts);

    return { id, entity_id: questionId, model, dimensions: vector.length, content_hash: contentHash };
  }

  upsertVector(db, payload = {}) {
    this.ensureVectorSchema(db);
    if (!payload.entity_id) throw new Error('entity_id is required');
    const tenantId = payload.tenant_id || payload.tenantId || 'default';
    const entityType = payload.entity_type || payload.entityType || 'question';
    const model = payload.model || this.embeddingModel;
    const vector = Array.isArray(payload.vector) ? normalizeVector(payload.vector.map(Number)) : parseVector(payload.vector_json);
    if (!vector.length) throw new Error('vector is required');
    const ts = now();
    const id = payload.id || `vec_${hashText(`${tenantId}:${entityType}:${payload.entity_id}:${model}`).slice(0, 24)}`;
    db.prepare(
      `INSERT OR REPLACE INTO vector_embeddings
       (id, tenant_id, entity_type, entity_id, model, vector_json, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM vector_embeddings WHERE id = ?), ?), ?)`
    ).run(
      id,
      tenantId,
      entityType,
      payload.entity_id,
      model,
      JSON.stringify(vector),
      payload.content_hash || hashText(JSON.stringify(vector)),
      id,
      payload.created_at || ts,
      ts
    );
    return { id, entity_id: payload.entity_id, model, dimensions: vector.length };
  }

  findSimilarQuestions(db, options = {}) {
    this.ensureVectorSchema(db);
    const tenantId = options.tenantId || options.tenant_id || 'default';
    const model = options.model || this.embeddingModel;
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const minScore = Number(options.minScore ?? options.min_score ?? -1);
    const questionId = options.questionId || options.question_id || null;

    let source = null;
    if (Array.isArray(options.vector)) {
      source = { entity_id: options.entity_id || questionId || '__query__', vector_json: JSON.stringify(normalizeVector(options.vector.map(Number))) };
    } else if (questionId) {
      source = db.prepare(
        `SELECT * FROM vector_embeddings
         WHERE tenant_id = ? AND entity_type = 'question' AND entity_id = ? AND model = ?
         ORDER BY updated_at DESC LIMIT 1`
      ).get(tenantId, questionId, model);
      if (!source && options.autoGenerate !== false) {
        this.upsertQuestionEmbedding(db, questionId, { tenantId, model });
        source = db.prepare(
          `SELECT * FROM vector_embeddings
           WHERE tenant_id = ? AND entity_type = 'question' AND entity_id = ? AND model = ?
           ORDER BY updated_at DESC LIMIT 1`
        ).get(tenantId, questionId, model);
      }
    }
    if (!source) return { engine: 'sqlite-vector', model, result: [], reason: 'source-vector-not-found' };

    const sourceVector = parseVector(source.vector_json);
    const rows = db.prepare(
      `SELECT ve.entity_id,
              ve.model,
              ve.vector_json,
              ve.updated_at,
              q.subject_id,
              q.chapter_id,
              q.type,
              q.difficulty,
              qc.stem
       FROM vector_embeddings ve
       JOIN questions q ON q.id = ve.entity_id AND q.deleted = 0
       LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
       WHERE ve.tenant_id = ?
         AND ve.entity_type = 'question'
         AND ve.model = ?
         AND ve.entity_id != ?
       ORDER BY ve.updated_at DESC
       LIMIT 1000`
    ).all(tenantId, model, source.entity_id);

    const result = rows
      .map(row => ({
        question_id: row.entity_id,
        entity_id: row.entity_id,
        score: Math.round(cosineSimilarity(sourceVector, parseVector(row.vector_json)) * 1000000) / 1000000,
        model: row.model,
        subject_id: row.subject_id,
        chapter_id: row.chapter_id,
        type: row.type,
        difficulty: row.difficulty,
        stem: row.stem || '',
        updated_at: row.updated_at,
      }))
      .filter(item => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { engine: 'sqlite-vector', model, dimensions: sourceVector.length, result };
  }

  listRunnableJobs(db, limit = this.batchSize) {
    this.ensureJobSchema(db);
    const ts = now();
    return db.prepare(
      `SELECT *
       FROM search_index_jobs
       WHERE status IN ('pending', 'retry')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`
    ).all(ts, Math.min(Math.max(Number(limit) || this.batchSize, 1), 100));
  }

  listJobs(db, filters = {}) {
    this.ensureJobSchema(db);
    const params = [];
    const where = [];
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.entity_id) {
      where.push('entity_id = ?');
      params.push(filters.entity_id);
    }
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(
      `SELECT *
       FROM search_index_jobs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
  }

  async processJob(db, job) {
    this.ensureJobSchema(db);
    const startedAt = now();
    db.prepare(
      `UPDATE search_index_jobs
       SET status = 'running', locked_at = ?, last_attempt_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(startedAt, startedAt, startedAt, job.id);

    try {
      if (job.entity_type !== 'question') throw new Error(`unsupported search entity: ${job.entity_type}`);
      if (job.operation === 'delete') {
        await this.deleteQuestion(job.entity_id);
      } else {
        const document = this.buildQuestionDocument(db, job.entity_id);
        if (!document) {
          await this.deleteQuestion(job.entity_id);
        } else {
          await this.indexQuestion(document);
        }
      }

      const finishedAt = now();
      db.prepare(
        `UPDATE search_index_jobs
         SET status = 'done', error_message = NULL, locked_at = NULL, processed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(finishedAt, finishedAt, job.id);
      return { id: job.id, status: 'done' };
    } catch (err) {
      const retryCount = Number(job.retry_count || 0) + 1;
      const maxAttempts = Number(job.max_attempts || this.maxAttempts);
      const retryable = retryCount < maxAttempts;
      const ts = now();
      const nextAttemptAt = retryable ? addMinutes(new Date(), Math.min(30, 2 ** Math.min(retryCount, 5))) : null;
      db.prepare(
        `UPDATE search_index_jobs
         SET status = ?, retry_count = ?, max_attempts = ?, error_message = ?, next_attempt_at = ?,
             locked_at = NULL, updated_at = ?
         WHERE id = ?`
      ).run(retryable ? 'retry' : 'failed', retryCount, maxAttempts, err.message, nextAttemptAt, ts, job.id);
      return { id: job.id, status: retryable ? 'retry' : 'failed', error: err.message };
    }
  }

  async processPendingJobs(db, options = {}) {
    this.ensureJobSchema(db);
    if (!this.enabled()) {
      return { processed: 0, skipped: true, reason: 'opensearch-disabled' };
    }

    const jobs = this.listRunnableJobs(db, options.limit || this.batchSize);
    const results = [];
    for (const job of jobs) {
      results.push(await this.processJob(db, job));
    }
    return { processed: results.length, results };
  }

  schedulePendingJobs(db) {
    if (this._draining || !this.enabled()) return;
    this._draining = true;
    setImmediate(async () => {
      try {
        await this.processPendingJobs(db);
      } catch (err) {
        console.warn(`[SearchIndex] drain failed: ${err.message}`);
      } finally {
        this._draining = false;
      }
    });
  }
}

module.exports = new SearchService();
