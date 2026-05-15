const { Router } = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const { getInstance } = require('../database');
const questionBank = require('../services/questionBankService');
const searchService = require('../services/searchService');
const eventBus = require('../services/eventBus');
const cache = require('../services/cacheService');

const router = Router();
const dataDir = process.env.GEWU_DATA_DIR || process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir();
const uploadDir = process.env.QUESTION_BANK_UPLOAD_DIR || path.join(dataDir, 'gewu-gongfang', 'uploads', 'question-bank');
const parserScript = path.join(__dirname, '..', '..', '..', 'modules', 'question-bank', 'parsers', 'parse_word.py');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: Number(process.env.QUESTION_WORD_MAX_BYTES || 120 * 1024 * 1024) },
});

function errorStatus(err) {
  return /oss_key is required|knowledge point not found/.test(err.message) ? 400 : 500;
}

function tenantId(req) {
  return req.tenantId || req.query.tenant_id || req.query.tenantId || req.body?.tenant_id || req.body?.tenantId || 'default';
}

function pythonCommand() {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

function decodeUploadName(value = '') {
  if (!value) return '';
  const utf8 = Buffer.from(value, 'latin1').toString('utf8');
  return utf8.includes('�') ? value : utf8;
}

function applyImportMeta(result, body = {}) {
  const meta = {
    year: body.year || '',
    exam_type: body.exam_type || '',
    grade: body.grade || '',
    semester: body.semester || '',
    region: body.region || '',
    school: body.school || '',
    paper_name: body.paper_name || body.paperName || '',
  };
  const sourceParts = [meta.region, meta.school, meta.paper_name].filter(Boolean);
  const questions = Array.isArray(result.questions) ? result.questions : [];
  for (const question of questions) {
    for (const [key, value] of Object.entries(meta)) {
      if (value && !question[key]) question[key] = value;
    }
    if (sourceParts.length > 0 && !question.source) question.source = sourceParts.join(' / ');
    const tags = new Set(Array.isArray(question.tags) ? question.tags : []);
    for (const value of Object.values(meta)) {
      if (value) tags.add(String(value));
    }
    question.tags = [...tags];
  }
  return { ...result, questions, import_meta: meta };
}

function deriveTopicFromFileName(fileName = '') {
  const base = path.basename(fileName, path.extname(fileName));
  const patterns = [
    /专题\d+[-：:](.+)$/,
    /实验专题\d+[-：:](.+)$/,
    /解答题专题\d+[-：:](.+)$/,
  ];
  for (const pattern of patterns) {
    const match = base.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function applyFileTopic(result, fileName = '', sourceType = 'lecture') {
  if (sourceType !== 'lecture') return result;
  const topic = deriveTopicFromFileName(fileName);
  if (!topic) return result;
  const questions = Array.isArray(result.questions) ? result.questions : [];
  for (const question of questions) {
    const points = new Set(Array.isArray(question.knowledge_points) ? question.knowledge_points : []);
    if (points.size === 0) {
      points.add(topic);
      question.knowledge_point = question.knowledge_point || topic;
    }
    question.knowledge_points = [...points];
  }
  const topics = new Set(Array.isArray(result.topics) ? result.topics : []);
  topics.add(topic);
  return { ...result, questions, topics: [...topics], knowledge_points: [...new Set([...(result.knowledge_points || []), topic])] };
}

router.post('/parse-word', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: '未上传 Word 文件' });

  const sourceType = req.body?.source_type || 'lecture';
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!['.doc', '.docx'].includes(ext)) {
    try { fs.unlinkSync(file.path); } catch (_err) {}
    return res.status(400).json({ success: false, error: '仅支持 .doc / .docx 格式' });
  }

  const originalName = path.basename(decodeUploadName(file.originalname || ''));
  const parsePath = originalName && /\.docx?$/i.test(originalName)
    ? path.join(path.dirname(file.path), originalName)
    : file.path;
  if (parsePath !== file.path) {
    try { fs.copyFileSync(file.path, parsePath); } catch (_err) {}
  }

  const proc = spawn(pythonCommand(), [parserScript, fs.existsSync(parsePath) ? parsePath : file.path, sourceType], {
    windowsHide: true,
    timeout: Number(process.env.QUESTION_WORD_PARSE_TIMEOUT_MS || 180000),
  });
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', data => { stdout += data.toString('utf8'); });
  proc.stderr.on('data', data => { stderr += data.toString('utf8'); });
  proc.on('error', err => {
    try { fs.unlinkSync(file.path); } catch (_cleanupErr) {}
    if (parsePath !== file.path) { try { fs.unlinkSync(parsePath); } catch (_cleanupErr) {} }
    res.status(500).json({ success: false, error: `Python 解析进程启动失败: ${err.message}` });
  });
  proc.on('close', code => {
    try { fs.unlinkSync(file.path); } catch (_cleanupErr) {}
    if (parsePath !== file.path) { try { fs.unlinkSync(parsePath); } catch (_cleanupErr) {} }
    if (code !== 0) {
      return res.status(500).json({ success: false, error: 'Word 解析失败', detail: stderr.slice(0, 1000) });
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
      const withTopic = applyFileTopic({ success: true, ...parsed }, originalName, sourceType);
      return res.json(applyImportMeta(withTopic, req.body || {}));
    } catch (err) {
      return res.status(500).json({ success: false, error: '解析结果格式错误', detail: stdout.slice(0, 1000) });
    }
  });
});

router.get('/questions', (req, res) => {
  try {
    const db = getInstance().db;
    const rows = questionBank.listQuestions(db, req.query, tenantId(req));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/questions/search', async (req, res) => {
  try {
    const db = getInstance().db;
    const { q, subject_id, type, difficulty } = req.query;
    try {
      const remote = await searchService.searchQuestions(q, { subject_id, type, difficulty });
      if (remote) return res.json({ success: true, engine: 'opensearch', result: remote });
    } catch (err) {
      console.warn(`[QuestionBank] OpenSearch search fallback: ${err.message}`);
    }

    const rows = questionBank.searchQuestionsFallback(db, req.query, tenantId(req));
    res.json({ success: true, engine: 'sqlite', result: rows });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/questions/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const row = questionBank.getQuestion(db, req.params.id, tenantId(req));
    if (!row) return res.status(404).json({ success: false, error: 'question not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/questions', (req, res) => {
  try {
    const db = getInstance().db;
    const tId = tenantId(req);
    const result = questionBank.createQuestion(db, req.body, tId);
    const embedding = searchService.upsertQuestionEmbedding(db, result.id, { tenantId: tId });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, ...result, embedding });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.put('/questions/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const tId = tenantId(req);
    const result = questionBank.updateQuestion(db, req.params.id, req.body, tId);
    if (!result) return res.status(404).json({ success: false, error: 'question not found' });
    const embedding = searchService.upsertQuestionEmbedding(db, req.params.id, { tenantId: tId });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, data: result, embedding });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.delete('/questions/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const deleted = questionBank.deleteQuestion(db, req.params.id, tenantId(req));
    if (!deleted) return res.status(404).json({ success: false, error: 'question not found' });
    searchService.schedulePendingJobs(db);
    res.json({ success: true });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/questions/:id/knowledge-points', (req, res) => {
  try {
    const db = getInstance().db;
    const rows = questionBank.listQuestionKnowledgePoints(db, req.params.id, tenantId(req));
    if (!rows) return res.status(404).json({ success: false, error: 'question not found' });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.put('/questions/:id/knowledge-points', (req, res) => {
  try {
    const dbService = getInstance();
    const db = dbService.db;
    const tId = tenantId(req);
    const result = questionBank.setQuestionKnowledgePoints(db, req.params.id, req.body || {}, tId);
    if (!result) return res.status(404).json({ success: false, error: 'question not found' });
    dbService._auditOperation({
      tenant_id: tId,
      action: 'question_knowledge_replace',
      table_name: 'question_knowledge_points',
      record_id: req.params.id,
      status: 'success',
      detail: { knowledge_point_ids: req.body?.knowledge_point_ids || req.body?.knowledge_ids || [] },
    });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/questions/:id/knowledge-points', (req, res) => {
  try {
    const dbService = getInstance();
    const db = dbService.db;
    const tId = tenantId(req);
    const result = questionBank.addQuestionKnowledgePoints(db, req.params.id, req.body || {}, tId);
    if (!result) return res.status(404).json({ success: false, error: 'question not found' });
    dbService._auditOperation({
      tenant_id: tId,
      action: 'question_knowledge_add',
      table_name: 'question_knowledge_points',
      record_id: req.params.id,
      status: 'success',
      detail: { knowledge_point_ids: req.body?.knowledge_point_ids || req.body?.knowledge_ids || [] },
    });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.delete('/questions/:id/knowledge-points', (req, res) => {
  try {
    const dbService = getInstance();
    const db = dbService.db;
    const tId = tenantId(req);
    const payload = { ...(req.query || {}), ...(req.body || {}) };
    const result = questionBank.removeQuestionKnowledgePoints(db, req.params.id, payload, tId);
    if (!result) return res.status(404).json({ success: false, error: 'question not found' });
    dbService._auditOperation({
      tenant_id: tId,
      action: 'question_knowledge_remove',
      table_name: 'question_knowledge_points',
      record_id: req.params.id,
      status: 'success',
      detail: { knowledge_point_ids: payload.knowledge_point_ids || payload.knowledge_ids || [] },
    });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/vectors', (req, res) => {
  try {
    const db = getInstance().db;
    const result = searchService.upsertVector(db, { ...(req.body || {}), tenant_id: tenantId(req), tenantId: tenantId(req) });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/questions/similar', (req, res) => {
  try {
    const db = getInstance().db;
    const result = searchService.findSimilarQuestions(db, { ...(req.body || {}), tenant_id: tenantId(req), tenantId: tenantId(req) });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/imports/check', (req, res) => {
  try {
    const dbService = getInstance();
    const db = dbService.db;
    const tId = tenantId(req);
    const result = questionBank.createImportBatch(db, req.body, tId);
    dbService._auditOperation({
      tenant_id: tId,
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

router.get('/imports', (req, res) => {
  try {
    const db = getInstance().db;
    const rows = questionBank.listImportBatches(db, req.query, tenantId(req));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/imports/:id', (req, res) => {
  try {
    const db = getInstance().db;
    const row = questionBank.getImportBatch(db, req.params.id, tenantId(req));
    if (!row) return res.status(404).json({ success: false, error: 'import batch not found' });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/imports/:id/commit', (req, res) => {
  try {
    const dbService = getInstance();
    const db = dbService.db;
    const tId = tenantId(req);
    const result = questionBank.commitImportBatch(db, req.params.id, tId);
    if (!result) return res.status(404).json({ success: false, error: 'import batch not found' });
    dbService._auditOperation({
      tenant_id: tId,
      action: 'import_commit',
      table_name: 'import_batches',
      record_id: req.params.id,
      status: result.commit_result.failed_items > 0 ? 'partial' : 'success',
      detail: result.commit_result,
    });
    res.json({ success: true, data: result });
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
    const result = await eventBus.processPending(db, { limit: 100 });
    searchService.schedulePendingJobs(db);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.get('/events', (req, res) => {
  try {
    const db = getInstance().db;
    const events = eventBus.listEvents(db, req.query);
    res.json({ success: true, events });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

router.post('/events/:id/retry', (req, res) => {
  try {
    const db = getInstance().db;
    const retried = eventBus.retryFailed(db, req.params.id);
    if (!retried) return res.status(404).json({ success: false, error: 'failed event not found' });
    res.json({ success: true, id: req.params.id, status: 'pending' });
  } catch (err) {
    res.status(errorStatus(err)).json({ success: false, error: err.message });
  }
});

module.exports = router;
