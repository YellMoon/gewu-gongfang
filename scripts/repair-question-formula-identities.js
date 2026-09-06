'use strict';

const crypto = require('node:crypto');

function failure(code) { return Object.assign(new Error(`FORMULA_REPAIR_${code}`), { code: `FORMULA_REPAIR_${code}` }); }
function stableJson(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw failure('INPUT_INVALID');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}
function hash(value) { return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex'); }
function contentHash(row, richContent) {
  return hash({ stem: row.stem, answer: row.answer, explanation: row.explanation, options: row.options, richContent });
}

// One-time maintenance planner. It deliberately does not fix options, text,
// answers or LaTeX, and is not exposed as a desktop/miniapp mutation API.
function buildRepairPlan(rows, catalogue) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || !Array.isArray(catalogue)) throw failure('INPUT_INVALID');
  const ids = new Set();
  const entries = [];
  for (const row of rows) {
    if (!row || !/^question-import-[a-f0-9]{40}$/u.test(row.id || '') || row.status !== 'draft'
      || !Number.isSafeInteger(row.version) || row.version < 1
      || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/u.test(row.taskId || '')
      || !/^question_import_item_[A-Za-z0-9_-]{1,128}$/u.test(row.itemId || '')
      || !/^[a-f0-9]{64}$/u.test(row.sourceHash || '') || !/^[a-f0-9]{64}$/u.test(row.itemHash || '')
      || row.id !== 'question-import-' + row.itemHash.slice(0, 40)
      || stableJson(row.richContent) !== stableJson(row.originalRichContent)
      || row.contentHash !== contentHash(row, row.richContent)) throw failure('BASELINE_MISMATCH');
    if (ids.has(row.id)) throw failure('DUPLICATE');
    ids.add(row.id);
    const after = JSON.parse(stableJson(row.richContent));
    const replacements = [];
    function visit(node, location = [], depth = 0) {
      if (!node || typeof node !== 'object') return;
      if (depth > 40) throw failure('INPUT_INVALID');
      if (node.type === 'formula' || node.type === 'formulaBlock') {
        const oldId = node.attrs?.id;
        if (typeof oldId === 'string' && /\s/u.test(oldId)) {
          // Reproduce only the known old physics-unit formatter's inserted space.
          const newId = oldId.replace(/(?<=[0-9]) (?=(?:da|[adcf])?cd)/gu, '');
          if (newId === oldId || !/^formula-[a-f0-9]{24}$/u.test(newId)) throw failure('ORIGINAL_MISMATCH');
          const originals = new Map(catalogue
            .filter(item => item.taskId === row.taskId && item.formula?.id === newId)
            .map(item => [stableJson(item.formula), item.formula]));
          if (originals.size !== 1) throw failure('ORIGINAL_MISMATCH');
          replacements.push({ path: [...location, 'attrs', 'id'], before: oldId, after: newId, originalHash: hash([...originals.values()][0]) });
          node.attrs.id = newId;
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) value.forEach((child, i) => visit(child, [...location, key, i], depth + 1));
        else if (value && typeof value === 'object') visit(value, [...location, key], depth + 1);
      }
    }
    visit(after);
    if (replacements.length) entries.push({
      id: row.id, expectedVersion: row.version, beforeHash: row.contentHash, afterHash: contentHash(row, after),
      sourceHash: row.sourceHash, taskId: row.taskId, itemId: row.itemId,
      before: row.richContent, after, replacements,
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { schema: 'gewu.formula-identity-repair.v1', planHash: hash(entries), entries };
}

// Caller must run this inside one transaction after reloading/locking the exact
// reviewed records and verifying the real cloud super-admin and backup receipt.
async function applyRepairPlan(query, plan, actor) {
  if (!actor?.roles?.includes('super_admin') || !actor.accountId || !actor.tenantId) throw failure('ACCESS_DENIED');
  if (typeof query !== 'function' || plan?.schema !== 'gewu.formula-identity-repair.v1'
    || !Array.isArray(plan.entries) || plan.entries.length < 1 || plan.planHash !== hash(plan.entries)) throw failure('PLAN_INVALID');
  const receipts = [];
  for (const entry of plan.entries) {
    const changed = await query(`UPDATE business.question_contents
      SET rich_content_json=$3::jsonb,content_hash=$4,version=version+1,updated_at=transaction_timestamp()
      WHERE tenant_id=$1 AND question_id=$2 AND version=$5 AND content_hash=$6 AND rich_content_json=$7::jsonb AND deleted=false
      RETURNING version`, [actor.tenantId, entry.id, stableJson(entry.after), entry.afterHash, entry.expectedVersion, entry.beforeHash, stableJson(entry.before)]);
    if (changed.rowCount !== 1 || Number(changed.rows[0]?.version) !== entry.expectedVersion + 1) throw failure('STATE_CHANGED');
    const question = await query(`UPDATE business.questions SET updated_at=transaction_timestamp()
      WHERE tenant_id=$1 AND id=$2 AND status='draft' AND deleted=false`, [actor.tenantId, entry.id]);
    if (question.rowCount !== 1) throw failure('STATE_CHANGED');
    const result = {
      id: entry.id, status: 'draft', version: entry.expectedVersion + 1, contentHash: entry.afterHash,
      maintenance: 'restore-original-formula-identities', previousContentHash: entry.beforeHash,
      planHash: plan.planHash, restoredIdentityCount: entry.replacements.length,
      originalSourceHash: entry.sourceHash, originalItemId: entry.itemId,
    };
    const commandId = `formula-identity-repair-${hash({ id: entry.id, planHash: plan.planHash }).slice(0, 48)}`;
    const receipt = await query(`INSERT INTO business.desktop_question_command_receipts
      (tenant_id,command_id,payload_hash,status,result_json,result_hash,actor_account_id)
      VALUES ($1,$2,$3,'committed',$4::jsonb,$5,$6)`, [actor.tenantId, commandId, hash(entry), stableJson(result), hash(result), actor.accountId]);
    if (receipt.rowCount !== 1) throw failure('RECEIPT_FAILED');
    receipts.push({ commandId, resultHash: hash(result), ...result });
  }
  return receipts;
}

module.exports = { buildRepairPlan, contentHash, applyRepairPlan, stableJson, hash };
