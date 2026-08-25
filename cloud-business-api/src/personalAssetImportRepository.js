'use strict';

const crypto = require('crypto');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (!plainObject(value)) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  return value;
}

function text(value, max) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  return value;
}

function optionalText(value, max) {
  if (value === undefined || value === null || value === '') return '';
  return text(value, max);
}

function amount(value) {
  const parsed = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100000000 || Math.round(parsed * 100) !== parsed * 100) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  return parsed;
}

function actor(value) {
  if (!plainObject(value) || !Array.isArray(value.roles) || typeof value.accountId !== 'string' || !value.accountId.trim()) throw failure('CLOUD_PERSONAL_ASSET_ACCESS_DENIED');
  if (!value.roles.includes('super_admin')) throw failure('CLOUD_PERSONAL_ASSET_ACCESS_DENIED');
  return { accountId: text(value.accountId, 512) };
}

function inputRecord(value) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== 5 || !['date', 'type', 'amount', 'category', 'note'].every(key => Object.hasOwn(value, key))) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  if (!['income', 'expense'].includes(value.type)) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  return { date: date(value.date), type: value.type, amount: amount(value.amount), category: text(value.category, 128), note: optionalText(value.note, 2000) };
}

function createPersonalAssetImportRepository({ transaction, randomId = () => crypto.randomUUID() } = {}) {
  if (typeof transaction !== 'function' || typeof randomId !== 'function') throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
  return Object.freeze({
    async import(input) {
      if (!plainObject(input) || Reflect.ownKeys(input).length !== 4 || !['tenantId', 'actor', 'idempotencyKey', 'records'].every(key => Object.hasOwn(input, key))) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
      const tenantId = text(input.tenantId, 128);
      const currentActor = actor(input.actor);
      const idempotencyKey = text(input.idempotencyKey, 256);
      if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 1000) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
      const records = input.records.map(inputRecord);
      const requestHash = crypto.createHash('sha256').update(stableJson(records), 'utf8').digest('hex');
      const importId = `asset_import_${String(randomId()).replace(/^asset_import_/, '').replace(/[^A-Za-z0-9_-]/g, '')}`;
      if (!/^asset_import_[A-Za-z0-9_-]{8,128}$/.test(importId)) throw failure('CLOUD_PERSONAL_ASSET_INPUT_INVALID');
      const result = await transaction(query => query([
        'WITH input_rows AS (SELECT row_number() OVER ()::integer AS ordinal,(item->>\'date\')::date AS record_date,item->>\'type\' AS record_type,(item->>\'amount\')::numeric(14,2) AS amount,item->>\'category\' AS category_name,item->>\'note\' AS note FROM jsonb_array_elements($5::jsonb) item),',
        'current_import AS (INSERT INTO business.personal_asset_imports(import_id,tenant_id,account_id,idempotency_key,request_hash,record_count) SELECT $4,$1,$2,$3,$6,(SELECT count(*) FROM input_rows) ON CONFLICT (tenant_id,account_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING import_id AS "importId",record_count AS "recordCount",request_hash AS "requestHash",created_at AS "createdAt",(xmax<>0) AS replayed),',
        'categories AS (INSERT INTO business.personal_asset_categories(category_id,tenant_id,account_id,name,category_type) SELECT \'asset_category_\'||md5($1||\':\'||$2||\':\'||record_type||\':\'||category_name),$1,$2,category_name,record_type FROM input_rows,current_import ON CONFLICT (tenant_id,account_id,category_type,name) DO NOTHING RETURNING category_id),',
        'records AS (INSERT INTO business.personal_asset_records(record_id,import_id,source_ordinal,tenant_id,account_id,record_date,record_type,category_id,category_name,amount,note) SELECT \'asset_record_\'||md5(current_import."importId"||\':\'||input_rows.ordinal::text),current_import."importId",input_rows.ordinal,$1,$2,input_rows.record_date,input_rows.record_type,\'asset_category_\'||md5($1||\':\'||$2||\':\'||input_rows.record_type||\':\'||input_rows.category_name),input_rows.category_name,input_rows.amount,input_rows.note FROM input_rows,current_import ON CONFLICT (import_id,source_ordinal) DO NOTHING RETURNING record_id) SELECT "importId","recordCount","requestHash","createdAt",replayed FROM current_import',
      ].join(' '), [tenantId, currentActor.accountId, idempotencyKey, importId, JSON.stringify(records), requestHash]));
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_PERSONAL_ASSET_UNAVAILABLE');
      const row = result.rows[0];
      if (row.requestHash !== requestHash) throw failure('CLOUD_PERSONAL_ASSET_IDEMPOTENCY_CONFLICT');
      if (typeof row.importId !== 'string' || !Number.isSafeInteger(Number(row.recordCount)) || !(row.createdAt instanceof Date)) throw failure('CLOUD_PERSONAL_ASSET_UNAVAILABLE');
      return { importId: row.importId, recordCount: Number(row.recordCount), createdAt: row.createdAt.toISOString(), replayed: Boolean(row.replayed) };
    },
  });
}

module.exports = Object.freeze({ createPersonalAssetImportRepository });
