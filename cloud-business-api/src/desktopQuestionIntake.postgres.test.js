'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createDisposablePg17Runtime, withVNextPg17SyntheticQuery } = require('../../shared/vnext-pg17/disposableRuntime');
const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');
const { createStorageTaskRepository } = require('./storageTaskRepository');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function relay(sha256, bytes) {
  const ciphertext = Buffer.from('encrypted:' + sha256);
  return { agentKeyFingerprint: 'b'.repeat(64), ciphertext, expiresAt: new Date(Date.now() + 600000).toISOString(), envelope: {
    version: 'x25519-aes-256-gcm-v1', ephemeralPublicKey: Buffer.alloc(44, 1).toString('base64url'),
    keyDerivationSalt: Buffer.alloc(16, 2).toString('base64url'), wrappedKeyNonce: Buffer.alloc(12, 3).toString('base64url'),
    wrappedKeyCiphertext: Buffer.alloc(32, 4).toString('base64url'), wrappedKeyTag: Buffer.alloc(16, 5).toString('base64url'),
    contentNonce: Buffer.alloc(12, 6).toString('base64url'), contentTag: Buffer.alloc(16, 7).toString('base64url'),
    ciphertextSha256: digest(ciphertext), ciphertextBytes: ciphertext.length, plaintextSha256: sha256, plaintextBytes: bytes,
  } };
}
function source(suffix, candidates) {
  const sha256 = digest('unchanged original ' + suffix);
  return { sourceType: 'exam', sourceFileName: suffix + '.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceSha256: sha256, sourceBytes: 100, metadata: { cleanupAudit: { removed: 2 } },
    storage: { taskId: 'task_source_' + suffix, objectId: 'obj_source_' + suffix, objectVersion: 1 }, relay: relay(sha256, 100),
    parsed: { parserSha256: '9'.repeat(64), candidates } };
}
const teacher = { accountId: 'teacher-1', roles: ['teacher'] };
const imageHash = digest('image');
const candidate = { contentHash: '0'.repeat(64), candidate: { stem: 'What is force?', answer: 'A', question_types: ['single'],
  options: [{ label: 'A', content: 'Mass times acceleration' }, { label: 'B', content: 'Velocity' }],
  assets: [{ assetIndex: 0, assetType: 'image', fileName: 'diagram.png', mimeType: 'image/png', sizeBytes: 5, contentHash: imageHash }] },
  validation: { status: 'rejected', codes: ['client_invented'] }, mediaManifest: [{ sha256: imageHash, bytes: 5, mimeType: 'image/png' }] };
const doc = value => ({ type: 'doc', content: value ? [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] : [] });
function richDocument() {
  return { version: 1, type: 'question-document', sections: { stem: doc('Canonical stem'), answer: doc('A'), analysis: doc('Canonical explanation'),
    options: [{ id: 'o-1', label: 'A', isCorrect: true, content: doc('First') }, { id: 'o-2', label: 'B', isCorrect: false, content: doc('Second') }], subQuestions: [] } };
}

(async () => {
  const migrationName = '20261006-desktop-question-intake.sql';
  assert.ok(fs.existsSync(path.join(__dirname, '../sql', migrationName)), 'desktop processing needs its migration');
  const runtime = createDisposablePg17Runtime();
  await runtime.start();
  const handle = await runtime.createIsolatedHandle();
  try {
    await withVNextPg17SyntheticQuery(handle, 'fixture-provisioner', async facade => {
      await facade.query(`CREATE SCHEMA business; CREATE ROLE gewu_cloud_schedule_reader;
        CREATE TABLE business.tenants(id text PRIMARY KEY); INSERT INTO business.tenants VALUES ('default'),('other');
        CREATE TABLE business.storage_agent_runtime_receipts(receipt_id text PRIMARY KEY,parser_sha256 text);
        CREATE TABLE business.encrypted_storage_relays(task_id text,envelope_json jsonb,ciphertext bytea,expires_at timestamptz);
        CREATE TABLE business.encrypted_paper_export_artifact_relays(storage_task_id text,envelope_json jsonb,ciphertext bytea,expires_at timestamptz);
        CREATE TABLE business.paper_export_artifacts(artifact_id text,storage_task_id text,storage_state text,verified_at timestamptz);
        CREATE TABLE business.paper_export_tasks(result_artifact_id text,status text,phase text,progress integer,updated_at timestamptz);
        CREATE TABLE business.question_assets(id text,storage_object_id text,storage_object_version integer,state text,deleted boolean,updated_at timestamptz);`);
      for (const name of ['20260822-storage-agent-tasks.sql','20260823-cloud-question-import-tasks.sql','20260823-question-import-media-objects.sql',
        '20260823-encrypted-import-source-relay.sql','20260823-storage-agent-least-privilege.sql','20260827-question-import-task-provisioning.sql',
        '20260828-question-import-receipt-returning-provisioning.sql','20260828-storage-agent-receipt-returning-provisioning.sql',
        '20260905-zz-question-import-parser-proof-binding.sql',migrationName]) {
        await facade.query(fs.readFileSync(path.join(__dirname, '../sql', name), 'utf8'));
      }
      await facade.query(`GRANT USAGE ON SCHEMA business TO gewu_cloud_schedule_reader;
        GRANT SELECT,UPDATE,DELETE ON business.encrypted_storage_relays,business.encrypted_paper_export_artifact_relays,
          business.paper_export_artifacts,business.paper_export_tasks,business.question_assets TO gewu_cloud_schedule_reader;
        SET ROLE gewu_cloud_schedule_reader;`);
      let sequence = 0;
      const query = (sql, values) => facade.query(sql, values);
      const imports = createQuestionImportTaskRepository({ query, randomId: () => 'desktop_pg_' + (++sequence) });
      const storage = createStorageTaskRepository({ query, randomId: () => 'storage_pg_' + (++sequence) });
      const request = source('desktop001', [candidate]);
      const input = { tenantId: 'default', actor: teacher, idempotencyKey: 'desktop-key', request };
      for (const rich of [
        { ...richDocument(), version: 2 },
        { ...richDocument(), sections: { ...richDocument().sections, stem: { type: 'doc', content: [{ type: 'script', text: 'unsafe' }] } } },
        { ...richDocument(), sections: { ...richDocument().sections, stem: { type: 'doc', content: [{ type: 'image', attrs: { assetKey: imageHash, src: 'https://example.invalid/remote.png' } }] } } },
        { ...richDocument(), sections: { ...richDocument().sections, stem: { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'alert(1)' }, content: [] }] } } },
        { ...richDocument(), sections: { ...richDocument().sections, stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bad link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } } },
      ]) {
        await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, parsed: { ...request.parsed,
          candidates: [{ ...candidate, candidate: { ...candidate.candidate, rich_content: rich } }] } } }), /INPUT_INVALID/, 'untrusted rich documents must fail before reserving any source or media');
      }
      for (const richNode of [{ type: 'image', attrs: { assetKey: imageHash, src: 'question-asset://' + imageHash } },
        { type: 'formulaBlock', attrs: { id: 'unbound-preview', canonicalLatex: '', displayMode: 'block', conversionStatus: 'preview_only', previewRef: 'question-asset://' + imageHash } },
        { type: 'image', attrs: { assetKey: '1'.repeat(64), src: 'question-asset://' + '1'.repeat(64) } }]) {
        const rich = richDocument(); rich.sections.stem.content.push(richNode);
        const descriptor = richNode.type === 'image' && richNode.attrs.assetKey !== imageHash ? candidate.candidate.assets : [];
        const manifest = descriptor.length ? candidate.mediaManifest : [];
        await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, parsed: { ...request.parsed, candidates: [{ ...candidate,
          candidate: { ...candidate.candidate, rich_content: rich, assets: descriptor }, mediaManifest: manifest }] } } }), /INPUT_INVALID/, 'each retained image or formula preview must have an allocated matching manifest');
      }
      await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, sourceSha256: '1'.repeat(64) } }), /INPUT_INVALID/);
      await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, relay: { ...request.relay, ciphertext: Buffer.from('tampered') } } }), /INPUT_INVALID/);
      await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, relay: { ...request.relay, expiresAt: new Date(Date.now() - 1000).toISOString() } } }), /INPUT_INVALID/);
      await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, parsed: { ...request.parsed,
        candidates: [{ ...candidate, mediaManifest: [{ sha256: '1'.repeat(64), bytes: 5, mimeType: 'image/png' }] }] } } }), /INPUT_INVALID/);
      assert.strictEqual((await facade.query('SELECT count(*)::integer AS count FROM business.question_import_tasks')).rows[0].count, 0, 'invalid desktop requests must reserve nothing');
      const created = await imports.createParsed(input);
      assert.strictEqual(created.status, 'awaiting_source_storage');
      assert.strictEqual(created.mediaTargets.length, 1);
      assert.strictEqual((await imports.createParsed(input)).replayed, true);
      const concurrentInput = { ...input, idempotencyKey: 'concurrent-key', request: source('parallel001', [{ ...candidate,
        candidate: { stem: 'Concurrent import', answer: 'Answer' }, mediaManifest: [] }]) };
      const concurrent = await Promise.all([imports.createParsed(concurrentInput), imports.createParsed(concurrentInput)]);
      assert.strictEqual(concurrent[0].taskId, concurrent[1].taskId, 'concurrent idempotency must reserve exactly one task');
      // Keep the remainder focused on the media import and remove the unused concurrent source lease.
      await facade.query("UPDATE business.storage_object_tasks SET state='quarantined' WHERE task_id=$1", [concurrentInput.request.storage.taskId]);
      assert.strictEqual((await facade.query('SELECT count(*)::integer AS count FROM business.question_import_items')).rows[0].count, 2);
      await assert.rejects(() => imports.createParsed({ ...input, request: { ...request, parsed: { ...request.parsed, parserSha256: '8'.repeat(64) } } }), /CONFLICT/);
      await assert.rejects(() => imports.createParsed({ ...input, actor: { accountId: 'student', roles: ['student'] } }), /ACCESS_DENIED/);
      await assert.rejects(() => imports.read({ tenantId: 'other', actor: teacher, taskId: created.taskId }), /NOT_FOUND/);
      await assert.rejects(() => imports.read({ tenantId: 'default', actor: { accountId: 'teacher-2', roles: ['teacher'] }, taskId: created.taskId }), /NOT_FOUND/);
      let read = await imports.read({ tenantId: 'default', actor: teacher, taskId: created.taskId });
      assert.strictEqual(read.items[0].validation.status, 'accepted', 'cloud must disregard caller validation');
      assert.notStrictEqual(read.items[0].contentHash, candidate.contentHash, 'cloud must recompute candidate digest');
      assert.strictEqual(read.mediaTargets.length, 1, 'targets remain available for media upload retry');
      assert.deepStrictEqual((await facade.query('SELECT processing_location,local_parser_sha256,parser_contract_version,parser_sha256 FROM business.question_import_tasks WHERE task_id=$1', [created.taskId])).rows[0],
        { processing_location: 'desktop', local_parser_sha256: '9'.repeat(64), parser_contract_version: 0, parser_sha256: null });
      await assert.rejects(() => facade.query("UPDATE business.question_import_tasks SET local_parser_sha256=$1", ['8'.repeat(64)]), /immutable/);
      await assert.rejects(() => imports.prepareDrafts({ tenantId: 'default', actor: teacher, taskId: created.taskId }), /NOT_CONFIRMABLE/);
      const sourceLease = await storage.leaseNext({ agentId: 'storage-agent-1' });
      assert.strictEqual(sourceLease.kind, 'relay', 'NAS must never parse a desktop source');
      assert.strictEqual(sourceLease.importTaskId, undefined);
      assert.deepStrictEqual((await storage.downloadRelay({ agentId: 'storage-agent-1', taskId: sourceLease.taskId, leaseToken: sourceLease.leaseToken })).ciphertext, request.relay.ciphertext);
      await assert.rejects(() => imports.completeSourceAndStoreCandidates({ taskId: created.taskId, agentId: 'storage-agent-1', leaseToken: sourceLease.leaseToken,
        observedSha256: request.sourceSha256, observedBytes: request.sourceBytes, candidates: [candidate] }), /SOURCE_UNVERIFIED/);
      await storage.complete({ agentId: 'storage-agent-1', taskId: sourceLease.taskId, leaseToken: sourceLease.leaseToken, observedSha256: request.sourceSha256, observedBytes: request.sourceBytes });
      assert.strictEqual(await storage.leaseNext({ agentId: 'storage-agent-1' }), null, 'unstaged desktop media cannot use NAS reparse path');
      await assert.rejects(() => imports.prepareDrafts({ tenantId: 'default', actor: teacher, taskId: created.taskId }), /NOT_CONFIRMABLE/);
      const target = created.mediaTargets[0];
      const stage = { tenantId: 'default', actor: teacher, taskId: created.taskId, mediaId: target.mediaId, relay: relay(imageHash, 5) };
      await assert.rejects(() => imports.stageMediaRelay({ ...stage, actor: { accountId: 'teacher-2', roles: ['teacher'] } }), /NOT_FOUND/);
      await assert.rejects(() => imports.stageMediaRelay({ ...stage, relay: relay('1'.repeat(64), 5) }), /INPUT_INVALID/);
      await imports.stageMediaRelay(stage);
      assert.strictEqual((await imports.stageMediaRelay(stage)).replayed, true);
      await assert.rejects(() => imports.stageMediaRelay({ ...stage, relay: { ...stage.relay, agentKeyFingerprint: 'a'.repeat(64) } }), /CONFLICT/);
      const reencrypted = { ...stage.relay, ciphertext: Buffer.from('new ciphertext'), envelope: { ...stage.relay.envelope,
        ciphertextSha256: digest('new ciphertext'), ciphertextBytes: Buffer.byteLength('new ciphertext') } };
      await imports.stageMediaRelay({ ...stage, relay: reencrypted });
      const mediaLease = await storage.leaseNext({ agentId: 'storage-agent-1' });
      assert.strictEqual(mediaLease.kind, 'relay');
      assert.strictEqual(mediaLease.taskId, target.storageTaskId);
      await assert.rejects(() => imports.stageMediaRelay(stage), /CONFLICT/, 'leased media ciphertext cannot be replaced');
      assert.deepStrictEqual((await storage.downloadRelay({ agentId: 'storage-agent-1', taskId: mediaLease.taskId, leaseToken: mediaLease.leaseToken })).ciphertext, reencrypted.ciphertext);
      await assert.rejects(() => storage.complete({ agentId: 'storage-agent-1', taskId: mediaLease.taskId, leaseToken: mediaLease.leaseToken, observedSha256: imageHash, observedBytes: 6 }), /MISMATCH/);
      await storage.complete({ agentId: 'storage-agent-1', taskId: mediaLease.taskId, leaseToken: mediaLease.leaseToken, observedSha256: imageHash, observedBytes: 5 });
      read = await imports.read({ tenantId: 'default', actor: teacher, taskId: created.taskId });
      assert.strictEqual(read.status, 'candidates_ready');
      assert.strictEqual((await imports.prepareDrafts({ tenantId: 'default', actor: teacher, taskId: created.taskId })).items.length, 1);
      assert.strictEqual((await facade.query('SELECT count(*)::integer AS count FROM business.encrypted_import_media_relays')).rows[0].count, 0);
      const noMediaTask = await imports.createParsed({ ...input, idempotencyKey: 'no-media', request: source('nomedia001', [{
        ...candidate, candidate: { stem: 'Text only', answer: 'Answer' }, mediaManifest: [] }]) });
      const noMediaLease = await storage.leaseNext({ agentId: 'storage-agent-1' });
      await storage.complete({ agentId: 'storage-agent-1', taskId: noMediaLease.taskId, leaseToken: noMediaLease.leaseToken,
        observedSha256: noMediaLease.expectedSha256, observedBytes: noMediaLease.expectedBytes });
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: noMediaTask.taskId })).status, 'candidates_ready');
      // Simulate a process exit after receipt commit but before the post-receipt readiness query.
      await facade.query("UPDATE business.question_import_tasks SET status='awaiting_source_storage',phase='awaiting_source_storage' WHERE task_id=$1", [noMediaTask.taskId]);
      await assert.rejects(() => imports.read({ tenantId: 'other', actor: teacher, taskId: noMediaTask.taskId }), /NOT_FOUND/);
      await assert.rejects(() => imports.read({ tenantId: 'default', actor: { accountId: 'teacher-2', roles: ['teacher'] }, taskId: noMediaTask.taskId }), /NOT_FOUND/);
      assert.strictEqual((await facade.query('SELECT status FROM business.question_import_tasks WHERE task_id=$1', [noMediaTask.taskId])).rows[0].status,
        'awaiting_source_storage', 'unowned reads must not reconcile another import');
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: noMediaTask.taskId })).status,
        'candidates_ready', 'an owned refresh recovers committed source/media receipts after a crash');
      await facade.query("UPDATE business.question_import_tasks SET status='awaiting_source_storage',phase='awaiting_source_storage' WHERE task_id=$1", [noMediaTask.taskId]);
      await assert.rejects(() => imports.prepareDrafts({ tenantId: 'other', actor: teacher, taskId: noMediaTask.taskId }), /NOT_CONFIRMABLE/);
      await assert.rejects(() => imports.prepareDrafts({ tenantId: 'default', actor: { accountId: 'teacher-2', roles: ['teacher'] }, taskId: noMediaTask.taskId }), /NOT_CONFIRMABLE/);
      assert.strictEqual((await facade.query('SELECT status FROM business.question_import_tasks WHERE task_id=$1', [noMediaTask.taskId])).rows[0].status,
        'awaiting_source_storage', 'unowned prepare requests must not reconcile another import');
      await facade.query("UPDATE business.question_import_tasks SET status='quarantined',phase='encrypted_relay_expired' WHERE task_id=$1", [noMediaTask.taskId]);
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: noMediaTask.taskId })).status, 'quarantined',
        'even verified objects must not resurrect a quarantined import');
      await assert.rejects(() => imports.prepareDrafts({ tenantId: 'default', actor: teacher, taskId: noMediaTask.taskId }), /NOT_CONFIRMABLE/);
      await facade.query("UPDATE business.question_import_tasks SET status='awaiting_source_storage',phase='awaiting_source_storage' WHERE task_id=$1", [noMediaTask.taskId]);
      assert.strictEqual((await imports.prepareDrafts({ tenantId: 'default', actor: teacher, taskId: noMediaTask.taskId })).status, 'drafts_prepared',
        'an owned prepare recovers committed source/media receipts after a crash');
      const invalid = { ...candidate, candidate: { stem: '', question_types: ['single'], options: [] }, mediaManifest: [] };
      const invalidTask = await imports.createParsed({ ...input, idempotencyKey: 'invalid-candidate', request: source('invalid001', [invalid]) });
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: invalidTask.taskId })).items[0].validation.status, 'rejected');
      const expiredLease = await storage.leaseNext({ agentId: 'storage-agent-1' });
      await facade.query('RESET ROLE');
      await facade.query("UPDATE business.encrypted_import_source_relays SET expires_at=transaction_timestamp()-interval '1 second',created_at=transaction_timestamp()-interval '1 hour' WHERE storage_task_id=$1", [expiredLease.taskId]);
      await facade.query('SET ROLE gewu_cloud_schedule_reader');
      assert.strictEqual(await storage.cleanupExpired(), 1);
      assert.strictEqual((await facade.query('SELECT state FROM business.storage_object_tasks WHERE task_id=$1',[expiredLease.taskId])).rows[0].state, 'quarantined');
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: invalidTask.taskId })).status, 'quarantined');
      const expiringRequest = source('expiremedia001', [candidate]);
      const expiring = await imports.createParsed({ ...input, idempotencyKey: 'expiring-media', request: expiringRequest });
      const expiringSource = await storage.leaseNext({ agentId: 'storage-agent-1' });
      await storage.complete({ agentId: 'storage-agent-1', taskId: expiringSource.taskId, leaseToken: expiringSource.leaseToken,
        observedSha256: expiringSource.expectedSha256, observedBytes: expiringSource.expectedBytes });
      await imports.stageMediaRelay({ tenantId: 'default', actor: teacher, taskId: expiring.taskId,
        mediaId: expiring.mediaTargets[0].mediaId, relay: relay(imageHash, 5) });
      await facade.query("UPDATE business.encrypted_import_media_relays SET expires_at=transaction_timestamp()-interval '1 second',created_at=transaction_timestamp()-interval '1 hour' WHERE import_task_id=$1", [expiring.taskId]);
      assert.strictEqual(await storage.cleanupExpired(), 1);
      const expiredMedia = await imports.read({ tenantId: 'default', actor: teacher, taskId: expiring.taskId });
      assert.strictEqual(expiredMedia.status, 'quarantined');
      assert.strictEqual(expiredMedia.mediaTargets[0].storageState, 'quarantined');
      await assert.rejects(() => imports.prepareDrafts({ tenantId: 'default', actor: teacher, taskId: expiring.taskId }), /NOT_CONFIRMABLE/);
      const unicodeRequest = { ...source('unicode001', [{ ...candidate, candidate: { stem: 'Unicode source', answer: 'Answer' }, mediaManifest: [] }]),
        sourceFileName: '本地录入试题.docx' };
      const unicodeTask = await imports.createParsed({ ...input, idempotencyKey: 'unicode-filename', request: unicodeRequest });
      assert.strictEqual((await facade.query('SELECT source_file_name FROM business.question_import_tasks WHERE task_id=$1', [unicodeTask.taskId])).rows[0].source_file_name,
        unicodeRequest.sourceFileName, 'archive metadata must preserve the original Unicode filename');
      const unicodeLease = await storage.leaseNext({ agentId: 'storage-agent-1' });
      assert.strictEqual(unicodeLease.kind, 'relay');
      await storage.complete({ agentId: 'storage-agent-1', taskId: unicodeLease.taskId, leaseToken: unicodeLease.leaseToken,
        observedSha256: unicodeRequest.sourceSha256, observedBytes: unicodeRequest.sourceBytes });
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: unicodeTask.taskId })).sourceStorageState, 'verified');
      const canonicalRich = richDocument();
      canonicalRich.sections.stem.content.push({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] }] });
      canonicalRich.sections.stem.content.push({ type: 'image', attrs: { assetKey: imageHash, src: 'question-asset://' + imageHash, width: 317.5, height: 126.25, align: 'center' } });
      canonicalRich.sections.stem.content.push({ type: 'formulaBlock', attrs: { id: 'original-1', canonicalLatex: '', displayMode: 'block', conversionStatus: 'preview_only',
        sourceFormat: 'eq_field', previewRef: 'word/media/diagram.png' } });
      const richRequest = source('richschema001', [{ ...candidate, candidate: { ...candidate.candidate, stem: 'forged flat stem', answer: 'B', rich_content: canonicalRich } }]);
      const richTask = await imports.createParsed({ ...input, idempotencyKey: 'canonical-rich', request: richRequest });
      const richRead = await imports.read({ tenantId: 'default', actor: teacher, taskId: richTask.taskId });
      const storedRich = richRead.items[0].candidate.rich_content;
      assert.strictEqual(storedRich.sections.stem.content[2].attrs.width, 317.5, 'rich validation must preserve native image dimensions');
      assert.strictEqual(storedRich.sections.stem.content[3].attrs.conversionStatus, 'preview_only');
      assert.strictEqual(storedRich.sections.stem.content[3].attrs.previewRef, 'question-asset://' + imageHash, 'safe known legacy previews are bound to their retained media digest');
      assert.strictEqual(richRead.items[0].candidate.answer, 'A', 'cloud candidate projection must use the validated rich answer');
      assert.ok(richRead.items[0].candidate.stem.startsWith('Canonical stem'), 'cloud candidate projection must use the validated rich stem');
      assert.ok(richRead.items[0].validation.codes.includes('formula_needs_review'));
      const convertedRich = JSON.parse(JSON.stringify(canonicalRich));
      convertedRich.sections.stem.content[3].attrs.previewRef = 'word/media/diagram.wmf';
      const convertedRequest = source('convertedpreview001', [{ ...candidate, candidate: { ...candidate.candidate,
        assets: [{ ...candidate.candidate.assets[0], assetType: 'formula_preview' }], rich_content: convertedRich } }]);
      const convertedTask = await imports.createParsed({ ...input, idempotencyKey: 'converted-preview-alias', request: convertedRequest });
      assert.strictEqual((await imports.read({ tenantId: 'default', actor: teacher, taskId: convertedTask.taskId })).items[0].candidate.rich_content.sections.stem.content[3].attrs.previewRef,
        'question-asset://' + imageHash, 'a PNG retained formula preview can match only its known converted WMF basename');
      convertedRich.sections.stem.content[3].attrs.previewRef = 'word/media/unallocated.wmf';
      await assert.rejects(() => imports.createParsed({ ...input, idempotencyKey: 'unallocated-converted-preview', request: { ...convertedRequest,
        parsed: { ...convertedRequest.parsed, candidates: [{ ...convertedRequest.parsed.candidates[0],
          candidate: { ...convertedRequest.parsed.candidates[0].candidate, rich_content: convertedRich } }] } } }), /INPUT_INVALID/,
      'a conversion alias must not authorize another source path');
    });
  } finally { await runtime.disposeHandle(handle).catch(() => {}); await runtime.stop().catch(() => {}); }
  console.log('desktop question intake PostgreSQL checks passed');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
