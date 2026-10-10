'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createQuestionImportTaskRepository } = require('./questionImportTaskRepository');
const { createStorageTaskRepository } = require('./storageTaskRepository');

(async () => {
  const repository = createQuestionImportTaskRepository({ query: async () => ({ rows: [] }) });
  assert.strictEqual(typeof repository.createParsed, 'function', 'desktop parsed intake must be available without NAS parser proof');
  assert.strictEqual(typeof repository.stageMediaRelay, 'function', 'desktop media relay must bind an allocated target');
  await assert.rejects(() => repository.createParsed({ tenantId: 'default', actor: { accountId: 'student', roles: ['student'] }, idempotencyKey: 'key', request: {} }), /ACCESS_DENIED/);
  const calls = [];
  const storage = createStorageTaskRepository({ query: async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes('INSERT INTO business.storage_task_receipts')
      ? { rows: [{ taskId: 'task_desktop123', verifiedAt: new Date(), desktopImport: true }] } : { rows: [] };
  } });
  await storage.complete({ agentId: 'storage-agent-1', taskId: 'task_desktop123', leaseToken: 'lease-token-desktop-123', observedSha256: 'a'.repeat(64), observedBytes: 10 });
  assert.strictEqual(calls.length, 2, 'desktop readiness must recheck committed sibling receipts after the receipt statement');
  assert.ok(calls[1].sql.includes("processing_location='desktop'") && calls[1].sql.includes("storage_state<>'verified'"));
  const ciphertext = Buffer.from('encrypted original');
  const source = { sourceType: 'exam', sourceFileName: '本地录入.docx', sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceSha256: 'a'.repeat(64), sourceBytes: 100, metadata: {}, storage: { taskId: 'task_unicode123', objectId: 'obj_unicode', objectVersion: 1 },
    relay: { agentKeyFingerprint: 'b'.repeat(64), ciphertext, expiresAt: new Date(Date.now() + 600000).toISOString(), envelope: {
      version: 'x25519-aes-256-gcm-v1', ephemeralPublicKey: Buffer.alloc(44, 1).toString('base64url'),
      keyDerivationSalt: Buffer.alloc(16, 2).toString('base64url'), wrappedKeyNonce: Buffer.alloc(12, 3).toString('base64url'),
      wrappedKeyCiphertext: Buffer.alloc(32, 4).toString('base64url'), wrappedKeyTag: Buffer.alloc(16, 5).toString('base64url'),
      contentNonce: Buffer.alloc(12, 6).toString('base64url'), contentTag: Buffer.alloc(16, 7).toString('base64url'),
      ciphertextSha256: crypto.createHash('sha256').update(ciphertext).digest('hex'), ciphertextBytes: ciphertext.length,
      plaintextSha256: 'a'.repeat(64), plaintextBytes: 100,
    } } };
  const input = { tenantId: 'default', actor: { accountId: 'teacher', roles: ['teacher'] }, idempotencyKey: 'unicode', request: source };
  await assert.rejects(() => repository.create(input), /PARSER_UNAVAILABLE/, 'safe Unicode names pass legacy source validation');
  const richDoc = { version: 1, type: 'question-document', sections: {
    stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'image', attrs: { assetKey: 'a'.repeat(64), src: 'question-asset://' + 'a'.repeat(64) } }] },
    answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] }, options: [], subQuestions: [],
  } };
  const unboundRich = { contentHash: '0'.repeat(64), candidate: { stem: 'Question', rich_content: richDoc, assets: [] }, validation: { status: 'accepted' }, mediaManifest: [] };
  await assert.rejects(() => repository.createParsed({ ...input, request: { ...source,
    parsed: { parserSha256: '9'.repeat(64), candidates: [unboundRich] } } }), /INPUT_INVALID/, 'unallocated rich images cannot pass the source-only receipt gate');
  const formula = { type: 'formula', attrs: { id: 'formula-null-preview', canonicalLatex: '2v', displayMode: 'inline',
    conversionStatus: 'complete', sourceFormat: 'omml', previewRef: null, sourceRef: null } };
  const formulaDoc = { type: 'doc', content: [{ type: 'paragraph', content: [formula] }] };
  const nestedRich = { ...richDoc, sections: { ...richDoc.sections, stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Question' }] }] },
    options: [{ id: 'option-null-preview', label: 'A', isCorrect: true, content: formulaDoc }],
    subQuestions: [{ id: 'sub-null-preview', label: '(1)', content: formulaDoc, answer: formulaDoc }] } };
  let validated = false;
  const validationRepository = createQuestionImportTaskRepository({ query: async () => { validated = true; throw Error('VALIDATION_PASSED'); } });
  await assert.rejects(() => validationRepository.createParsed({ ...input, request: { ...source, parsed: {
    parserSha256: '9'.repeat(64), candidates: [{ ...unboundRich, candidate: { stem: 'Question', rich_content: nestedRich, assets: [] } }] } } }),
    /VALIDATION_PASSED/, 'native formulas inside options and subquestions need no preview asset');
  assert(validated);
  const normalized = require('../../shared/questionRichContentContract').normalizeQuestionRichContent(nestedRich);
  assert.equal(normalized.sections.options[0].content.content[0].content[0].attrs.previewRef, undefined);
  assert.equal(normalized.sections.subQuestions[0].content.content[0].content[0].attrs.sourceRef, undefined);
  assert.equal(formula.attrs.previewRef, null, 'cleanup must preserve the caller input');
  for (const reference of ['word/media/unallocated.png', 'question-asset://' + 'f'.repeat(64)]) {
    const invalid = JSON.parse(JSON.stringify(nestedRich));
    invalid.sections.options[0].content.content[0].content[0].attrs.previewRef = reference;
    await assert.rejects(() => validationRepository.createParsed({ ...input, request: { ...source, parsed: {
      parserSha256: '9'.repeat(64), candidates: [{ ...unboundRich, candidate: { stem: 'Question', rich_content: invalid, assets: [] } }] } } }),
      /INPUT_INVALID/, 'a real unallocated preview reference still fails closed');
  }
  for (const filename of ['../本地录入.docx', '目录/本地录入.docx', '目录\\本地录入.docx', '本地\u0000录入.docx', '本地\r录入.docx', '本地\n录入.docx', ' 本地录入.docx', '本地录入.docx ', '题'.repeat(508) + '.docx']) {
    await assert.rejects(() => repository.create({ ...input, request: { ...source, sourceFileName: filename } }), /INPUT_INVALID/, filename);
    await assert.rejects(() => repository.createParsed({ ...input, request: { ...source, sourceFileName: filename,
      parsed: { parserSha256: '9'.repeat(64), candidates: [{ contentHash: '0'.repeat(64), candidate: { stem: 'text', answer: 'answer' }, validation: { status: 'accepted' }, mediaManifest: [] }] } } }), /INPUT_INVALID/, filename);
  }
  console.log('desktop question intake unit checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
