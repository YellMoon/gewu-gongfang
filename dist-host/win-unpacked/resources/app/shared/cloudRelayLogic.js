const crypto = require('crypto');

// 任务状态常量
const TASK_STATUS = {
  PENDING_HOST: 'pending_host',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// 任务类型常量
const TASK_TYPES = {
  DESKTOP_SYNC: 'desktop-sync',
  DESKTOP_IDENTITY: 'desktop-identity',
  DESKTOP_SESSION_CHALLENGE_START: 'desktop-session-challenge-start',
  DESKTOP_SESSION_CHALLENGE_EXCHANGE: 'desktop-session-challenge-exchange',
  IDENTITY_PROVISIONING: 'identity-provisioning',
  QUESTION_PAPER: 'question-paper',
  PAPER_EXPORT_WORD: 'paper-export-word',
  PAPER_EXPORT_PDF: 'paper-export-pdf',
  ASSET_IMPORT: 'asset-import',
};

// 内部任务类型（不允许通过公共流程创建）
const INTERNAL_TASK_TYPES = new Set([
  'identity-provisioning',
  'desktop-session-challenge-start',
  'desktop-session-challenge-exchange',
]);

// 稳定化值用于哈希计算
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

// 请求哈希计算
function requestHash(input) {
  const canonical = stableValue({
    taskType: input.taskType,
    payload: input.payload || {},
    tenantId: input.tenantId || 'default',
    actorRole: input.actorRole || '',
    allowDraft: Boolean(input.allowDraft),
    targetHostDeviceId: input.targetHostDeviceId,
    maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
    deadlineAt: input.deadlineAt || null,
    resultExpiresAt: input.resultExpiresAt || null,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// 结果哈希计算
function canonicalResultJson(input) {
  return JSON.stringify(stableValue(input || {}));
}

function resultHash(input) {
  return crypto.createHash('sha256').update(canonicalResultJson(input)).digest('hex');
}

// 任务错误创建
function taskError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

// 检查是否为内部任务类型
function isInternalTaskType(taskType) {
  return INTERNAL_TASK_TYPES.has(String(taskType || '').trim());
}

// 解析JSON
function parseJson(value, fallback) {
  try { return value === null || value === undefined ? fallback : JSON.parse(value); } catch (_error) { return fallback; }
}

// 任务行处理
function taskRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload: parseJson(row.payload, {}),
    result_payload: parseJson(row.result_payload, null),
    selection_context: parseJson(row.selection_context, {}),
  };
}

module.exports = {
  TASK_STATUS,
  TASK_TYPES,
  INTERNAL_TASK_TYPES,
  stableValue,
  requestHash,
  canonicalResultJson,
  resultHash,
  taskError,
  isInternalTaskType,
  parseJson,
  taskRow,
};
