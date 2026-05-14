const { Router } = require('express');
const { getInstance } = require('../database');
const questionBank = require('../services/questionBankService');
const searchService = require('../services/searchService');
const eventBus = require('../services/eventBus');
const cache = require('../services/cacheService');

const router = Router();

function errorStatus(err) {
  return /oss_key is required/.test(err.message) ? 400 : 500;
}

router.get('/questions', (req, res) => {
  try {
    const db = getInstance().db;
    const tenantId = req.query.tenant_id || 'default';
    const rows = questionBank.listQuestions(db, req.query, tenantId);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/questions/search', async (req, res) => {
  try {
    const db = getInstance().db;
    const { q, subject_id, type, difficulty, tenant_id } = req.query;
    try {
      const remote = await searchService.searchQuestions(q, { subject_id, type, difficulty });
      if (remote) return res.json({ success: true, engine: 'opensearch', result: remote });
    } catch (err) {
      console.warn(`[QuestionBank] OpenSearch search fallback: ${err.message}`);
    }

    const rows = questionBank.searchQuestionsFallback(db, req.query, tenant_id || 'default');
    res.json({ success: true, engine: 'sqlite', result: rows });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/questions/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const tenantId = req.query.tenant_id || 'default';
    const row = questionBank.getQuestion(db, req.params.id, tenantId);
    if (!row) return res.status(404).json({ success: false, error: 'question not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/questions', (req, res) => {
  try {
    const db = getInstance().db;
    const tenantId = req.body.tenant_id || 'default';
    const result = questionBank.createQuestion(db, req.body, tenantId);
    searchService.schedulePendingJobs(db);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.put('/questions/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const tenantId = req.body.tenant_id || req.query.tenant_id || 'default';
    const result = questionBank.updateQuestion(db, req.params.id, req.body, tenantId);
    if (!result) return res.status(404).json({ success: false, error: 'question not found' });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.delete('/questions/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const tenantId = req.body?.tenant_id || req.query.tenant_id || 'default';
    const deleted = questionBank.deleteQuestion(db, req.params.id, tenantId);
    if (!deleted) return res.status(404).json({ success: false, error: 'question not found' });
    searchService.schedulePendingJobs(db);
    res.json({ success: true });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/vectors', (req, res) => {
  try {
    const db = getInstance().db;
    const now = new Date().toISOString();
    const id = req.body.id || require('uuid').v4();
    db.prepare(
      `INSERT OR REPLACE INTO vector_embeddings
       (id, tenant_id, entity_type, entity_id, model, vector_json, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.body.tenant_id || 'default',
      req.body.entity_type || 'question',
      req.body.entity_id,
      req.body.model || 'reserved',
      JSON.stringify(req.body.vector || []),
      req.body.content_hash || null,
      req.body.created_at || now,
      now
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/questions/similar', (req, res) => {
  try {
    const db = getInstance().db;
    const source = db.prepare(
      "SELECT * FROM vector_embeddings WHERE entity_type = 'question' AND entity_id = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(req.body.question_id);
    if (!source) return res.json({ success: true, engine: 'reserved', result: [] });
    const sourceVector = JSON.parse(source.vector_json || '[]');
    const rows = db.prepare(
      "SELECT * FROM vector_embeddings WHERE entity_type = 'question' AND entity_id != ? LIMIT 200"
    ).all(req.body.question_id);
    const dot = (a, b) => a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
    const norm = (a) => Math.sqrt(a.reduce((sum, value) => sum + value * value, 0)) || 1;
    const result = rows
      .map(row => {
        const vector = JSON.parse(row.vector_json || '[]');
        return { entity_id: row.entity_id, score: dot(sourceVector, vector) / (norm(sourceVector) * norm(vector)) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, req.body.limit || 20);
    res.json({ success: true, engine: 'sqlite-vector-reserved', result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/imports/check', (req, res) => {
  try {
    const dbService = getInstance();
    const db = dbService.db;
    const tenantId = req.body.tenant_id || 'default';
    const result = questionBank.createImportBatch(db, req.body, tenantId);
    dbService._auditOperation({
      tenant_id: tenantId,
      action: 'import',
      table_name: 'import_batches',
      record_id: result.batchId || result.id || null,
      status: result.rejected_items > 0 ? 'partial' : 'success',
      detail: {
        source: 'question-bank',
        fileName: req.body.file_name || null,
        totalItems: result.total_items,
        acceptedItems: result.total_items - result.duplicate_items - result.rejected_items,
        duplicateItems: result.duplicate_items,
        rejectedItems: result.rejected_items,
      },
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/rollups/refresh', async (_req, res) => {
  try {
    const db = getInstance().db;
    const rows = await questionBank.refreshKnowledgeRollups(db);
    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/rollups', async (_req, res) => {
  try {
    const cached = await cache.getKnowledgeRollups();
    if (cached) return res.json({ success: true, source: 'cache', data: cached });
    const db = getInstance().db;
    const rows = db.prepare('SELECT * FROM knowledge_point_rollups').all();
    await cache.setKnowledgeRollups(rows);
    res.json({ success: true, source: 'db', data: rows });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/search/jobs', (req, res) => {
  try {
    const db = getInstance().db;
    const jobs = searchService.listJobs(db, req.query);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/search/jobs/run', async (req, res) => {
  try {
    const db = getInstance().db;
    const result = await searchService.processPendingJobs(db, { limit: req.body?.limit });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/events/publish-pending', async (_req, res) => {
  try {
    const db = getInstance().db;
    const events = eventBus.listPending(db, 100);
    for (const event of events) {
      eventBus.markPublished(db, event.id);
    }
    searchService.schedulePendingJobs(db);
    res.json({ success: true, published: events.length });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

module.exports = router;
