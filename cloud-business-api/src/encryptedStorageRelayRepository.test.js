'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createEncryptedStorageRelayRepository } = require('./encryptedStorageRelayRepository');
const { sealForAgent } = require('../../shared/encryptedNasRelay');

async function main() {
  const pair = crypto.generateKeyPairSync('x25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const plaintext = Buffer.from('relay-only media bytes');
  const relay = sealForAgent({
    agentPublicKey: publicKey,
    binding: 'task_12345678:obj_1:1',
    plaintext,
  });
  const calls = [];
  const repository = createEncryptedStorageRelayRepository({
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [{ taskId: 'task_12345678', assetId: 'asset_1', expiresAt: new Date('2026-08-23T01:05:00.000Z') }] };
    },
    now: () => new Date('2026-08-23T01:00:00.000Z'),
  });
  const created = await repository.create({
    tenantId: 'default', actorAccountId: 'teacher-account-1', questionId: 'question-1',
    assetId: 'asset_1', taskId: 'task_12345678', objectId: 'obj_1', objectVersion: 1,
    assetType: 'image', fileName: 'diagram.png', mimeType: 'image/png',
    agentKeyFingerprint: crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex'),
    envelope: relay.envelope, ciphertext: relay.ciphertext,
    expiresAt: '2026-08-23T01:05:00.000Z',
  });
  assert.deepStrictEqual(created, { taskId: 'task_12345678', assetId: 'asset_1', expiresAt: '2026-08-23T01:05:00.000Z' });
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO business\.question_assets/u);
  assert.match(calls[0].text, /INSERT INTO business\.storage_object_tasks/u);
  assert.match(calls[0].text, /INSERT INTO business\.encrypted_storage_relays/u);
  assert.ok(!calls[0].text.match(/file_path|oss_url|storage_state|plaintext|nas[_ -]?path/iu));
  assert.ok(!calls[0].values.includes(plaintext.toString('utf8')));
}

main().then(() => console.log('encrypted storage relay repository checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
