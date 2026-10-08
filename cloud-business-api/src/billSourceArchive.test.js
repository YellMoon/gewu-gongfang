'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBillSourceArchive } = require('./billSourceArchive');
test('private archive encrypts source, isolates owners, and replays identical imports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gewu-bill-'));
  try {
    const archive = createBillSourceArchive({ root, key: Buffer.alloc(32, 9) });
    const input = { tenantId: 'test', ownerAccountId: 'owner-a', filename: '../bill.csv', buffer: Buffer.from('private transaction 99') };
    const ref = await archive(input);
    assert.deepEqual(await archive(input), ref);
    assert.notEqual((await archive({ ...input, ownerAccountId: 'owner-b' })).id, ref.id);
    const raw = await fs.readFile(path.join(root, ref.id + '.enc'));
    assert.equal(raw.includes(input.buffer), false);
    assert.deepEqual(await archive.read({ ...input, reference: ref }), input.buffer);
    await assert.rejects(archive.read({ ...input, ownerAccountId: 'owner-b', reference: ref }), /BILL_ARCHIVE_SCOPE/);
    await assert.rejects(archive({ ...input, fileHash: 'wrong' }), /BILL_ARCHIVE_HASH/);
    raw[raw.length - 1] ^= 1;
    await fs.writeFile(path.join(root, ref.id + '.enc'), raw);
    await assert.rejects(archive.read({ ...input, reference: ref }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
