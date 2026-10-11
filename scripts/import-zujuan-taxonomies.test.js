'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const { validateSource, planImport, importSource } = require('./import-zujuan-taxonomies');
const source = JSON.parse(fs.readFileSync('reference-data/zujuan-high-school-2026-10-11.json', 'utf8'));
validateSource(source);
const tiny = structuredClone(source);
for (const subject of tiny.subjects) for (const system of subject.systems) system.nodes = system.nodes.slice(0, 1);
const invalid = structuredClone(tiny);
invalid.subjects[0].systems[0].nodes[0].parentId = 'unseen';
assert.throws(() => validateSource(invalid), /SOURCE_NODE_INVALID/);
const state = { taxonomy_systems: [{ id: 'manual', subject: tiny.subjects[0].subject, name: tiny.subjects[0].systems[0].name, sort_order: 0 }], taxonomy_nodes: [{ id: 'manual-node', system_id: 'manual', parent_id: null, name: 'manual', sort_order: 0 }] };
const receipts = [], order = [];
(async () => {
  const readProjection = async () => structuredClone(state);
  const result = await importSource({ source: tiny, readProjection, apply: true,
    saveBackup: async backup => { order.push('backup'); assert.equal(backup.taxonomy_nodes[0].id, 'manual-node'); },
    submit: async command => { assert.equal(order[0], 'backup'); const record = command.payload.record; (command.type.startsWith('taxonomy-system') ? state.taxonomy_systems : state.taxonomy_nodes).push(record); return { commandId: command.commandId, payloadHash: command.payloadHash, status: 'committed' }; },
    saveReceipt: async value => receipts.push(value),
  });
  assert(result.verified); assert.equal(result.systems, 22); assert.equal(result.nodes, 16);
  assert.equal(state.taxonomy_nodes.find(x => x.id === 'manual-node').name, 'manual');
  const imported = state.taxonomy_nodes.find(x => x.id.startsWith('zujuan-senior-10-knowledge'));
  assert.equal(imported.system_id, 'manual'); assert.equal(imported.sort_order, 1);
  imported.name = 'user correction';
  const rerun = planImport(tiny, state);
  assert.equal(rerun.operations.length, 0); assert(rerun.retainedEdits.includes(imported.id));
  assert.equal(receipts.length, result.committed);
  const empty = { taxonomy_systems: [], taxonomy_nodes: [] };
  await assert.rejects(importSource({ source: tiny, readProjection: async () => empty, apply: true, saveBackup: async () => {}, saveReceipt: async () => { throw new Error('must not save rejected receipt'); }, submit: async () => ({ status: 'rejected' }) }), /IMPORT_RECEIPT_REJECTED/);
  await assert.rejects(importSource({ source: tiny, readProjection: async () => { throw new Error('ACCESS_DENIED'); }, apply: true, saveBackup: async () => { throw new Error('must not mutate without authenticated read'); } }), /ACCESS_DENIED/);
  console.log('taxonomy import validation, backup, readback, idempotence and denial checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
