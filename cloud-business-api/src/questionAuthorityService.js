'use strict';

const crypto = require('crypto');
const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return value;
}

function text(value, { nullable = false, max = 1048576 } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return value;
}

function json(value, { array = false, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (array ? !Array.isArray(value) : !plainObject(value)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  try {
    const serialized = stableJson(value);
    if (serialized.length > 1048576) throw failure('CLOUD_QUESTION_INPUT_INVALID');
    return serialized;
  } catch (error) {
    if (error?.code === 'CLOUD_QUESTION_INPUT_INVALID') throw error;
    throw failure('CLOUD_QUESTION_INPUT_INVALID');
  }
}

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(',')}]`;
  if (!plainObject(value)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function canonicalContentHash({ stem, answer, explanation, options, richContent }) {
  return crypto.createHash('sha256').update(stableJson({ stem, answer, explanation, options, richContent }), 'utf8').digest('hex');
}

function actor(value) {
  if (!plainObject(value) || !Array.isArray(value.roles) || typeof value.accountId !== 'string' || !value.accountId.trim()) throw failure('CLOUD_QUESTION_ACCESS_DENIED');
  if (!value.roles.includes('super_admin') && !value.roles.includes('admin') && !value.roles.includes('teacher')) throw failure('CLOUD_QUESTION_ACCESS_DENIED');
  return { accountId: value.accountId, roles: value.roles };
}

function createdRow(row) {
  if (!plainObject(row) || typeof row.id !== 'string' || !row.id || row.status !== 'draft' || Number(row.version) !== 1
    || typeof row.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.contentHash)) throw failure('CLOUD_QUESTION_UNAVAILABLE');
  return { id: row.id, status: row.status, version: Number(row.version), contentHash: row.contentHash };
}

function createQuestionAuthorityService({ query } = {}) {
  if (typeof query !== 'function') throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return Object.freeze({
    async create(input) {
      const request = exact(input, ['tenantId', 'actor', 'question']);
      const tenantId = text(request.tenantId, { max: 128 });
      const currentActor = actor(request.actor);
      const question = exact(request.question, ['id', 'subject', 'questionType', 'difficulty', 'stem', 'answer', 'explanation', 'options', 'richContent', 'taxonomy', 'hasFormula']);
      const id = text(question.id, { max: 128 });
      const subject = text(question.subject, { max: 128 });
      const questionType = text(question.questionType, { max: 128 });
      if (!Number.isSafeInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5 || typeof question.hasFormula !== 'boolean') throw failure('CLOUD_QUESTION_INPUT_INVALID');
      const stem = text(question.stem);
      const answer = question.answer === null ? null : text(question.answer, { max: 1048576 });
      const explanation = question.explanation === null ? null : text(question.explanation, { max: 1048576 });
      const options = json(question.options, { array: true });
      const richContent = json(question.richContent, { nullable: true });
      const taxonomy = json(question.taxonomy);
      const contentHash = canonicalContentHash({ stem, answer, explanation, options: JSON.parse(options), richContent: richContent === null ? null : JSON.parse(richContent) });
      const result = await query(
        `WITH inserted_question AS (
           INSERT INTO business.questions (id,tenant_id,subject,question_type,difficulty,created_by_account_id,taxonomy_json,has_formula)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           RETURNING id,status
         ), inserted_content AS (
           INSERT INTO business.question_contents (question_id,tenant_id,stem,answer,explanation,options_json,rich_content_json,content_hash)
           SELECT $1,$2,$9,$10,$11,$12::jsonb,$13::jsonb,$14 FROM inserted_question
           RETURNING version,content_hash AS "contentHash"
         ) SELECT q.id,q.status,c.version,c."contentHash" FROM inserted_question q CROSS JOIN inserted_content c`,
        [id, tenantId, subject, questionType, question.difficulty, currentActor.accountId, taxonomy, question.hasFormula, stem, answer, explanation, options, richContent, contentHash],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_UNAVAILABLE');
      return createdRow(result.rows[0]);
    },
  });
}

module.exports = Object.freeze({ createQuestionAuthorityService });
