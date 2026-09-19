'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prepareImageGeometryCorrection } = require('./prepare-question-image-geometry-correction');
const { applyFormulaCorrections } = require('./apply-question-formula-corrections');
const bytes = Buffer.from('source image bytes');
const assetKey = crypto.createHash('sha256').update(bytes).digest('hex');
const sourceHash = 'a'.repeat(64), contentHash = 'b'.repeat(64);
const image = (width = null, height) => ({ type: 'image', attrs: {
  src: `question-asset://${assetKey}`, assetKey, alt: 'image2.png', align: 'center', width,
  ...(height === undefined ? {} : { height }),
} });
const doc = nodes => ({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] });
const current = {
  id: `question-import-${contentHash.slice(0, 40)}`, version: 7, status: 'published',
  subject: 'physics', type: 'choice', difficulty: 3, content: 'original stem', answer: 'A', analysis: 'original analysis',
  options: [], has_formula: true, knowledge_point_ids: ['keep'], model_point_ids: [], taxonomy_ids: {}, source: 'keep source',
  rich_content: { type: 'question-document', version: 1, sections: {
    stem: doc([{ type: 'text', text: 'unchanged' }, image()]), options: [],
    answer: doc([image(), { type: 'formula', attrs: { id: 'keep-native', canonicalLatex: 'x^2' } }]),
    analysis: doc([{ type: 'text', text: 'keep explanation' }]), subQuestions: [],
  } },
};
const sourceBefore = { sourceSha256: sourceHash, verifiedSourceSha256: sourceHash,
  taskId: 'question_import_task_verified-source', itemIndex: 3, contentHash,
  media: [{ sha256: assetKey, bytes: bytes.length, state: 'verified' }] };
const sourceAfter = { sourceSha256: sourceHash, itemIndex: 3,
  rich_content: structuredClone(current.rich_content),
  assets: [{ content_hash: assetKey, mime_type: 'image/png', data_url: `data:image/png;base64,${bytes.toString('base64')}` }],
};
sourceAfter.rich_content.sections.stem.content[0].content[1] = image(123.5, 68.25);
sourceAfter.rich_content.sections.answer.content[0].content[0] = image(61.75, 34.125);
const args = { current, baseline: structuredClone(current), sourceBefore, sourceAfter };
const build = extra => prepareImageGeometryCorrection({ ...args, ...extra });
const command = build();
assert.equal(command.type, 'question.update.v1');
assert.equal(command.payload.expectedVersion, 7);
assert.deepEqual(command, build(), 'deterministic retry command');
assert.deepEqual(current, args.baseline, 'never mutate the input');
const rich = command.payload.changes.rich_content;
assert.equal(rich.sections.stem.content[0].content[1].attrs.width, 123.5);
assert.equal(rich.sections.answer.content[0].content[0].attrs.width, 61.75, 'same asset may have different occurrence sizes');
const stripped = structuredClone(rich);
for (const node of [stripped.sections.stem.content[0].content[1], stripped.sections.answer.content[0].content[0]]) {
  node.attrs.width = null; delete node.attrs.height;
}
assert.deepEqual(stripped, current.rich_content, 'only dimensions may change');
for (const key of ['content', 'options', 'answer', 'analysis', 'knowledge_point_ids', 'taxonomy_ids', 'has_formula'])
  assert.deepEqual(command.payload.changes[key], current[key]);
assert.throws(() => build({ current: { ...current, version: 8 } }), /STATE_CHANGED/);
assert.throws(() => build({ current: { ...current, source: 'user changed metadata' } }), /STATE_CHANGED/);
for (const mutate of [
  p => { p.verifiedSourceSha256 = 'c'.repeat(64); },
  p => { p.contentHash = 'd'.repeat(64); },
  p => { p.itemIndex = 4; },
  p => { p.taskId = ''; },
  p => { p.media[0].state = 'queued'; },
  p => { p.media[0].bytes++; },
  p => { p.media[0].sha256 = 'e'.repeat(64); },
]) {
  const p = structuredClone(sourceBefore); mutate(p);
  assert.throws(() => build({ sourceBefore: p }), /SOURCE_MISMATCH/);
}
for (const mutate of [
  p => { p.sourceSha256 = 'c'.repeat(64); },
  p => { p.assets[0].data_url = 'data:image/png;base64,dGFtcGVyZWQ='; },
  p => { p.assets[0].data_url = 'https://untrusted.invalid/image.png'; },
  p => { p.assets = []; },
  p => { p.rich_content.sections.stem.content[0].content[1].attrs.alt = 'another.png'; },
  p => { p.rich_content.sections.answer.content[0].content.shift(); },
  p => { p.rich_content.sections.stem.content[0].content.reverse(); },
  p => { p.rich_content.sections.stem.content[0].content[1].attrs.width = 0; },
  p => { p.rich_content.sections.stem.content[0].content[1].attrs.height = Infinity; },
]) {
  const p = structuredClone(sourceAfter); mutate(p);
  assert.throws(() => build({ sourceAfter: p }), /SOURCE_MISMATCH/);
}
const edited = structuredClone(current);
edited.rich_content.sections.stem.content[0].content[1].attrs.width = 200;
assert.throws(() => build({ current: edited, baseline: structuredClone(edited) }), /EXISTING_GEOMETRY/);
const complete = { ...current, rich_content: structuredClone(rich) };
assert.throws(() => build({ current: complete, baseline: structuredClone(complete) }), /NO_CHANGES/);

(async () => {
  let row = structuredClone(current), posts = 0, journal, uncertain = false;
  const input = {
    plan: { schema: 'source-image-geometry-correction-review-v1', entries: [
      { id: current.id, baseline: structuredClone(current), sourceBefore, sourceAfter },
    ] },
    baseUrl: 'https://physicsedu.xyz/cloud-business', sessionToken: 'test-only', deviceId: 'test-device',
    verifyBackup: async () => ({ restoreVerified: true, ownershipAndPrivilegesVerified: true,
      sha256: 'f'.repeat(64), root: '/root/scheduling-backups/postgres/20260920-000000' }),
    persistJournal: async value => { journal = structuredClone(value); },
    fetchImpl: async (url, options) => {
      assert.ok(!url.includes('/authority/commands'));
      if (options.method === 'POST') {
        const submitted = JSON.parse(options.body); posts++;
        assert.equal(submitted.payload.expectedVersion, row.version);
        Object.assign(row, submitted.payload.changes, { version: row.version + 1 });
        if (uncertain) throw Error('lost response');
        return { ok: true, status: 200, json: async () => ({ ok: true,
          receipt: { status: 'committed', commandId: submitted.commandId, payloadHash: submitted.payloadHash } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, questions: [structuredClone(row)], nextCursor: null }) };
    },
  };
  assert.equal((await applyFormulaCorrections(input)).mode, 'dry-run'); assert.equal(posts, 0);
  await assert.rejects(applyFormulaCorrections({ ...input, execute: true, verifyBackup: async () => ({ restoreVerified: false }) }), /BACKUP/);
  row.version++; await assert.rejects(applyFormulaCorrections(input), /STATE_CHANGED/); row.version--;
  uncertain = true;
  await assert.rejects(applyFormulaCorrections({ ...input, execute: true }), /TRANSPORT_UNCERTAIN/);
  assert.equal(posts, 1); assert.ok(journal);
  uncertain = false;
  const resumed = await applyFormulaCorrections({ ...input, execute: true, journal });
  assert.equal(resumed.verifiedCount, 1); assert.equal(posts, 1, 'resume must read back, never double-write');
  assert.equal(row.version, 8); assert.equal(row.source, current.source);
  console.log('source image geometry identity, occurrence sizes, preservation, backup, CAS and resume checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
