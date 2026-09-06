'use strict';
const assert = require('node:assert/strict');
const { buildRepairPlan, contentHash, applyRepairPlan } = require('./repair-question-formula-identities');
const { verifyAfter } = require('./run-question-formula-repair');

const rich = { version: 1, type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'formula', attrs: { id: 'formula-78ff6f73e7b3 cdac5df039a9', canonicalLatex: 'x', displayMode: 'inline' } }] } } };
const row = {
  id: 'question-import-' + 'a'.repeat(40), taskId: 'question_import_task_' + 'b'.repeat(12), itemId: 'question_import_item_' + 'c'.repeat(12),
  itemHash: 'a'.repeat(64), sourceHash: 'd'.repeat(64), status: 'draft', version: 1,
  stem: 'unchanged question', options: [{ label: 'A', content: 'incomplete historical draft' }], answer: null, explanation: null,
  richContent: rich, originalRichContent: rich,
};
row.contentHash = contentHash(row, rich);
const catalogue = [{ taskId: row.taskId, formula: { id: 'formula-78ff6f73e7b3cdac5df039a9', canonical_latex: 'x' } }];

(async () => {
  const plan = buildRepairPlan([row], catalogue);
  assert.equal(plan.entries.length, 1);
  const entry = plan.entries[0];
  assert.equal(entry.replacements.length, 1);
  assert.equal(entry.after.sections.stem.content[0].attrs.id, catalogue[0].formula.id);
  assert.equal(row.richContent.sections.stem.content[0].attrs.id, 'formula-78ff6f73e7b3 cdac5df039a9', 'planning must never mutate original snapshots');
  assert.equal(entry.after.sections.stem.content[0].attrs.canonicalLatex, 'x');
  assert.deepEqual(row.options, [{ label: 'A', content: 'incomplete historical draft' }]);
  assert.equal(buildRepairPlan([row], catalogue).planHash, plan.planHash);
  const repaired = { ...row, version: 2, contentHash: entry.afterHash, richContent: entry.after };
  verifyAfter([row], [repaired], plan);
  assert.throws(() => verifyAfter([row], [{ ...repaired, answer: 'changed' }], plan), /AFTER_MISMATCH/);
  assert.throws(() => verifyAfter([row], [], plan), /AFTER_MISMATCH/);
  for (const damaged of ['formula-1 ccd47badc6837fb438e8386', 'formula-a890f436bb3481c30 acd9731', 'formula-2d4 fcd517cf1485b0d2fad8b', 'formula-d32a778 dcdc63114dd7beef8']) {
    const value = structuredClone(row);
    value.richContent.sections.stem.content[0].attrs.id = damaged;
    value.originalRichContent = structuredClone(value.richContent);
    value.contentHash = contentHash(value, value.richContent);
    const original = { taskId: value.taskId, formula: { id: damaged.replace(/ /g, ''), canonical_latex: 'x' } };
    assert.equal(buildRepairPlan([value], [original]).entries[0].replacements[0].after, original.formula.id);
  }
  for (const altered of [
    { ...row, status: 'published' }, { ...row, version: 0 }, { ...row, contentHash: '0'.repeat(64) },
    { ...row, originalRichContent: { ...rich, changed: true } }, { ...row, itemHash: 'f'.repeat(64) },
  ]) assert.throws(() => buildRepairPlan([altered], catalogue), /FORMULA_REPAIR_/);
  assert.throws(() => buildRepairPlan([row], []), /ORIGINAL_MISMATCH/);
  assert.throws(() => buildRepairPlan([row], [{ ...catalogue[0], taskId: 'different-task' }]), /ORIGINAL_MISMATCH/);
  assert.throws(() => buildRepairPlan([row], [...catalogue, { ...catalogue[0], formula: { ...catalogue[0].formula, canonical_latex: 'different' } }]), /ORIGINAL_MISMATCH/);
  assert.throws(() => buildRepairPlan([row, row], catalogue), /DUPLICATE/);

  const calls = [];
  const query = async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1, rows: [{ version: 2 }] }; };
  const receipts = await applyRepairPlan(query, plan, { tenantId: 'default', accountId: 'super-admin', roles: ['super_admin'] });
  assert.equal(receipts.length, 1);
  assert.match(calls[0].sql, /rich_content_json=\$3::jsonb/);
  assert.match(calls[0].sql, /version=\$5 AND content_hash=\$6 AND rich_content_json=\$7::jsonb/);
  assert(!calls[0].sql.includes('options_json='));
  assert(!calls[0].sql.includes('stem='));
  assert.match(calls[2].sql, /desktop_question_command_receipts/);
  await assert.rejects(applyRepairPlan(query, plan, { tenantId: 'default', accountId: 'teacher', roles: ['teacher'] }), /ACCESS_DENIED/);
  await assert.rejects(applyRepairPlan(async () => ({ rowCount: 0, rows: [] }), plan, { tenantId: 'default', accountId: 'admin', roles: ['super_admin'] }), /STATE_CHANGED/);
  console.log('question formula identity repair checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
