const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml = require('sanitize-html');
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

const ALLOWED_HTML_TAGS = new Set([
  'br', 'span', 'div', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
  'sub', 'sup', 'i', 'b', 'strong', 'em', 'mark', 'img',
]);

const SAFE_STYLE_VALUE = [/^(?!.*(?:expression\s*\(|javascript\s*:|url\s*\())[^{};]*$/i];
const SAFE_STYLE_PROPERTIES = [
  'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
  'display', 'vertical-align', 'text-align', 'margin', 'margin-left', 'margin-right',
  'margin-top', 'margin-bottom', 'padding', 'padding-left', 'padding-right',
  'padding-top', 'padding-bottom', 'border', 'border-collapse', 'border-spacing',
  'font-style', 'font-weight', 'font-size', 'line-height', 'color',
  'background', 'background-color', 'white-space',
];

const SANITIZE_HTML_OPTIONS = {
  allowedTags: Array.from(ALLOWED_HTML_TAGS),
  allowedAttributes: {
    '*': ['class', 'style', 'aria-hidden'],
    span: ['class', 'style', 'data-inline-options', 'data-latex', 'aria-hidden'],
    img: ['class', 'style', 'src', 'alt', 'width', 'height'],
    table: ['class', 'style'],
    tbody: ['class', 'style'],
    thead: ['class', 'style'],
    tr: ['class', 'style'],
    td: ['class', 'style', 'colspan', 'rowspan'],
    th: ['class', 'style', 'colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'data', 'blob', 'question-asset'],
  allowedSchemesAppliedToAttributes: ['src'],
  allowProtocolRelative: false,
  parseStyleAttributes: true,
  allowedStyles: {
    '*': Object.fromEntries(SAFE_STYLE_PROPERTIES.map(property => [property, SAFE_STYLE_VALUE])),
  },
};

function sanitizeHtmlContent(value) {
  return sanitizeHtml(String(value || ''), SANITIZE_HTML_OPTIONS);
}

function sanitizeOptionContent(option) {
  if (typeof option === 'string') return sanitizeHtmlContent(option.trim());
  if (!option) return '';
  return {
    ...option,
    label: option.label || '',
    content: sanitizeHtmlContent(option.content || option.text || ''),
    text: option.text !== undefined ? sanitizeHtmlContent(option.text || '') : option.text,
    is_correct: !!option.is_correct,
  };
}

function normalizeKnowledgePointIds(payload = {}) {
  const ids = payload.knowledge_point_ids || payload.knowledge_ids || [];
  if (Array.isArray(ids)) return ids.filter(Boolean);
  if (typeof ids === 'string') return ids.split(',').map(id => id.trim()).filter(Boolean);
  return [];
}

function normalizeKnowledgePointNames(payload = {}) {
  const names = payload.knowledge_points || payload.knowledge_point_names || [];
  const values = Array.isArray(names) ? names : typeof names === 'string' ? names.split(',') : [];
  if (payload.knowledge_point) values.push(payload.knowledge_point);
  return [...new Set(values.map(name => String(name || '').trim()).filter(Boolean))];
}

function normalizeModelPointIds(payload = {}) {
  const ids = payload.model_point_ids || payload.model_ids || [];
  if (Array.isArray(ids)) return ids.filter(Boolean);
  if (typeof ids === 'string') return ids.split(',').map(id => id.trim()).filter(Boolean);
  return [];
}

function normalizeModelPointNames(payload = {}) {
  const names = payload.model_points || payload.model_point_names || [];
  const values = Array.isArray(names) ? names : typeof names === 'string' ? names.split(',') : [];
  if (payload.model_point) values.push(payload.model_point);
  return [...new Set(values.map(name => String(name || '').trim()).filter(Boolean))];
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
  const inlineData = asset.data_url || asset.dataUrl || asset.data || null;
  if (!ref?.oss_key && !inlineData) throw new Error('question asset oss_key is required');
  return {
    asset_type: asset.asset_type || asset.assetType || asset.type || fallbackType,
    file_name: asset.file_name || asset.fileName || asset.name || null,
    mime_type: asset.mime_type || asset.mimeType || null,
    size_bytes: Number(asset.size_bytes ?? asset.sizeBytes ?? asset.size ?? 0) || 0,
    oss_key: ref?.oss_key || `inline://${asset.file_name || asset.fileName || asset.name || uuidv4()}`,
    oss_url: ref?.oss_url || inlineData,
    content_hash: asset.content_hash || asset.contentHash || null,
  };
}

function normalizeQuestionAssets(payload = {}) {
  const assets = [];
  for (const asset of payload.assets || []) {
    assets.push(normalizeAsset(asset));
  }

  for (const formula of payload.formulas || []) {
    if (formula && typeof formula === 'object') {
      const format = formula.format || 'formula';
      const raw = JSON.stringify(formula);
      assets.push(normalizeAsset({
        asset_type: `formula_${format}`,
        file_name: `${format}-${hashText(raw).slice(0, 12)}.json`,
        mime_type: 'application/json',
        size_bytes: Buffer.byteLength(raw, 'utf8'),
        data_url: `data:application/json;base64,${Buffer.from(raw, 'utf8').toString('base64')}`,
        content_hash: hashText(raw),
      }, `formula_${format}`));
    }
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

const QUESTION_STATUSES = new Set(['draft', 'pending', 'published', 'offline', 'deprecated']);

function normalizeQuestionStatus(value) {
  return QUESTION_STATUSES.has(value) ? value : 'draft';
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.toLowerCase());
  return Boolean(value);
}

function questionTextParts(payload = {}) {
  const options = normalizeOptions(payload.options || payload.options_json);
  return [
    payload.stem,
    payload.content,
    payload.answer,
    payload.explanation,
    payload.analysis,
    ...(Array.isArray(options) ? options : []),
    ...(Array.isArray(payload.formulas) ? payload.formulas : []),
  ].map(value => String(value || ''));
}

function detectHasFormula(payload = {}) {
  if (payload.has_formula !== undefined) return boolValue(payload.has_formula);
  return questionTextParts(payload).some(text =>
    /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|<math\b|data-formula|formula/i.test(text)
  );
}

function detectHasImage(payload = {}, assets = normalizeQuestionAssets(payload)) {
  if (payload.has_image !== undefined) return boolValue(payload.has_image);
  if (assets.length > 0) return true;
  return questionTextParts(payload).some(text =>
    /<img\b|!\[[^\]]*\]\([^)]+\)|\.(png|jpe?g|gif|webp|svg)(\?|#|\s|$)/i.test(text)
  );
}

function normalizeOptions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(option => {
      return sanitizeOptionContent(option);
    }).filter(Boolean);
  }
  return parseJsonArray(value).map(sanitizeOptionContent).filter(Boolean);
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
    subject: item.subject || defaults.subject || '物理',
    subject_id: item.subject_id || defaults.subject_id || null,
    chapter_id: item.chapter_id || defaults.chapter_id || null,
    type,
    difficulty: Number(item.difficulty || defaults.difficulty || 3),
    stem: sanitizeHtmlContent(String(item.stem || item.content || '').trim()),
    answer: item.answer !== undefined ? sanitizeHtmlContent(String(item.answer || '').trim()) : '',
    explanation: sanitizeHtmlContent(item.explanation !== undefined ? item.explanation : item.analysis),
    options: normalizeOptions(item.options),
    source: item.source || defaults.source || null,
    year: item.year || defaults.year || '',
    grade: item.grade || defaults.grade || '',
    semester: item.semester || defaults.semester || '',
    exam_type: item.exam_type || defaults.exam_type || '其他',
    region: item.region || defaults.region || '',
    school: item.school || defaults.school || '',
    edit_status: item.edit_status || defaults.edit_status || '未编辑',
    status: normalizeQuestionStatus(item.status || defaults.status),
    has_image: boolValue(item.has_image, false),
    has_formula: boolValue(item.has_formula, false),
    created_by: item.created_by || defaults.created_by || '',
    knowledge_point_ids: normalizeKnowledgePointIds(item).length > 0
      ? normalizeKnowledgePointIds(item)
      : normalizeKnowledgePointIds(defaults),
    model_point_ids: normalizeModelPointIds(item).length > 0
      ? normalizeModelPointIds(item)
      : normalizeModelPointIds(defaults),
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

function exactStemForDuplicate(item) {
  return String(item.stem || item.content || '').trim();
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

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function importItemUiStatus(row) {
  if (row.status === 'imported') return 'imported';
  if (row.status === 'duplicate') return 'warning';
  if (row.status === 'rejected' || row.status === 'failed') return 'failed';
  const warnings = parseJsonArray(row.warnings);
  return warnings.length > 0 ? 'warning' : 'success';
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

  resolveKnowledgePointIds(db, payload = {}, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ids = normalizeKnowledgePointIds(payload);
    const names = normalizeKnowledgePointNames(payload);
    const ts = now();
    for (const name of names) {
      let row = db.prepare(
        'SELECT id FROM knowledge_points WHERE tenant_id = ? AND name = ? AND deleted = 0 ORDER BY created_at ASC LIMIT 1'
      ).get(tenantId, name);
      if (!row) {
        row = { id: `kp_${hashText(`${tenantId}:${name}`).slice(0, 24)}` };
        db.prepare(
          `INSERT INTO knowledge_points
           (id, tenant_id, chapter_id, parent_id, name, description, sort_order, deleted, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, ?, NULL, 0, 0, ?, ?)`
        ).run(row.id, tenantId, name, ts, ts);
      }
      ids.push(row.id);
    }
    return [...new Set(ids.filter(Boolean))];
  }

  resolveModelPointIds(db, payload = {}, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ids = normalizeModelPointIds(payload);
    const names = normalizeModelPointNames(payload);
    const ts = now();
    for (const name of names) {
      let row = db.prepare(
        'SELECT id FROM model_points WHERE tenant_id = ? AND name = ? AND deleted = 0 ORDER BY created_at ASC LIMIT 1'
      ).get(tenantId, name);
      if (!row) {
        row = { id: `mp_${hashText(`${tenantId}:${name}`).slice(0, 24)}` };
        db.prepare(
          `INSERT INTO model_points
           (id, tenant_id, parent_id, name, description, sort_order, deleted, created_at, updated_at)
           VALUES (?, ?, NULL, ?, NULL, 0, 0, ?, ?)`
        ).run(row.id, tenantId, name, ts, ts);
      }
      ids.push(row.id);
    }
    return [...new Set(ids.filter(Boolean))];
  }

  createQuestion(db, payload, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const questionId = payload.id || uuidv4();
    const contentId = uuidv4();
    const stem = sanitizeHtmlContent(payload.stem || payload.content || '');
    const answer = sanitizeHtmlContent(payload.answer || '');
    const explanation = sanitizeHtmlContent(payload.explanation !== undefined ? payload.explanation : payload.analysis);
    const options = normalizeOptions(payload.options || payload.options_json);
    const knowledgePointIds = payload.allow_tag_name_create === false
      ? normalizeKnowledgePointIds(payload)
      : this.resolveKnowledgePointIds(db, payload, tenantId);
    const modelPointIds = payload.allow_tag_name_create === false
      ? normalizeModelPointIds(payload)
      : this.resolveModelPointIds(db, payload, tenantId);
    const contentHash = payload.content_hash || hashText([stem, answer, explanation, JSON.stringify(options)].join('|'));
    const contentRef = normalizeOssRef(payload);
    const assets = normalizeQuestionAssets(payload);
    const hasImage = detectHasImage(payload, assets);
    const hasFormula = detectHasFormula(payload);

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO questions
         (id, tenant_id, subject, subject_id, chapter_id, type, difficulty, source, year, grade, semester, exam_type, region, school, edit_status, status, has_image, has_formula, created_by, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        questionId,
        tenantId,
        payload.subject || '物理',
        payload.subject_id || null,
        payload.chapter_id || null,
        payload.type,
        payload.difficulty || 3,
        payload.source || null,
        payload.year || '',
        payload.grade || '',
        payload.semester || '',
        payload.exam_type || '其他',
        payload.region || '',
        payload.school || '',
        payload.edit_status || '未编辑',
        normalizeQuestionStatus(payload.status),
        hasImage ? 1 : 0,
        hasFormula ? 1 : 0,
        payload.created_by || '',
        ts,
        ts
      );

      db.prepare(
        `INSERT INTO question_contents
         (id, tenant_id, question_id, stem, answer, explanation, options_json, content_hash, version, oss_key, oss_url, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)`
      ).run(contentId, tenantId, questionId, stem, answer || null, explanation || null, JSON.stringify(options), contentHash, contentRef?.oss_key || null, contentRef?.oss_url || null, ts, ts);

      for (const knowledgePointId of knowledgePointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, knowledgePointId, 1, ts, ts);
      }

      for (const modelPointId of modelPointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_model_points (question_id, model_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(questionId, modelPointId, 1, ts, ts);
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
    return this.getQuestion(db, questionId, tenantId) || {
      id: questionId,
      content_hash: contentHash,
      status: normalizeQuestionStatus(payload.status),
      has_image: hasImage,
      has_formula: hasFormula,
      created_by: payload.created_by || '',
    };
  }

  _mapQuestion(row, assets = []) {
    if (!row) return null;
    const knowledgeIds = row.knowledge_point_ids ? String(row.knowledge_point_ids).split(',').filter(Boolean) : [];
    const modelIds = row.model_point_ids ? String(row.model_point_ids).split(',').filter(Boolean) : [];
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
      model_point_ids: modelIds,
      model_ids: modelIds,
      status: normalizeQuestionStatus(row.status),
      has_image: boolValue(row.has_image, false),
      has_formula: boolValue(row.has_formula, false),
      created_by: row.created_by || '',
      deleted_at: row.deleted_at || null,
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
                   GROUP_CONCAT(DISTINCT qkp.knowledge_point_id) AS knowledge_point_ids,
                   GROUP_CONCAT(DISTINCT qmp.model_point_id) AS model_point_ids
            FROM questions q
            LEFT JOIN question_contents qc ON qc.question_id = q.id AND qc.deleted = 0
            LEFT JOIN question_knowledge_points qkp ON qkp.question_id = q.id
            LEFT JOIN question_model_points qmp ON qmp.question_id = q.id
            ${whereSql}
            GROUP BY q.id
            ORDER BY q.created_at DESC, q.updated_at DESC`;
  }

  _getAssets(db, questionId) {
    return db.prepare(
      'SELECT * FROM question_assets WHERE question_id = ? AND deleted = 0 ORDER BY created_at ASC'
    ).all(questionId);
  }

  purgeExpiredDeletedQuestions(db, tenantId = 'default', retentionDays = 7) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      'SELECT id FROM questions WHERE deleted = 1 AND tenant_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?'
    ).all(tenantId, cutoff);
    if (rows.length === 0) return 0;
    const ts = now();
    const transaction = db.transaction(() => {
      for (const row of rows) {
        db.prepare('UPDATE question_contents SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, row.id);
        db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, row.id);
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(row.id);
        db.prepare('DELETE FROM question_model_points WHERE question_id = ?').run(row.id);
      }
    });
    transaction();
    return rows.length;
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
    if (filters.status) {
      where.push('q.status = ?');
      params.push(normalizeQuestionStatus(filters.status));
    }
    if (filters.has_image !== undefined) {
      where.push('q.has_image = ?');
      params.push(boolValue(filters.has_image) ? 1 : 0);
    }
    if (filters.has_formula !== undefined) {
      where.push('q.has_formula = ?');
      params.push(boolValue(filters.has_formula) ? 1 : 0);
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
    const stem = sanitizeHtmlContent(payload.stem !== undefined ? payload.stem : (payload.content !== undefined ? payload.content : existing.stem));
    const answer = sanitizeHtmlContent(payload.answer !== undefined ? payload.answer : existing.answer);
    const explanation = sanitizeHtmlContent(payload.explanation !== undefined ? payload.explanation : (payload.analysis !== undefined ? payload.analysis : existing.explanation));
    const options = payload.options !== undefined || payload.options_json !== undefined
      ? normalizeOptions(payload.options !== undefined ? payload.options : payload.options_json)
      : existing.options;
    const contentHash = payload.content_hash || hashText([stem, answer, explanation, JSON.stringify(options)].join('|'));
    const contentRef = normalizeOssRef(payload) || {
      oss_key: existing.content_oss_key || existing.oss_key || null,
      oss_url: existing.content_oss_url || existing.oss_url || null,
    };
    const replacingAssets = payload.assets !== undefined || payload.cover !== undefined || payload.cover_image !== undefined || payload.title_image !== undefined || payload.attachments !== undefined;
    const nextAssets = replacingAssets ? normalizeQuestionAssets(payload) : existing.assets || [];
    const mergedForDetection = { ...existing, ...payload, stem, content: stem, answer, explanation, options };
    const hasImage = payload.has_image !== undefined ? boolValue(payload.has_image) : detectHasImage(mergedForDetection, nextAssets);
    const hasFormula = payload.has_formula !== undefined ? boolValue(payload.has_formula) : detectHasFormula(mergedForDetection);

    const transaction = db.transaction(() => {
      const questionUpdates = {};
      for (const key of ['subject', 'subject_id', 'chapter_id', 'type', 'difficulty', 'source', 'year', 'grade', 'semester', 'exam_type', 'region', 'school', 'edit_status', 'created_by']) {
        if (payload[key] !== undefined) questionUpdates[key] = payload[key];
      }
      if (payload.status !== undefined) questionUpdates.status = normalizeQuestionStatus(payload.status);
      questionUpdates.has_image = hasImage ? 1 : 0;
      questionUpdates.has_formula = hasFormula ? 1 : 0;
      if (payload.exam_type === '') questionUpdates.exam_type = '其他';
      if (payload.subject === '') questionUpdates.subject = '物理';
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

      if (payload.knowledge_point_ids !== undefined || payload.knowledge_ids !== undefined || payload.knowledge_points !== undefined || payload.knowledge_point_names !== undefined || payload.knowledge_point !== undefined) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
        for (const knowledgePointId of this.resolveKnowledgePointIds(db, payload, tenantId)) {
          db.prepare(
            `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, knowledgePointId, 1, ts, ts);
        }
      }

      if (payload.model_point_ids !== undefined || payload.model_ids !== undefined || payload.model_points !== undefined || payload.model_point_names !== undefined || payload.model_point !== undefined) {
        db.prepare('DELETE FROM question_model_points WHERE question_id = ?').run(id);
        for (const modelPointId of this.resolveModelPointIds(db, payload, tenantId)) {
          db.prepare(
            `INSERT OR REPLACE INTO question_model_points (question_id, model_point_id, weight, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(id, modelPointId, 1, ts, ts);
        }
      }

      if (replacingAssets) {
        db.prepare('UPDATE question_assets SET deleted = 1, updated_at = ? WHERE question_id = ? AND deleted = 0').run(ts, id);
        for (const asset of nextAssets) {
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
      db.prepare('UPDATE questions SET deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND deleted = 0').run(ts, ts, id);
      this.enqueueSearchJob(db, id, 'delete', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'trash', deleted_at: ts }, tenantId);
    });
    transaction();
    return true;
  }

  listDeletedQuestions(db, tenantId = 'default') {
    this.purgeExpiredDeletedQuestions(db, tenantId);
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      this._questionSelectSql('WHERE q.deleted = 1 AND q.tenant_id = ? AND q.deleted_at >= ?')
    ).all(tenantId, cutoff);
    return rows.map(row => this._mapQuestion(row, this._getAssets(db, row.id)));
  }

  restoreQuestion(db, id, tenantId = 'default') {
    const row = db.prepare('SELECT id FROM questions WHERE id = ? AND tenant_id = ? AND deleted = 1').get(id, tenantId);
    if (!row) return null;
    const ts = now();
    db.prepare('UPDATE questions SET deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?').run(ts, id, tenantId);
    this.enqueueSearchJob(db, id, 'upsert', tenantId);
    eventBus.publish(db, 'question.changed', 'question', id, { action: 'restore' }, tenantId);
    return this.getQuestion(db, id, tenantId);
  }

  listQuestionKnowledgePoints(db, id, tenantId = 'default') {
    const question = this.getQuestion(db, id, tenantId);
    if (!question) return null;
    return db.prepare(
      `SELECT qkp.question_id,
              qkp.knowledge_point_id,
              qkp.weight,
              qkp.created_at,
              qkp.updated_at,
              kp.name,
              kp.parent_id,
              kp.description
       FROM question_knowledge_points qkp
       LEFT JOIN knowledge_points kp ON kp.id = qkp.knowledge_point_id AND kp.deleted = 0
       WHERE qkp.question_id = ?
       ORDER BY qkp.created_at ASC`
    ).all(id);
  }

  _validateKnowledgePoints(db, knowledgePointIds, tenantId = 'default') {
    const uniqueIds = [...new Set((knowledgePointIds || []).filter(Boolean))];
    const missing = [];
    for (const knowledgePointId of uniqueIds) {
      const row = db.prepare(
        'SELECT id FROM knowledge_points WHERE id = ? AND tenant_id = ? AND deleted = 0'
      ).get(knowledgePointId, tenantId);
      if (!row) missing.push(knowledgePointId);
    }
    if (missing.length > 0) {
      throw new Error(`knowledge point not found: ${missing.join(',')}`);
    }
    return uniqueIds;
  }

  setQuestionKnowledgePoints(db, id, payload = {}, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;
    const ts = now();
    const knowledgePointIds = this._validateKnowledgePoints(db, normalizeKnowledgePointIds(payload), tenantId);
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ?').run(id);
      for (const knowledgePointId of knowledgePointIds) {
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(id, knowledgePointId, 1, ts, ts);
      }
      db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'knowledge_update', knowledge_point_ids: knowledgePointIds }, tenantId);
    });
    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  addQuestionKnowledgePoints(db, id, payload = {}, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;
    const current = new Set(existing.knowledge_point_ids || []);
    const additions = this._validateKnowledgePoints(db, normalizeKnowledgePointIds(payload), tenantId);
    if (additions.length === 0) return existing;
    const ts = now();
    const transaction = db.transaction(() => {
      for (const knowledgePointId of additions) {
        if (current.has(knowledgePointId)) continue;
        db.prepare(
          `INSERT OR REPLACE INTO question_knowledge_points (question_id, knowledge_point_id, weight, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(id, knowledgePointId, 1, ts, ts);
      }
      db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'knowledge_add', knowledge_point_ids: additions }, tenantId);
    });
    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  removeQuestionKnowledgePoints(db, id, payload = {}, tenantId = 'default') {
    const existing = this.getQuestion(db, id, tenantId);
    if (!existing) return null;
    const removalIds = [...new Set(normalizeKnowledgePointIds(payload).filter(Boolean))];
    if (removalIds.length === 0) return existing;
    const ts = now();
    const transaction = db.transaction(() => {
      for (const knowledgePointId of removalIds) {
        db.prepare('DELETE FROM question_knowledge_points WHERE question_id = ? AND knowledge_point_id = ?').run(id, knowledgePointId);
      }
      db.prepare('UPDATE questions SET updated_at = ? WHERE id = ? AND deleted = 0').run(ts, id);
      this.enqueueSearchJob(db, id, 'upsert', tenantId);
      eventBus.publish(db, 'question.changed', 'question', id, { action: 'knowledge_remove', knowledge_point_ids: removalIds }, tenantId);
    });
    transaction();
    return this.getQuestion(db, id, tenantId);
  }

  replaceQuestionKnowledgePoint(db, id, payload = {}, tenantId = 'default') {
    return this.setQuestionKnowledgePoints(db, id, payload, tenantId);
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
      task_id: row.batch_id,
      status: importItemUiStatus(row),
      warnings: parseJsonArray(row.warnings),
      errors: parseJsonArray(row.errors),
      payload: parseJsonObject(row.payload),
    }));
    return {
      ...batch,
      task_id: batch.id,
      success_items: Number(batch.accepted_items || 0),
      warning_items: Number(batch.warning_items || 0),
      failed_items: Number(batch.failed_items || batch.rejected_items || 0),
      quality_report: parseJsonObject(batch.quality_report),
      result_summary: parseJsonObject(batch.result_summary),
      items,
    };
  }

  listImportBatches(db, filters = {}, tenantId = 'default') {
    const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
    return db.prepare(
      `SELECT * FROM import_batches
       WHERE tenant_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    ).all(tenantId, limit).map(row => ({
      ...row,
      task_id: row.id,
      success_items: Number(row.accepted_items || 0),
      warning_items: Number(row.warning_items || 0),
      failed_items: Number(row.failed_items || row.rejected_items || 0),
      quality_report: parseJsonObject(row.quality_report),
      result_summary: parseJsonObject(row.result_summary),
    }));
  }

  listImportTasks(db, filters = {}, tenantId = 'default') {
    return this.listImportBatches(db, filters, tenantId);
  }

  getImportTask(db, taskId, tenantId = 'default') {
    return this.getImportBatch(db, taskId, tenantId);
  }

  createImportTask(db, payload, tenantId = 'default') {
    return this.createImportBatch(db, payload, tenantId);
  }

  createImportBatch(db, payload, tenantId = 'default') {
    this.ensureTenant(db, tenantId);
    const ts = now();
    const batchId = uuidv4();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const seen = new Set();
    const seenExactStems = new Set();
    let duplicateItems = 0;
    let rejectedItems = 0;
    let acceptedItems = 0;
    let warningItems = 0;
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
        const exactStem = exactStemForDuplicate(normalized);
        const quality = validateImportItem(normalized);
        const valid = quality.errors.length === 0;
        const inBatchDuplicate = valid && seen.has(contentHash);
        const inBatchExactDuplicate = valid && exactStem && seenExactStems.has(exactStem);
        const existingDuplicate = valid && !!db.prepare(
          'SELECT 1 FROM question_contents WHERE content_hash = ? AND deleted = 0'
        ).get(contentHash);
        const existingExactDuplicate = valid && exactStem && !!db.prepare(
          'SELECT 1 FROM question_contents WHERE TRIM(stem) = ? AND deleted = 0'
        ).get(exactStem);
        const duplicate = inBatchDuplicate || inBatchExactDuplicate || existingDuplicate || existingExactDuplicate;
        const status = !valid ? 'rejected' : duplicate ? 'duplicate' : 'accepted';
        if (!valid) {
          rejectedItems++;
        } else if (duplicate) {
          duplicateItems++;
          if (inBatchDuplicate || inBatchExactDuplicate) duplicateSources.in_batch++;
          if (existingDuplicate || existingExactDuplicate) duplicateSources.existing_bank++;
        } else {
          acceptedItems++;
        }
        if (quality.warnings.length > 0 || duplicate) warningItems++;
        if (valid) {
          seen.add(contentHash);
          if (exactStem) seenExactStems.add(exactStem);
        }
        const bucket = quality.score >= 0.8 ? 'high' : quality.score >= 0.5 ? 'medium' : 'low';
        qualityBuckets[bucket]++;
        for (const code of quality.errors) errors[code] = (errors[code] || 0) + 1;
        for (const code of quality.warnings) warnings[code] = (warnings[code] || 0) + 1;
        db.prepare(
          `INSERT INTO import_items
           (id, batch_id, item_index, content_hash, status, quality_score, warnings, errors, error_message, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(),
          batchId,
          index,
          contentHash,
          status,
          quality.score,
          JSON.stringify(duplicate ? [...quality.warnings, 'duplicate'] : quality.warnings),
          JSON.stringify(quality.errors),
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
        warning_items: warningItems,
        duplicate_items: duplicateItems,
        rejected_items: rejectedItems,
        failed_items: rejectedItems,
        duplicate_sources: duplicateSources,
        quality_buckets: qualityBuckets,
        errors,
        warnings,
      };
      db.prepare(
        `UPDATE import_batches
         SET status = 'checked', accepted_items = ?, warning_items = ?, failed_items = ?, duplicate_items = ?, rejected_items = ?, quality_report = ?, updated_at = ?
         WHERE id = ?`
      ).run(acceptedItems, warningItems, rejectedItems, duplicateItems, rejectedItems, JSON.stringify(qualityReport), ts, batchId);
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
    const accepted = db.prepare(
      'SELECT * FROM import_items WHERE batch_id = ? AND status = ? ORDER BY item_index ASC'
    ).all(batchId, 'accepted').map(row => ({
      ...row,
      warnings: parseJsonArray(row.warnings),
      errors: parseJsonArray(row.errors),
      payload: parseJsonObject(row.payload),
    }));
    const result = { imported_items: 0, failed_items: 0, question_ids: [], errors: [] };

    const transaction = db.transaction(() => {
      db.prepare('UPDATE import_batches SET status = ?, updated_at = ? WHERE id = ?').run('importing', ts, batchId);
      for (const item of accepted) {
        try {
          const payload = item.payload || {};
          const created = this.createQuestion(db, { ...payload, content_hash: item.content_hash }, tenantId);
          db.prepare('UPDATE import_items SET status = ?, question_id = ?, updated_at = ? WHERE id = ?').run('imported', created.id, now(), item.id);
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
      db.prepare('UPDATE import_batches SET status = ?, failed_items = ?, result_summary = ?, updated_at = ? WHERE id = ?')
        .run(finalStatus, result.failed_items, JSON.stringify(result), now(), batchId);
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
