const defaultQuestionBank = require('./questionBankService');

const MAX_EXPORT_QUESTIONS = 100;

function selectionError(code, message, statusCode = 400, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode, ...extra });
}

function normalizedQuestionIds(payload = {}) {
  if (!Array.isArray(payload.questionIds)) {
    throw selectionError('QUESTION_IDS_REQUIRED', 'questionIds are required for an exact paper export');
  }
  const ids = payload.questionIds.map(value => String(value || '').trim());
  if (!ids.length || ids.length > MAX_EXPORT_QUESTIONS || ids.some(id => !id || id.length > 128)) {
    throw selectionError('QUESTION_IDS_INVALID', `questionIds must contain 1-${MAX_EXPORT_QUESTIONS} non-empty IDs`);
  }
  if (new Set(ids).size !== ids.length) {
    throw selectionError('QUESTION_IDS_DUPLICATE', 'questionIds must be unique');
  }
  return ids;
}

function resolveExactQuestionSelection(db, payload = {}, context = {}, dependencies = {}) {
  const questionBank = dependencies.questionBank || defaultQuestionBank;
  const tenantId = context.tenantId || payload.tenantId || payload.tenant_id || 'default';
  const ids = normalizedQuestionIds(payload);
  const rows = ids.map(id => questionBank.getQuestion(db.db || db, id, tenantId));
  const missingQuestionIds = ids.filter((_id, index) => !rows[index]);
  if (missingQuestionIds.length) {
    throw selectionError(
      'QUESTION_SELECTION_INCOMPLETE',
      'one or more selected questions are unavailable in the authorized tenant',
      400,
      { missingQuestionIds }
    );
  }
  const forbiddenDraftIds = rows.filter(row => row.status !== 'published' && !context.allowDraft).map(row => row.id);
  if (forbiddenDraftIds.length) {
    throw selectionError('QUESTION_DRAFT_FORBIDDEN', 'draft questions are not allowed for this export actor', 403, { forbiddenDraftIds });
  }
  return rows;
}

function resolveLegacyQuestionSelection(db, payload = {}, context = {}, dependencies = {}) {
  const questionBank = dependencies.questionBank || defaultQuestionBank;
  const tenantId = context.tenantId || payload.tenantId || payload.tenant_id || 'default';
  const limit = Math.max(1, Math.min(Number(payload.questionCount || payload.count || 20) || 20, MAX_EXPORT_QUESTIONS));
  const filters = {
    subject: payload.subject || undefined,
    type: payload.type || undefined,
    difficulty: payload.difficulty || undefined,
    status: context.allowDraft ? payload.status || undefined : 'published',
  };
  return questionBank.listQuestions(db.db || db, filters, tenantId).slice(0, limit);
}

function resolveTaskQuestionSelection(db, task = {}, context = {}, dependencies = {}) {
  const protocolVersion = Number(task.protocolVersion || task.protocol_version || 1);
  const payload = task.payload || {};
  return protocolVersion >= 2
    ? resolveExactQuestionSelection(db, payload, context, dependencies)
    : resolveLegacyQuestionSelection(db, payload, context, dependencies);
}

module.exports = {
  MAX_EXPORT_QUESTIONS,
  normalizedQuestionIds,
  resolveExactQuestionSelection,
  resolveLegacyQuestionSelection,
  resolveTaskQuestionSelection,
};
