'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableJson } = require('../shared/authorityProtocol');
const DEFAULT_SOURCE = path.join(__dirname, '../reference-data/zujuan-high-school-2026-10-11.json');
const hash = value => crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');

function validateSource(source) {
  if (source?.schemaVersion !== 1 || !Array.isArray(source.subjects) || source.subjects.length !== 11) throw new Error('SOURCE_INVALID');
  const subjects = new Set();
  for (const subject of source.subjects) {
    if (!/^\d+$/.test(subject.bankId) || !subject.subject || subjects.has(subject.subject) || subject.systems.length !== 2) throw new Error('SUBJECT_INVALID');
    subjects.add(subject.subject);
    const kinds = new Set();
    for (const system of subject.systems) {
      if (!['knowledge', 'method'].includes(system.kind) || kinds.has(system.kind) || !Array.isArray(system.nodes) || !/^[a-f0-9]{64}$/.test(system.sourceSha256)) throw new Error('SYSTEM_INVALID');
      kinds.add(system.kind);
      if (system.kind === 'knowledge' && (!system.nodes.length || system.sourceStatus !== 200)) throw new Error('KNOWLEDGE_SOURCE_MISSING');
      if (system.nodes.length && system.sourceStatus !== 200) throw new Error('SOURCE_STATUS_INVALID');
      const seen = new Set();
      for (const node of system.nodes) {
        if (!/^\d+$/.test(node.sourceId) || seen.has(node.sourceId) || typeof node.name !== 'string' || !node.name.trim() || node.name.length > 256
          || !Number.isSafeInteger(node.sortOrder) || node.sortOrder < 0 || (node.parentId !== null && !seen.has(node.parentId))) throw new Error('SOURCE_NODE_INVALID');
        seen.add(node.sourceId);
      }
      if (system.nodes.filter(n => n.parentId === null).length !== (system.nodes.length ? 1 : 0)) throw new Error('SOURCE_ROOT_INVALID');
    }
  }
  return source;
}

function planImport(source, projection) {
  validateSource(source);
  if (!Array.isArray(projection?.taxonomy_systems) || !Array.isArray(projection?.taxonomy_nodes)) throw new Error('PROJECTION_INVALID');
  const operations = [], retainedEdits = [], systemIds = [], nodeIds = [];
  const systemMap = new Map(projection.taxonomy_systems.map(x => [x.id, x]));
  const nodeMap = new Map(projection.taxonomy_nodes.map(x => [x.id, x]));
  for (const subject of source.subjects) for (const system of subject.systems) {
    const fallbackId = `zujuan-senior-${subject.bankId}-${system.kind}`;
    const existing = projection.taxonomy_systems.find(x => x.subject === subject.subject && x.name.toLocaleLowerCase() === system.name.toLocaleLowerCase()) || systemMap.get(fallbackId);
    if (existing && existing.subject !== subject.subject) throw new Error('SYSTEM_ID_COLLISION');
    const systemId = existing?.id || fallbackId;
    systemIds.push(systemId);
    if (!existing) operations.push({ type: 'taxonomy-system.create.v1', record: { id: systemId, subject: subject.subject, name: system.name, sort_order: Math.max(-1, ...projection.taxonomy_systems.filter(x => x.subject === subject.subject).map(x => x.sort_order)) + (system.kind === 'method' ? 2 : 1) } });
    const importedId = id => `zujuan-senior-${subject.bankId}-${system.kind}-${id}`;
    const rootId = system.nodes[0] && importedId(system.nodes[0].sourceId);
    const rootOffset = nodeMap.has(rootId) ? nodeMap.get(rootId).sort_order : Math.max(-1, ...projection.taxonomy_nodes.filter(x => x.system_id === systemId && !x.parent_id).map(x => x.sort_order)) + 1;
    for (const node of system.nodes) {
      const record = { id: importedId(node.sourceId), system_id: systemId, parent_id: node.parentId === null ? null : importedId(node.parentId), name: node.name.trim(), sort_order: node.parentId === null ? rootOffset : node.sortOrder };
      nodeIds.push(record.id);
      const previous = nodeMap.get(record.id);
      if (previous) {
        if (previous.system_id !== systemId) throw new Error('NODE_ID_COLLISION');
        if (['parent_id', 'name', 'sort_order'].some(key => previous[key] !== record[key])) retainedEdits.push(record.id);
        continue; // A later manual correction always wins over this reference.
      }
      operations.push({ type: 'taxonomy-node.create.v1', record });
    }
  }
  return { operations, retainedEdits, systemIds, nodeIds };
}

function commandFor(operation) {
  const payload = { record: operation.record };
  const payloadHash = hash({ type: operation.type, payload });
  return { commandId: `zujuan-import-${payloadHash.slice(0, 48)}`, payloadHash, type: operation.type, payload };
}

async function importSource({ source, readProjection, submit, saveBackup, saveReceipt, apply = false, progress = () => {} }) {
  validateSource(source);
  const before = await readProjection();
  const plan = planImport(source, before);
  if (!apply) return { dryRun: true, createCount: plan.operations.length, systems: plan.systemIds.length, nodes: plan.nodeIds.length, retainedEdits: plan.retainedEdits };
  await saveBackup({ sourceHash: hash(source), createdAt: new Date().toISOString(), taxonomy_systems: before.taxonomy_systems, taxonomy_nodes: before.taxonomy_nodes });
  let committed = 0;
  for (const operation of plan.operations) {
    const command = commandFor(operation);
    const receipt = await submit(command);
    if (receipt?.status !== 'committed' || receipt.commandId !== command.commandId || receipt.payloadHash !== command.payloadHash) throw new Error('IMPORT_RECEIPT_REJECTED');
    await saveReceipt({ commandId: command.commandId, payloadHash: command.payloadHash, type: command.type, id: operation.record.id, receipt });
    committed++;
    if (committed % 100 === 0) progress({ committed, total: plan.operations.length });
  }
  const after = await readProjection();
  const systems = new Set(after.taxonomy_systems.map(x => x.id));
  const nodes = new Set(after.taxonomy_nodes.map(x => x.id));
  if (plan.systemIds.some(id => !systems.has(id)) || plan.nodeIds.some(id => !nodes.has(id))) throw new Error('IMPORT_READBACK_INCOMPLETE');
  for (const operation of plan.operations) {
    const actual = (operation.type.startsWith('taxonomy-system') ? after.taxonomy_systems : after.taxonomy_nodes).find(x => x.id === operation.record.id);
    if (Object.keys(operation.record).some(key => actual[key] !== operation.record[key])) throw new Error('IMPORT_READBACK_CHANGED');
  }
  return { verified: true, committed, systems: plan.systemIds.length, nodes: plan.nodeIds.length, retainedEdits: plan.retainedEdits };
}

async function main() {
  const args = process.argv.slice(2), apply = args.includes('--apply');
  const source = validateSource(JSON.parse(fs.readFileSync(DEFAULT_SOURCE, 'utf8')));
  if (!apply && !args.includes('--check-cloud')) {
    console.log(JSON.stringify(importSourceSummary(source))); return;
  }
  const token = String(process.env.GEWU_TAXONOMY_SESSION_TOKEN || '');
  if (!token) throw new Error('ACTIVE_ADMIN_SESSION_REQUIRED');
  const base = 'https://physicsedu.xyz/cloud-business';
  const request = async (route, body) => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(`IMPORT_HTTP_${response.status}_${result.code || 'UNKNOWN'}`);
    return result;
  };
  const out = path.join(__dirname, '../tmp/zujuan-import-' + new Date().toISOString().replace(/[^0-9]/g, ''));
  if (apply) fs.mkdirSync(out, { recursive: true });
  const result = await importSource({ source, apply, readProjection: async () => (await request('/api/business/desktop-projection')).projection,
    submit: async command => (await request('/api/desktop/question-bank/commands', command)).receipt,
    saveBackup: async backup => fs.writeFileSync(path.join(out, 'taxonomy-before.json'), JSON.stringify(backup, null, 2), { encoding: 'utf8', flag: 'wx' }),
    saveReceipt: async receipt => fs.appendFileSync(path.join(out, 'receipts.jsonl'), JSON.stringify(receipt) + '\n', 'utf8'), progress: value => console.log(JSON.stringify(value)) });
  if (apply) fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ ...result, ...(apply ? { evidence: out } : {}) }));
}

function importSourceSummary(source) { return { sourceValidated: true, subjects: source.subjects.length, systems: source.subjects.length * 2, nodes: source.subjects.reduce((count, subject) => count + subject.systems.reduce((n, system) => n + system.nodes.length, 0), 0) }; }
module.exports = { validateSource, planImport, commandFor, importSource };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
