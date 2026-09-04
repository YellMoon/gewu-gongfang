function toggleOrderedSelection(selected, questionId) {
  const id = String(questionId); const current = selected.map(String); const index = current.indexOf(id);
  return index >= 0 ? current.filter(item => item !== id) : [...current, id];
}
const PAPER_SCORE_ERROR = '\u5206\u503c\u9700\u57280\u81f31000\u4e4b\u95f4\uff0c\u6700\u591a\u4fdd\u7559\u4e00\u4f4d\u5c0f\u6570';
const PAPER_SECTION_REQUIRED_ERROR = '\u8bf7\u8f93\u5165\u5206\u7ec4\u540d\u79f0';
const PAPER_SECTION_LENGTH_ERROR = '\u5206\u7ec4\u540d\u79f0\u4e0d\u80fd\u8d85\u8fc7128\u4e2a\u5b57';
const PAPER_LAYOUT_ERROR = '\u8bd5\u5377\u5206\u7ec4\u4e0e\u5206\u503c\u8bbe\u7f6e\u4e0d\u5b8c\u6574';

function normalizePaperLayoutField(field, value) {
  const rawValue = value === undefined || value === null ? '' : String(value);
  if (field === 'sectionTitle') {
    const normalizedValue = rawValue.trim();
    if (!normalizedValue) return { valid: false, rawValue, value: null, error: PAPER_SECTION_REQUIRED_ERROR };
    if (normalizedValue.length > 128) return { valid: false, rawValue, value: null, error: PAPER_SECTION_LENGTH_ERROR };
    return { valid: true, rawValue, value: normalizedValue, error: '' };
  }
  if (field === 'score') {
    const normalizedText = rawValue.trim();
    if (!/^\d+(?:\.\d?)?$/.test(normalizedText)) {
      return { valid: false, rawValue, value: null, error: PAPER_SCORE_ERROR };
    }
    const normalizedValue = Number(normalizedText);
    if (!Number.isFinite(normalizedValue) || normalizedValue < 0 || normalizedValue > 1000
      || Math.round(normalizedValue * 10) / 10 !== normalizedValue) {
      return { valid: false, rawValue, value: null, error: PAPER_SCORE_ERROR };
    }
    return { valid: true, rawValue, value: normalizedValue, error: '' };
  }
  throw new TypeError('PAPER_LAYOUT_FIELD_INVALID');
}

function applyPaperLayoutFieldEdit(item, { field, value, phase = 'input' } = {}) {
  if (!item || typeof item !== 'object' || !['input', 'blur'].includes(phase)) {
    throw new TypeError('PAPER_LAYOUT_EDIT_INVALID');
  }
  const normalized = normalizePaperLayoutField(field, value);
  const shouldCommit = normalized.valid && (field === 'score' || phase === 'blur');
  return {
    ...normalized,
    patch: shouldCommit ? { [field]: normalized.value } : null,
    showError: !normalized.valid && phase === 'blur',
  };
}

function validateAndNormalizePaperLayout({ questionIds, items } = {}) {
  const expectedIds = Array.isArray(questionIds) ? questionIds.map(value => String(value || '')) : [];
  const inputItems = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
  const errors = [];
  if (!Array.isArray(questionIds) || !Array.isArray(items) || !expectedIds.length
    || inputItems.length !== expectedIds.length || new Set(expectedIds).size !== expectedIds.length
    || expectedIds.some(id => !id || id.length > 128)) {
    errors.push({ itemId: '', itemIndex: -1, field: 'layout', message: PAPER_LAYOUT_ERROR });
  }
  const normalizedItems = inputItems.map((item, index) => {
    const itemId = typeof item?.id === 'string' ? item.id : '';
    if (!itemId || itemId !== expectedIds[index]) {
      errors.push({ itemId, itemIndex: index, field: 'layout', message: PAPER_LAYOUT_ERROR });
    }
    const sectionTitle = normalizePaperLayoutField('sectionTitle', item?.sectionTitle);
    const score = normalizePaperLayoutField('score', item?.score);
    if (!sectionTitle.valid) errors.push({ itemId, itemIndex: index, field: 'sectionTitle', message: sectionTitle.error });
    if (!score.valid) errors.push({ itemId, itemIndex: index, field: 'score', message: score.error });
    return { id: itemId, sectionTitle: sectionTitle.value, score: score.value };
  });
  return {
    valid: errors.length === 0,
    inputItems,
    errors,
    error: errors[0]?.message || '',
    layout: errors.length === 0 ? { items: normalizedItems } : null,
  };
}

function createTaskDraft(input, options = {}) {
  const idempotencyKey = (options.idFactory || (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`))();
  let layout;
  if (input.layout !== undefined) {
    const validation = input.layout && typeof input.layout === 'object' && !Array.isArray(input.layout)
      && Object.keys(input.layout).length === 1
      ? validateAndNormalizePaperLayout({ questionIds: input.questionIds, items: input.layout.items })
      : { valid: false, error: PAPER_LAYOUT_ERROR, errors: [] };
    if (!validation.valid) {
      const error = new Error(`PAPER_LAYOUT_INVALID:${validation.error || PAPER_LAYOUT_ERROR}`);
      error.code = 'PAPER_LAYOUT_INVALID';
      error.validation = validation;
      throw error;
    }
    layout = validation.layout;
  }
  return { localId: `draft-${idempotencyKey}`, confirmed: false, createdAt: options.now || Date.now(), status: 'draft', phase: 'draft', progress: 0,
    request: { protocolVersion: 3, taskType: input.taskType, idempotencyKey,
      payload: { questionIds: [...input.questionIds], title: input.title, answerPosition: input.answerPosition, formulaMode: input.formulaMode, ...(layout ? { layout } : {}) } } };
}
function confirmTaskDraft(draft, task) { return { ...draft, confirmed: true, taskId: task.id, status: task.status, phase: task.phase || 'queued', progress: Number(task.progress || 0), resultExpiresAt: task.result_expires_at || null }; }
function canCancel(task) { return task.confirmed && ['queued', 'processing'].includes(task.status); }
function canRetry(task) { return task.confirmed && ['failed', 'cancelled'].includes(task.status); }
function isExpired(task, now = Date.now()) { return Boolean(task.resultExpiresAt && Date.parse(task.resultExpiresAt) <= now); }
function reconcilePaperItemsWithBasket(items, basketIds) {
  const allowed = new Set((Array.isArray(basketIds) ? basketIds : []).map(String));
  return (Array.isArray(items) ? items : []).filter(item => item && allowed.has(String(item.id)));
}
function unavailableSelectionIds(selectedIds, questions) {
  const available = new Set((Array.isArray(questions) ? questions : []).map(question => String(question?.id || '')).filter(Boolean));
  return Array.from(new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String).filter(id => id && !available.has(id))));
}
module.exports = {
  applyPaperLayoutFieldEdit,
  canCancel,
  canRetry,
  confirmTaskDraft,
  createTaskDraft,
  isExpired,
  normalizePaperLayoutField,
  reconcilePaperItemsWithBasket,
  toggleOrderedSelection,
  unavailableSelectionIds,
  validateAndNormalizePaperLayout,
};
