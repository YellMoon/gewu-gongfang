const { Router } = require('express');
const { getInstance } = require('../database');
const questionBank = require('../services/questionBankService');
const searchService = require('../services/searchService');
const eventBus = require('../services/eventBus');
const cache = require('../services/cacheService');

const router = Router();

router.post('/questions', (req, res) => {
  try {
    const db = getInstance().db;
    const tenantId = req.body.tenant_id || 'default';
    const result = questionBank.createQuestion(db, req.body, tenantId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/questions/search', async (req, res) => {
  try {
    const db = getInstance().db;
    const { q, subject_id, type, difficulty } = req.query;
    const remote = await searchService.searchQuestions(q, { subject_id, type, difficulty });
    if (remote) return res.json({ success: true, engine: 'opensearch', result: remote });

    const keyword = `%${q || ''}%`;
    const rows = db.prepare(
      `SELECT q.*, qc.stem, qc.answer, qc.explanation, qc.options_json
       FROM questions q
       JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
       WHERE q.deleted = 0
         AND (? = '%%' OR qc.stem LIKE ? OR qc.answer LIKE ? OR qc.explanation LIKE ?)
       ORDER BY q.updated_at DESC
       LIMIT 50`
    ).all(keyword, keyword, keyword, keyword);
    res.json({ success: true, engine: 'sqlite', result: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/imports/check', (req, res) => {
  try {
    const db = getInstance().db;
    const result = questionBank.createImportBatch(db, req.body, req.body.tenant_id || 'default');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/rollups/refresh', async (_req, res) => {
  try {
    const db = getInstance().db;
    const rows = await questionBank.refreshKnowledgeRollups(db);
    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/rollups', async (_req, res) => {
  try {
    const cached = await cache.get('knowledge_point_rollups');
    if (cached) return res.json({ success: true, source: 'cache', data: cached });
    const db = getInstance().db;
    const rows = db.prepare('SELECT * FROM knowledge_point_rollups').all();
    await cache.set('knowledge_point_rollups', rows, 600);
    res.json({ success: true, source: 'db', data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/events/publish-pending', async (_req, res) => {
  try {
    const db = getInstance().db;
    const events = eventBus.listPending(db, 100);
    for (const event of events) {
      if (event.topic === 'question.changed') {
        const question = db.prepare(
          `SELECT q.*, qc.stem, qc.answer, qc.explanation
           FROM questions q LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
           WHERE q.id = ?`
        ).get(event.aggregate_id);
        if (question) await searchService.indexQuestion(question);
      }
      eventBus.markPublished(db, event.id);
    }
    res.json({ success: true, published: events.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
