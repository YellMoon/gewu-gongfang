'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { types } = require('util');

const BAD_QUESTION_IDS = Object.freeze([
  'question-import-9fbb604e6cc387f961fd872e2897029791332683',
  'question-import-37ad0cbc883c6bdde474a3063c632528da8657fd',
  'question-import-3004c748d7bae7da24a16e54d8d77a71939551ab',
  'question-import-08e45456bf7fb9c4aad49ce59a0bb4cc87776a34',
  'question-import-c90e12f278d5e094a2900dfeb6b098832d52e8da',
  'question-import-cded13379b3304ddaaa53b1e864f0883768b23dd',
  'question-import-216770d7c4084d5433c00c67760f113c901a75d0',
  'question-import-41809d895f92d19d70f50b26f60e2dc480a768a3',
  'question-import-b3547b53c1d23cd90f40de71e40b944bd9a1906a',
  'question-import-c1afd0d8ec0b8ef08a3bf3ac3e4b61e5efad53e4',
  'question-import-d3f3d62274ad0376fe430ca1215d56938f28e6ee',
  'question-import-d4ea3a77171d2cf9d034b8641f68e22f98319e64',
  'question-import-416ff640ad4442e9fedd44ee975ab2b8606ae369',
  'question-import-d96c1cecfaff1e23ee6a0590da79ec2b716abc92',
]);

const CANONICAL_QUESTION_IDS = Object.freeze([
  'question-import-0b857ab6280b00ed481fc8169387f76cf48b0716',
  'question-import-46f337830aaaff903b8ca6d079cb85e37da99fa2',
]);

const EXPECTED_QUESTION_IDENTITIES = Object.freeze({
  'question-import-08e45456bf7fb9c4aad49ce59a0bb4cc87776a34': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: 'b99619b8dffcfd5cb287bf507f4c4edd87b08a4320bfc5b220967721c90bac6b' }),
  'question-import-0b857ab6280b00ed481fc8169387f76cf48b0716': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: '16c9df75c73879c77af8d9ce9b49eeaef1e1d02462d02d5f025fe3c4823d3d70' }),
  'question-import-216770d7c4084d5433c00c67760f113c901a75d0': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: '3102558fd081d498c2f86229e8511da9d8ccbc0692a0ce2d765d6a84a8c1656d' }),
  'question-import-3004c748d7bae7da24a16e54d8d77a71939551ab': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: 'f8630b6878ad962089adecf35db1fe86f1345ae29104dc207fa389a97fedb000' }),
  'question-import-37ad0cbc883c6bdde474a3063c632528da8657fd': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: 'e8f1f8154da31c35f78699deff7835686aabbdf38cb93eb028c9adda65bb0383' }),
  'question-import-416ff640ad4442e9fedd44ee975ab2b8606ae369': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: 'ffeaa8f02a214ee729a4eea4402c6061877ab3a7ae8601ff9c933821193dc3bc' }),
  'question-import-41809d895f92d19d70f50b26f60e2dc480a768a3': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: 'e480b3b22cd2a563a4e73ee285490422cffaa41e30df38a1dd4c6506e92b01e6' }),
  'question-import-46f337830aaaff903b8ca6d079cb85e37da99fa2': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: '59d44fe272534e7c0863cc4e39a2779907613b2ab25ff0ee90d9784f8561d5ed' }),
  'question-import-9fbb604e6cc387f961fd872e2897029791332683': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: 'd16ef9deb7f049449a8cf07469997e24f966ba7fd09d550c522365e3fa6bdd8b' }),
  'question-import-b3547b53c1d23cd90f40de71e40b944bd9a1906a': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: '4e1d4fa396e63d107648237a0106213e5465df010301de15211fffca9b44af02' }),
  'question-import-c1afd0d8ec0b8ef08a3bf3ac3e4b61e5efad53e4': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: 'a0fe7eb0192f67536fb15b9a625bad5ddbaa28bf45b41fd693cf1adbe0bbc9eb' }),
  'question-import-c90e12f278d5e094a2900dfeb6b098832d52e8da': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: '4b1e0e31c40550abd0ee0e1afd21adee18ce1f8e25c66a3dc5da382a14610b6e' }),
  'question-import-cded13379b3304ddaaa53b1e864f0883768b23dd': Object.freeze({ source: 'gewu-real-exam.docx', version: 2, contentHash: '5a19ca4d3f6129a5d4653715d87c2b895740f27f1ae8cd31b50fd025977e2eea' }),
  'question-import-d3f3d62274ad0376fe430ca1215d56938f28e6ee': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: 'eb814eaf69995078aa17784c47ef449cebf98f8135d432bd57072c827195f5a2' }),
  'question-import-d4ea3a77171d2cf9d034b8641f68e22f98319e64': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: 'be04e29e613edc0e349974883e46a6a0dbfc8525fd16e829c00d26d4cb6c890e' }),
  'question-import-d96c1cecfaff1e23ee6a0590da79ec2b716abc92': Object.freeze({ source: 'gewu-real-lecture.docx', version: 2, contentHash: '4d33419ab9cef4b2152031601eae30ad101f5bd77ce12cd2c7670bc7e46e710d' }),
});

const EXPECTED_BAD_OPTION_COUNTS = new Map(BAD_QUESTION_IDS.map((id, index) => [id, index < 7 ? 1 : 2]));
const EXPECTED_BAD_SNAPSHOT_REFS = new Map(BAD_QUESTION_IDS.map(id => [id,
  ['question-import-c90e12f278d5e094a2900dfeb6b098832d52e8da', 'question-import-d4ea3a77171d2cf9d034b8641f68e22f98319e64'].includes(id) ? 2 : 0,
]));
const EXPECTED_SNAPSHOT_SET_SHA256 = '4c70264986bb30360176e92ccf659c84a14135d274cb45e1a26aa747e313a4ad';

function failure(code, details) {
  return Object.assign(new Error(code), { code, details });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw failure('PRODUCTION_QUESTION_REPAIR_INPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!plainObject(value)) throw failure('PRODUCTION_QUESTION_REPAIR_INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function buildDeleteCommand(questionId, expectedVersion) {
  if (!BAD_QUESTION_IDS.includes(questionId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw failure('PRODUCTION_QUESTION_REPAIR_INPUT_INVALID');
  }
  const type = 'question.delete.v1';
  const payload = { id: questionId, expectedVersion };
  const idHash = crypto.createHash('sha256').update(questionId, 'utf8').digest('hex').slice(0, 40);
  return Object.freeze({
    commandId: `question-production-repair-delete-${idHash}`,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
    type,
    payload,
  });
}

function validRow(row) {
  return plainObject(row) && typeof row.id === 'string' && typeof row.status === 'string'
    && typeof row.deleted === 'boolean' && typeof row.contentDeleted === 'boolean'
    && typeof row.source === 'string' && row.source.length > 0
    && typeof row.contentHash === 'string' && /^[0-9a-f]{64}$/u.test(row.contentHash)
    && Number.isSafeInteger(Number(row.optionCount)) && Number(row.optionCount) >= 0
    && Number.isSafeInteger(Number(row.version)) && Number(row.version) >= 1
    && Number.isSafeInteger(Number(row.snapshotRefs)) && Number(row.snapshotRefs) >= 0
    && Number.isSafeInteger(Number(row.assetCount)) && Number(row.assetCount) >= 0
    && Number(row.snapshotTaskCount) === 2 && row.snapshotSetSha256 === EXPECTED_SNAPSHOT_SET_SHA256
    && Number.isSafeInteger(Number(row.activePublishedCount)) && Number(row.activePublishedCount) >= 0
    && Number.isSafeInteger(Number(row.activePublishedOptionCount)) && Number(row.activePublishedOptionCount) >= 0
    && Number(row.activePublishedSourceCount) === 2;
}

function normalizedQuestionIdentity(row) {
  return {
    contentHash: row.contentHash,
    id: row.id,
    optionCount: Number(row.optionCount),
    source: row.source,
    version: Number(row.version) - (row.deleted ? 1 : 0),
  };
}

function questionIdentitySetSha256(rows) {
  const identities = rows.map(normalizedQuestionIdentity).sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return crypto.createHash('sha256').update(stableJson(identities), 'utf8').digest('hex');
}

function validateInventory(rows, { repaired }) {
  if (!Array.isArray(rows) || ![true, false, null].includes(repaired) || rows.length !== 16 || rows.some(row => !validRow(row))) {
    throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== 16 || [...byId].some(([id]) => !BAD_QUESTION_IDS.includes(id) && !CANONICAL_QUESTION_IDS.includes(id))) {
    throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
  }
  let malformedActiveCount = 0;
  for (const id of BAD_QUESTION_IDS) {
    const row = byId.get(id);
    const expectedIdentity = EXPECTED_QUESTION_IDENTITIES[id];
    const consistentDeletion = row && row.deleted === row.contentDeleted;
    if (!row || !consistentDeletion || (repaired !== null && row.deleted !== repaired)
      || row.status !== 'published'
      || row.source !== expectedIdentity.source || row.contentHash !== expectedIdentity.contentHash
      || Number(row.version) - (row.deleted ? 1 : 0) !== expectedIdentity.version
      || Number(row.optionCount) !== EXPECTED_BAD_OPTION_COUNTS.get(id) || Number(row.assetCount) !== 0
      || Number(row.snapshotRefs) !== EXPECTED_BAD_SNAPSHOT_REFS.get(id)) {
      throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
    }
    if (!row.deleted) malformedActiveCount += 1;
  }
  for (const id of CANONICAL_QUESTION_IDS) {
    const row = byId.get(id);
    const expectedIdentity = EXPECTED_QUESTION_IDENTITIES[id];
    if (!row || row.status !== 'published' || row.deleted || row.contentDeleted
      || row.source !== expectedIdentity.source || row.contentHash !== expectedIdentity.contentHash
      || Number(row.version) !== expectedIdentity.version
      || Number(row.optionCount) !== 4 || Number(row.assetCount) !== 0) {
      throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
    }
  }
  const metric = rows[0];
  if (rows.some(row => Number(row.activePublishedCount) !== Number(metric.activePublishedCount)
    || Number(row.activePublishedOptionCount) !== Number(metric.activePublishedOptionCount)
    || Number(row.activePublishedSourceCount) !== Number(metric.activePublishedSourceCount))) {
    throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
  }
  const expectedOptionCount = 8 + BAD_QUESTION_IDS.reduce((total, id) => (
    byId.get(id).deleted ? total : total + EXPECTED_BAD_OPTION_COUNTS.get(id)
  ), 0);
  if (Number(metric.activePublishedCount) !== CANONICAL_QUESTION_IDS.length + malformedActiveCount
    || Number(metric.activePublishedOptionCount) !== expectedOptionCount) {
    throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
  }
  return Object.freeze({
    malformedActiveCount,
    canonicalActiveCount: CANONICAL_QUESTION_IDS.length,
    snapshotReferenceCount: BAD_QUESTION_IDS.reduce((total, id) => total + Number(byId.get(id).snapshotRefs), 0),
    snapshotTaskCount: 2,
    snapshotSetSha256: EXPECTED_SNAPSHOT_SET_SHA256,
    targetIdentitySetSha256: questionIdentitySetSha256(rows),
    activePublishedCount: Number(metric.activePublishedCount),
    activePublishedOptionCount: Number(metric.activePublishedOptionCount),
    activePublishedSourceCount: 2,
  });
}

function inventoryDiagnostics(rows) {
  if (!Array.isArray(rows)) return Object.freeze({ rowCount: null });
  return Object.freeze({
    rowCount: rows.length,
    rows: rows.map(row => Object.freeze({
      id: typeof row?.id === 'string' ? row.id : null,
      status: typeof row?.status === 'string' ? row.status : null,
      deleted: typeof row?.deleted === 'boolean' ? row.deleted : null,
      contentDeleted: typeof row?.contentDeleted === 'boolean' ? row.contentDeleted : null,
      optionCount: Number.isSafeInteger(Number(row?.optionCount)) ? Number(row.optionCount) : null,
      version: Number.isSafeInteger(Number(row?.version)) ? Number(row.version) : null,
      source: typeof row?.source === 'string' ? row.source : null,
      contentHash: typeof row?.contentHash === 'string' ? row.contentHash : null,
      assetCount: Number.isSafeInteger(Number(row?.assetCount)) ? Number(row.assetCount) : null,
      snapshotRefs: Number.isSafeInteger(Number(row?.snapshotRefs)) ? Number(row.snapshotRefs) : null,
    })),
    snapshotTaskCount: Number.isSafeInteger(Number(rows[0]?.snapshotTaskCount)) ? Number(rows[0].snapshotTaskCount) : null,
    snapshotSetSha256: typeof rows[0]?.snapshotSetSha256 === 'string' ? rows[0].snapshotSetSha256 : null,
    activePublishedCount: Number.isSafeInteger(Number(rows[0]?.activePublishedCount)) ? Number(rows[0].activePublishedCount) : null,
    activePublishedOptionCount: Number.isSafeInteger(Number(rows[0]?.activePublishedOptionCount)) ? Number(rows[0].activePublishedOptionCount) : null,
    activePublishedSourceCount: Number.isSafeInteger(Number(rows[0]?.activePublishedSourceCount)) ? Number(rows[0].activePublishedSourceCount) : null,
  });
}

function validateRepairReceipts(rows, inventoryRows) {
  if (!Array.isArray(rows) || !Array.isArray(inventoryRows)) throw failure('PRODUCTION_QUESTION_REPAIR_RECEIPT_MISMATCH');
  const inventoryById = new Map(inventoryRows.map(row => [row.id, row]));
  const expectedDeleted = BAD_QUESTION_IDS.filter(id => inventoryById.get(id)?.deleted);
  if (rows.length !== expectedDeleted.length) throw failure('PRODUCTION_QUESTION_REPAIR_RECEIPT_MISMATCH');
  const byCommandId = new Map(rows.map(row => [row?.commandId, row]));
  if (byCommandId.size !== rows.length) throw failure('PRODUCTION_QUESTION_REPAIR_RECEIPT_MISMATCH');
  const normalized = [];
  for (const id of expectedDeleted) {
    const inventory = inventoryById.get(id);
    const command = buildDeleteCommand(id, Number(inventory.version) - 1);
    const receipt = byCommandId.get(command.commandId);
    if (!plainObject(receipt) || receipt.payloadHash !== command.payloadHash || receipt.status !== 'committed'
      || !plainObject(receipt.result) || receipt.result.id !== id || receipt.result.status !== 'published'
      || Number(receipt.result.version) !== Number(inventory.version)
      || typeof receipt.result.contentHash !== 'string' || !/^[0-9a-f]{64}$/u.test(receipt.result.contentHash)
      || typeof receipt.resultHash !== 'string' || receipt.resultHash !== crypto.createHash('sha256').update(stableJson(receipt.result), 'utf8').digest('hex')) {
      throw failure('PRODUCTION_QUESTION_REPAIR_RECEIPT_MISMATCH');
    }
    normalized.push({
      commandId: receipt.commandId,
      payloadHash: receipt.payloadHash,
      resultHash: receipt.resultHash,
      status: receipt.status,
    });
  }
  normalized.sort((left, right) => left.commandId.localeCompare(right.commandId, 'en'));
  return Object.freeze({
    receiptCount: normalized.length,
    receiptSetSha256: normalized.length
      ? crypto.createHash('sha256').update(stableJson(normalized), 'utf8').digest('hex')
      : null,
  });
}

async function repairQuestions({ mode, loadInventory, loadReceipts, submitCommands }) {
  if (!['dry-run', 'apply'].includes(mode) || typeof loadInventory !== 'function'
    || typeof loadReceipts !== 'function' || typeof submitCommands !== 'function') {
    throw failure('PRODUCTION_QUESTION_REPAIR_INPUT_INVALID');
  }
  const beforeRows = await loadInventory();
  let before;
  try {
    before = validateInventory(beforeRows, { repaired: null });
  } catch (error) {
    if (error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH') error.details = inventoryDiagnostics(beforeRows);
    throw error;
  }
  const beforeReceipts = validateRepairReceipts(await loadReceipts(), beforeRows);
  const alreadyRepaired = before.malformedActiveCount === 0;
  if (mode === 'dry-run') {
    return Object.freeze({ ok: true, mode, ready: !alreadyRepaired, ...before,
      commandReceiptCount: beforeReceipts.receiptCount, commandReceiptSetSha256: beforeReceipts.receiptSetSha256 });
  }
  if (alreadyRepaired) {
    return Object.freeze({ ok: true, mode, replayed: true, deletedCount: 14, ...before,
      commandReceiptCount: beforeReceipts.receiptCount, commandReceiptSetSha256: beforeReceipts.receiptSetSha256 });
  }
  const rowsById = new Map(beforeRows.map(row => [row.id, row]));
  const commands = BAD_QUESTION_IDS
    .filter(id => !rowsById.get(id).deleted)
    .map(id => buildDeleteCommand(id, Number(rowsById.get(id).version)));
  const submitted = await submitCommands(commands);
  if (!Array.isArray(submitted) || submitted.length !== commands.length
    || submitted.some(receipt => !plainObject(receipt) || receipt.status !== 'committed')) {
    throw failure('PRODUCTION_QUESTION_REPAIR_COMMAND_REJECTED');
  }
  const afterRows = await loadInventory();
  let after;
  try {
    after = validateInventory(afterRows, { repaired: true });
  } catch (error) {
    if (error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH') error.details = inventoryDiagnostics(afterRows);
    throw error;
  }
  if (after.snapshotReferenceCount !== before.snapshotReferenceCount) {
    throw failure('PRODUCTION_QUESTION_REPAIR_SNAPSHOT_CHANGED');
  }
  const afterReceipts = validateRepairReceipts(await loadReceipts(), afterRows);
  return Object.freeze({ ok: true, mode, replayed: false, deletedCount: 14, ...after,
    commandReceiptCount: afterReceipts.receiptCount, commandReceiptSetSha256: afterReceipts.receiptSetSha256 });
}

function postgresConfig(env, user, password) {
  if (typeof user !== 'string' || !user || typeof password !== 'string' || password.length < 24) {
    throw failure('PRODUCTION_QUESTION_REPAIR_CONFIG_INVALID');
  }
  return {
    host: env.POSTGRES_HOST || 'gewu-postgres17',
    port: Number(env.POSTGRES_PORT || 5432),
    database: env.POSTGRES_DB || 'gewu_cloud',
    user,
    password,
    max: 1,
    connectionTimeoutMillis: 5000,
  };
}

async function loadProductionInventory(query, tenantId) {
  if (typeof query !== 'function' || typeof tenantId !== 'string' || !tenantId) {
    throw failure('PRODUCTION_QUESTION_REPAIR_CONFIG_INVALID');
  }
  const ids = [...BAD_QUESTION_IDS, ...CANONICAL_QUESTION_IDS];
  const result = await query(
    `WITH target(id) AS (SELECT unnest($3::text[])),
     snapshot_references AS (
       SELECT DISTINCT task.task_id,task.question_snapshot_json
         FROM business.paper_export_tasks task
         JOIN target ON task.question_snapshot_json @> jsonb_build_array(jsonb_build_object('id',target.id))
        WHERE task.tenant_id=$1
     ), snapshot_baseline AS (
       SELECT count(*)::int AS "snapshotTaskCount",
              encode(sha256(convert_to(jsonb_agg(jsonb_build_object('taskId',task_id,'snapshot',question_snapshot_json) ORDER BY task_id)::text,'UTF8')),'hex') AS "snapshotSetSha256"
         FROM snapshot_references
     )
     , published_baseline AS (
       SELECT count(*)::int AS "activePublishedCount",
              COALESCE(sum(jsonb_array_length(content.options_json)),0)::int AS "activePublishedOptionCount",
              count(DISTINCT question.source)::int AS "activePublishedSourceCount"
         FROM business.questions question
         JOIN business.question_contents content ON content.tenant_id=question.tenant_id AND content.question_id=question.id
        WHERE question.tenant_id=$1 AND question.status='published' AND question.deleted=false AND content.deleted=false
     )
     SELECT q.id,q.status,q.source,q.deleted,c.deleted AS "contentDeleted",c.content_hash AS "contentHash",
            jsonb_array_length(c.options_json)::int AS "optionCount",c.version::int AS version,
            (SELECT count(*)::int FROM business.question_assets asset
              WHERE asset.tenant_id=q.tenant_id AND asset.question_id=q.id AND asset.deleted=false) AS "assetCount",
            (SELECT count(*)::int FROM business.paper_export_tasks task
              WHERE task.tenant_id=q.tenant_id
                AND task.question_snapshot_json @> jsonb_build_array(jsonb_build_object('id',q.id))) AS "snapshotRefs",
            snapshot_baseline."snapshotTaskCount",snapshot_baseline."snapshotSetSha256",
            published_baseline."activePublishedCount",published_baseline."activePublishedOptionCount",
            published_baseline."activePublishedSourceCount"
       FROM business.questions q
       JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id
       CROSS JOIN snapshot_baseline
       CROSS JOIN published_baseline
      WHERE q.tenant_id=$1 AND q.id=ANY($2::text[])
      ORDER BY q.id`,
    [tenantId, ids, BAD_QUESTION_IDS],
  );
  if (!result || typeof result !== 'object' || !Array.isArray(result.rows)) throw failure('PRODUCTION_QUESTION_REPAIR_DATABASE_UNAVAILABLE');
  return result.rows;
}

async function loadProductionRepairReceipts(query, tenantId) {
  if (typeof query !== 'function' || typeof tenantId !== 'string' || !tenantId) {
    throw failure('PRODUCTION_QUESTION_REPAIR_CONFIG_INVALID');
  }
  const commandIds = BAD_QUESTION_IDS.map(id => buildDeleteCommand(id, 1).commandId);
  const result = await query(
    `SELECT command_id AS "commandId",payload_hash AS "payloadHash",status,result_json AS result,result_hash AS "resultHash"
       FROM business.desktop_question_command_receipts
      WHERE tenant_id=$1 AND command_id=ANY($2::text[])
      ORDER BY command_id`,
    [tenantId, commandIds],
  );
  if (!result || typeof result !== 'object' || !Array.isArray(result.rows)) throw failure('PRODUCTION_QUESTION_REPAIR_DATABASE_UNAVAILABLE');
  return result.rows;
}

async function readJson(response) {
  try { return await response.json(); } catch (_) { return {}; }
}

async function requireCloudHealth(fetchImpl, expectedVersion, baseUrl) {
  if (typeof fetchImpl !== 'function' || typeof expectedVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(expectedVersion)
    || typeof baseUrl !== 'string' || !/^https:\/\//u.test(baseUrl)) {
    throw failure('PRODUCTION_QUESTION_REPAIR_CONFIG_INVALID');
  }
  const response = await fetchImpl(`${baseUrl.replace(/\/$/u, '')}/api/health`, { headers: { Accept: 'application/json' } });
  const body = await readJson(response);
  if (response.status !== 200 || body?.ok !== true || body?.businessAuthority !== 'cloud' || body?.version !== expectedVersion) {
    throw failure('PRODUCTION_QUESTION_REPAIR_CLOUD_VERSION_MISMATCH');
  }
  return true;
}

async function withRepairTransaction(appPool, work) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gewu-production-question-duplicate-repair',0))");
    const result = await work((...args) => client.query(...args));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve the primary failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function runFromEnvironment(env = process.env, mode = 'dry-run') {
  const helper = require('./real-cloud-business-acceptance');
  const runtimeDirectory = /^question-repair-[0-9a-f]{32}$/u.test(path.basename(__dirname))
    ? path.dirname(__dirname) : __dirname;
  const runtimeModules = helper.resolveRuntimeModules(runtimeDirectory);
  const { Pool } = require(runtimeModules.pgPath);
  const runtimeRoot = path.dirname(runtimeModules.packagePath);
  const authorityPath = path.join(runtimeRoot, 'src', 'questionAuthorityService.js');
  const expectedAuthoritySha256 = String(env.EXPECTED_QUESTION_AUTHORITY_SHA256 || '').trim();
  if (!/^[0-9a-f]{64}$/u.test(expectedAuthoritySha256)
    || crypto.createHash('sha256').update(fs.readFileSync(authorityPath)).digest('hex') !== expectedAuthoritySha256) {
    throw failure('PRODUCTION_QUESTION_REPAIR_AUTHORITY_BUILD_MISMATCH');
  }
  const { createQuestionAuthorityService } = require(authorityPath);
  const { resolveRuntimeDatabaseUser } = require(path.join(runtimeRoot, 'src', 'runtimeDatabaseRole'));
  const expectedVersion = String(env.EXPECTED_CLOUD_VERSION || '').trim();
  const tenantId = String(env.CLOUD_BUSINESS_TENANT_ID || 'default').trim();
  const appPool = new Pool(postgresConfig(env, resolveRuntimeDatabaseUser(env.POSTGRES_USER), env.POSTGRES_PASSWORD));
  const writerPool = new Pool(postgresConfig(env, 'vnext_pg17_writer', env.COMMAND_WRITER_POSTGRES_PASSWORD));
  try {
    await requireCloudHealth(fetch, expectedVersion, helper.PUBLIC_BASE_URL);
    let loaded = null;
    if (mode === 'apply') {
      loaded = await helper.loadActiveSuperAdminSession(appPool, writerPool, env.CLOUD_OPERATOR_PHONE_HMACS);
      await helper.verifyBusinessSuperAdmin(appPool, loaded.identity);
    }
    return await repairQuestions({
      mode,
      loadInventory: () => loadProductionInventory((...args) => appPool.query(...args), tenantId),
      loadReceipts: () => loadProductionRepairReceipts((...args) => appPool.query(...args), tenantId),
      submitCommands: async commands => {
        if (!loaded || !Array.isArray(commands)) throw failure('PRODUCTION_QUESTION_REPAIR_SESSION_INVALID');
        return withRepairTransaction(appPool, async currentQuery => {
          const locked = await currentQuery(
            `SELECT q.id
               FROM business.questions q
               JOIN business.question_contents c ON c.tenant_id=q.tenant_id AND c.question_id=q.id
              WHERE q.tenant_id=$1 AND q.id=ANY($2::text[])
              ORDER BY q.id FOR UPDATE OF q,c`,
            [tenantId, [...BAD_QUESTION_IDS, ...CANONICAL_QUESTION_IDS]],
          );
          if (!locked || locked.rows.length !== 16) throw failure('PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH');
          const lockedRows = await loadProductionInventory(currentQuery, tenantId);
          validateInventory(lockedRows, { repaired: null });
          const lockedById = new Map(lockedRows.map(row => [row.id, row]));
          const expectedCommands = BAD_QUESTION_IDS
            .filter(id => !lockedById.get(id).deleted)
            .map(id => buildDeleteCommand(id, Number(lockedById.get(id).version)));
          if (stableJson(expectedCommands) !== stableJson(commands)) {
            throw failure('PRODUCTION_QUESTION_REPAIR_STATE_CHANGED');
          }
          const questionAuthority = createQuestionAuthorityService({
            query: currentQuery,
            transaction: async work => work(currentQuery),
          });
          const receipts = [];
          for (const command of commands) {
            const receipt = await questionAuthority.submitDesktopDraft({
              tenantId,
              actor: { accountId: loaded.identity.accountId, roles: ['super_admin'] },
              command,
            });
            if (!plainObject(receipt) || receipt.status !== 'committed') {
              throw failure('PRODUCTION_QUESTION_REPAIR_COMMAND_REJECTED');
            }
            receipts.push(receipt);
          }
          const afterRows = await loadProductionInventory(currentQuery, tenantId);
          validateInventory(afterRows, { repaired: true });
          validateRepairReceipts(await loadProductionRepairReceipts(currentQuery, tenantId), afterRows);
          return receipts;
        });
      },
    });
  } finally {
    await Promise.allSettled([appPool.end(), writerPool.end()]);
  }
}

module.exports = Object.freeze({
  BAD_QUESTION_IDS,
  CANONICAL_QUESTION_IDS,
  EXPECTED_SNAPSHOT_SET_SHA256,
  EXPECTED_QUESTION_IDENTITIES,
  buildDeleteCommand,
  validateInventory,
  questionIdentitySetSha256,
  inventoryDiagnostics,
  validateRepairReceipts,
  repairQuestions,
  postgresConfig,
  loadProductionInventory,
  loadProductionRepairReceipts,
  requireCloudHealth,
  withRepairTransaction,
  runFromEnvironment,
});

if (require.main === module) {
  const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
  runFromEnvironment(process.env, mode).then(
    receipt => process.stdout.write(`${JSON.stringify(receipt)}\n`),
    error => {
      const details = error?.code === 'PRODUCTION_QUESTION_REPAIR_INVENTORY_MISMATCH' ? error.details : undefined;
      process.stderr.write(`${JSON.stringify({ ok: false, code: String(error?.code || 'PRODUCTION_QUESTION_REPAIR_FAILED'), ...(details ? { details } : {}) })}\n`);
      process.exitCode = 1;
    },
  );
}
