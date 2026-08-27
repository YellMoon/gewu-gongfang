'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createPaperExportArtifactRepository } = require('./paperExportArtifactRepository');
const { openForAgent } = require('../../shared/encryptedNasRelay');
const { renderPaperExport } = require('./paperExportRenderer');

(async () => {
  const pair = crypto.generateKeyPairSync('x25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
  let captured;
  const repository = createPaperExportArtifactRepository({
    agentPublicKey: publicKey, randomId: () => 'artifact-id-12345678', now: () => new Date('2026-08-23T00:00:00.000Z'),
    query: async (text, values) => {
      captured = { text, values };
      return { rows: [{ artifactId: 'paper_artifact_artifact-id-12345678' }] };
    },
  });
  await assert.rejects(
    () => repository.archive({
      taskId: 'paper_task_1', tenantId: 'default', accountId: 'account-1', format: 'pdf',
      fileName: 'paper.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-test'),
    }),
    error => error.code === 'CLOUD_PAPER_ARTIFACT_PDF_INVALID',
  );
  const rendered = await renderPaperExport({
    format: 'pdf', title: 'Artifact test', answerPosition: 'end', formulaMode: 'word-native',
    snapshot: [{ id: 'q1', stem: 'Question', options: ['A. choice'], answer: 'A', explanation: 'Explanation' }],
  });
  const archived = await repository.archive({
    taskId: 'paper_task_1', tenantId: 'default', accountId: 'account-1', format: 'pdf',
    fileName: 'paper.pdf', mimeType: 'application/pdf', bytes: rendered.bytes,
  });
  assert.deepStrictEqual(archived, { artifactId: 'paper_artifact_artifact-id-12345678' });
  assert.ok(captured.text.includes('encrypted_paper_export_artifact_relays'));
  const envelope = JSON.parse(captured.values[12]);
  const plaintext = openForAgent({
    agentPrivateKey: privateKey, binding: 'task_artifact-id-12345678:obj_paper_artifact-id-12345678:1',
    envelope, ciphertext: captured.values[13],
  });
  assert.deepStrictEqual(plaintext, rendered.bytes);
  console.log('paper export artifact repository checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
