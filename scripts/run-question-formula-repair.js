'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildRepairPlan, applyRepairPlan, contentHash, stableJson, hash } = require('./repair-question-formula-identities');
const { postgresConfig, requireCloudHealth } = require('./repair-production-question-duplicates');
const EXPECTED_PLAN = 'cb112c545c2f9973556b2101a54b5d37c3c9525feb25eb6d288ed0f41a6a2e2e';

async function loadRows(query, tenantId, ids) {
  // Lock before loading originals; the plan hash also guards candidate/source changes.
  await query(`SELECT q.id FROM business.questions q JOIN business.question_contents c
    ON c.tenant_id=q.tenant_id AND c.question_id=q.id
    WHERE q.tenant_id=$1 AND q.id=ANY($2::text[]) ORDER BY q.id FOR UPDATE OF q,c`, [tenantId, ids]);
  return (await query(`SELECT q.id,q.status,c.version,c.content_hash AS "contentHash",
    c.rich_content_json AS "richContent",c.stem,c.options_json AS options,c.answer,c.explanation,
    i.item_id AS "itemId",i.import_task_id AS "taskId",i.content_hash AS "itemHash",
    i.candidate_json->'rich_content' AS "originalRichContent",t.source_sha256 AS "sourceHash"
    FROM business.questions q JOIN business.question_contents c ON c.question_id=q.id AND c.tenant_id=q.tenant_id
    JOIN business.question_import_items i ON q.id='question-import-'||left(i.content_hash,40)
    JOIN business.question_import_tasks t ON t.task_id=i.import_task_id AND t.tenant_id=q.tenant_id
    WHERE q.tenant_id=$1 AND q.id=ANY($2::text[]) AND q.deleted=false AND c.deleted=false ORDER BY q.id`, [tenantId, ids])).rows;
}

function verifyAfter(before, after, plan) {
  if (after.length !== before.length) throw new Error('FORMULA_REPAIR_AFTER_MISMATCH');
  const entries = new Map(plan.entries.map(entry => [entry.id, entry]));
  for (const row of before) {
    const entry = entries.get(row.id);
    const expected = entry ? { ...row, version: row.version + 1, contentHash: entry.afterHash, richContent: entry.after } : row;
    const actual = after.find(value => value.id === row.id);
    if (stableJson(actual) !== stableJson(expected) || actual.contentHash !== contentHash(actual, actual.richContent)) {
      throw new Error('FORMULA_REPAIR_AFTER_MISMATCH');
    }
  }
}

async function run(env = process.env, mode = 'dry-run') {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('FORMULA_REPAIR_MODE_INVALID');
  const helper = require('./real-cloud-business-acceptance');
  const runtimeDirectory = /^question-repair-[0-9a-f]{32}$/u.test(path.basename(__dirname)) ? path.dirname(__dirname) : __dirname;
  const runtime = helper.resolveRuntimeModules(runtimeDirectory);
  const root = path.dirname(runtime.packagePath);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/questionAuthorityService.js'))).digest('hex');
  if (digest !== env.EXPECTED_QUESTION_AUTHORITY_SHA256) throw new Error('FORMULA_REPAIR_BUILD_MISMATCH');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'reviewed-originals.json'), 'utf8'));
  const ids = baseline.map(row => row.id);
  if (ids.length !== 86 || new Set(ids).size !== 86 || ids.some(id => !/^question-import-[a-f0-9]{40}$/u.test(id))) throw new Error('FORMULA_REPAIR_SCOPE_INVALID');
  const backup = mode === 'apply' ? JSON.parse(fs.readFileSync(path.join(__dirname, 'verified-backup.json'), 'utf8')) : null;
  if (mode === 'apply' && (backup?.restoreVerified !== true || !/^[a-f0-9]{64}$/u.test(backup.sha256)
    || !/^\/root\/scheduling-backups\/postgres\/\d{8}-\d{6}$/u.test(backup.root))) throw new Error('FORMULA_REPAIR_BACKUP_INVALID');
  const { Pool } = require(runtime.pgPath);
  const { resolveRuntimeDatabaseUser } = require(path.join(root, 'src/runtimeDatabaseRole'));
  const pool = new Pool(postgresConfig(env, resolveRuntimeDatabaseUser(env.POSTGRES_USER), env.POSTGRES_PASSWORD));
  const writer = new Pool(postgresConfig(env, 'vnext_pg17_writer', env.COMMAND_WRITER_POSTGRES_PASSWORD));
  let client;
  try {
    await requireCloudHealth(fetch, env.EXPECTED_CLOUD_VERSION, helper.PUBLIC_BASE_URL);
    const loaded = await helper.loadActiveSuperAdminSession(pool, writer, env.CLOUD_OPERATOR_PHONE_HMACS);
    await helper.verifyBusinessSuperAdmin(pool, loaded.identity);
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('gewu-formula-identity-repair-v1',0))");
    const query = (...args) => client.query(...args);
    const role = (await query("SELECT current_user AS name,pg_has_role(current_user,'vnext_pg17_business_owner','MEMBER') AS owns,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser")).rows[0];
    if (role.owns || role.superuser) throw new Error('FORMULA_REPAIR_PRIVILEGE_INVALID');
    const tenantId = String(env.CLOUD_BUSINESS_TENANT_ID || 'default').trim();
    const before = await loadRows(query, tenantId, ids);
    if (before.length !== 86) throw new Error('FORMULA_REPAIR_SCOPE_CHANGED');
    const catalogue = (await query(`SELECT i.import_task_id AS "taskId",f AS formula FROM business.question_import_items i
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.candidate_json->'formulas','[]')) f
      JOIN business.question_import_tasks t ON t.task_id=i.import_task_id
      WHERE t.tenant_id=$1 AND i.import_task_id=ANY($2::text[])`, [tenantId, [...new Set(before.map(row => row.taskId))]])).rows;
    const plan = buildRepairPlan(before, catalogue);
    if (plan.planHash !== EXPECTED_PLAN || plan.entries.length !== 82 || plan.entries.reduce((n, entry) => n + entry.replacements.length, 0) !== 126) throw new Error('FORMULA_REPAIR_PLAN_CHANGED');
    const receipts = mode === 'apply' ? await applyRepairPlan(query, plan, { tenantId, accountId: loaded.identity.accountId, roles: ['super_admin'] }) : [];
    verifyAfter(before, await loadRows(query, tenantId, ids), mode === 'apply' ? plan : { entries: [] });
    if (mode === 'apply') {
      const saved = (await query(`SELECT command_id AS "commandId",result_json AS result,result_hash AS "resultHash",actor_account_id AS actor
        FROM business.desktop_question_command_receipts WHERE tenant_id=$1 AND command_id=ANY($2::text[])`, [tenantId, receipts.map(row => row.commandId)])).rows;
      if (saved.length !== 82 || saved.some(row => row.actor !== loaded.identity.accountId || row.resultHash !== hash(row.result)
        || !receipts.some(receipt => receipt.commandId === row.commandId && receipt.resultHash === row.resultHash))) throw new Error('FORMULA_REPAIR_RECEIPT_MISMATCH');
    }
    await query(mode === 'apply' ? 'COMMIT' : 'ROLLBACK');
    return { ok: true, mode, planHash: plan.planHash, questionCount: 82, identityCount: 126, receiptCount: receipts.length, unchangedFieldsVerified: true, runtimeRole: role.name, backup };
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await Promise.allSettled([pool.end(), writer.end()]);
  }
}

module.exports = { verifyAfter, run };
if (require.main === module) run(process.env, process.argv.includes('--apply') ? 'apply' : 'dry-run')
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || error.message })); process.exitCode = 1; });
