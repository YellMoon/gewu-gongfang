'use strict';

const crypto = require('crypto');
const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function text(value, max = 256) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) {
    throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
  }
  return value;
}

function stableJson(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (!plainObject(value)) throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function requestHash(value) {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function actor(value) {
  if (!plainObject(value) || !Array.isArray(value.roles)) throw failure('CLOUD_PAPER_EXPORT_ACCESS_DENIED');
  const accountId = text(value.accountId, 512);
  if (!value.roles.some(role => ['super_admin', 'admin', 'teacher', 'student'].includes(role))) {
    throw failure('CLOUD_PAPER_EXPORT_ACCESS_DENIED');
  }
  return { accountId, roles: value.roles.slice() };
}

function request(value) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== 5
    || !['questionIds', 'title', 'subject', 'answerPosition', 'formulaMode'].every(key => Object.hasOwn(value, key))) {
    throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
  }
  if (!Array.isArray(value.questionIds) || value.questionIds.length < 1 || value.questionIds.length > 200
    || new Set(value.questionIds).size !== value.questionIds.length) throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
  const questionIds = value.questionIds.map(item => text(item, 128));
  const title = typeof value.title === 'string' && value.title === value.title.trim() && value.title.length <= 256 ? value.title : null;
  const subject = typeof value.subject === 'string' && value.subject === value.subject.trim() && value.subject.length <= 128 ? value.subject : null;
  if (!title || !subject || !['after', 'end'].includes(value.answerPosition)
    || !['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector'].includes(value.formulaMode)) {
    throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
  }
  return { questionIds, title, subject, answerPosition: value.answerPosition, formulaMode: value.formulaMode };
}

function taskRow(row, replayed = false) {
  if (!plainObject(row) || typeof row.taskId !== 'string' || !row.taskId
    || !['queued', 'processing', 'completed', 'failed', 'cancelled'].includes(row.status)
    || typeof row.phase !== 'string' || !Number.isFinite(Number(row.progress))
    || !(row.createdAt instanceof Date) || !(row.updatedAt instanceof Date)) {
    throw failure('CLOUD_PAPER_EXPORT_UNAVAILABLE');
  }
  return {
    taskId: row.taskId,
    status: row.status,
    phase: row.phase,
    progress: Math.max(0, Math.min(100, Number(row.progress))),
    requestHash: typeof row.requestHash === 'string' ? row.requestHash : '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    replayed,
  };
}

const existingSql = [
  'SELECT task_id AS "taskId",status,phase,progress,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
  'FROM business.paper_export_tasks WHERE tenant_id=$1 AND account_id=$2 AND idempotency_key=$3',
].join(' ');
const selectedSql = [
  'SELECT q.id AS "id",q.subject AS "subject",q.question_type AS "questionType",q.difficulty AS "difficulty",',
  'c.stem AS "stem",c.answer AS "answer",c.explanation AS "explanation",c.options_json AS "options",',
  'c.rich_content_json AS "richContent",q.has_formula AS "hasFormula",c.content_hash AS "contentHash",c.version AS "version"',
  'FROM business.questions q JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id',
  'WHERE q.tenant_id=$1 AND q.deleted=false AND c.deleted=false AND q.id=ANY($2::text[]) ORDER BY q.id ASC',
].join(' ');
const insertSql = [
  'INSERT INTO business.paper_export_tasks',
  '(task_id,tenant_id,account_id,idempotency_key,task_type,request_json,request_hash,question_snapshot_json,status,phase,progress)',
  "VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,'queued','queued',0)",
  'RETURNING task_id AS "taskId",status,phase,progress,request_hash AS "requestHash",created_at AS "createdAt",updated_at AS "updatedAt"',
].join(' ');

function createPaperExportTaskRepository({ query, randomId = () => crypto.randomUUID() } = {}) {
  if (typeof query !== 'function' || typeof randomId !== 'function') throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
  return Object.freeze({
    async create(input) {
      if (!plainObject(input) || Reflect.ownKeys(input).length !== 5
        || !['tenantId', 'actor', 'idempotencyKey', 'taskType', 'request'].every(key => Object.hasOwn(input, key))) {
        throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
      }
      const tenantId = text(input.tenantId, 128);
      const currentActor = actor(input.actor);
      const idempotencyKey = text(input.idempotencyKey, 256);
      if (!['paper-export-word', 'paper-export-pdf'].includes(input.taskType)) throw failure('CLOUD_PAPER_EXPORT_INPUT_INVALID');
      const currentRequest = request(input.request);
      const hash = requestHash({ taskType: input.taskType, request: currentRequest });
      const existing = await query(existingSql, [tenantId, currentActor.accountId, idempotencyKey]);
      if (!existing || !Array.isArray(existing.rows)) throw failure('CLOUD_PAPER_EXPORT_UNAVAILABLE');
      if (existing.rows.length > 1) throw failure('CLOUD_PAPER_EXPORT_UNAVAILABLE');
      if (existing.rows.length === 1) {
        const row = existing.rows[0];
        if (row.requestHash !== hash) throw failure('CLOUD_PAPER_EXPORT_CONFLICT');
        return taskRow(row, true);
      }
      const selected = await query(selectedSql, [tenantId, currentRequest.questionIds]);
      if (!selected || !Array.isArray(selected.rows) || selected.rows.length !== currentRequest.questionIds.length
        || new Set(selected.rows.map(row => row?.id)).size !== currentRequest.questionIds.length) {
        throw failure('CLOUD_PAPER_EXPORT_SELECTION_INVALID');
      }
      const taskId = 'paper_task_' + String(randomId()).replace(/[^A-Za-z0-9_-]/g, '');
      const inserted = await query(insertSql, [taskId, tenantId, currentActor.accountId, idempotencyKey,
        input.taskType, stableJson(currentRequest), hash, stableJson(selected.rows)]);
      if (!inserted || !Array.isArray(inserted.rows) || inserted.rows.length !== 1) throw failure('CLOUD_PAPER_EXPORT_UNAVAILABLE');
      return taskRow(inserted.rows[0], false);
    },
  });
}

module.exports = Object.freeze({ createPaperExportTaskRepository });
