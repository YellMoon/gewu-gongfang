'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createObjectStore } = require('./objectStore');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-object-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-storage-agent-outside-'));
  try {
    const store = createObjectStore({ nasRoot: root });
    const bytes = Buffer.from('abc');
    const descriptor = { objectId: 'obj_1', version: 1, sha256: hash(bytes), bytes: bytes.length };
    const first = await store.putVerified(descriptor, bytes);
    assert.strictEqual(first.status, 'stored');
    assert.strictEqual(await fs.promises.readFile(store.objectPath(descriptor), 'utf8'), 'abc');

    const replay = await store.putVerified(descriptor, bytes);
    assert.strictEqual(replay.status, 'already_verified', 'an identical immutable replay must not replace the stored object');

    await assert.rejects(
      () => store.putVerified({ ...descriptor, sha256: hash('abd') }, bytes),
      /STORAGE_OBJECT_HASH_MISMATCH/,
      'bytes that do not match the declared SHA-256 must never reach the NAS target'
    );
    assert.throws(
      () => store.objectPath({ ...descriptor, objectId: '../escape' }),
      /STORAGE_OBJECT_INVALID/,
      'an object ID must never be usable as a path segment'
    );
    assert.throws(
      () => store.objectPath({ ...descriptor, version: 0 }),
      /STORAGE_OBJECT_INVALID/,
      'an object version must be a positive immutable integer'
    );
    await assert.rejects(
      () => store.putVerified({ ...descriptor, bytes: 2 }, bytes),
      /STORAGE_OBJECT_BYTES_MISMATCH/,
      'the declared byte count is part of the immutable object receipt'
    );
    assert.deepStrictEqual(
      fs.readdirSync(path.dirname(store.objectPath(descriptor))).filter(name => name.includes('.partial')),
      [],
      'failed writes must not leave a partial object in the final directory'
    );

    fs.rmSync(path.join(root, 'objects'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, 'objects'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () => store.putVerified(descriptor, bytes),
      /STORAGE_OBJECT_REPARSE_POINT/,
      'a directory link beneath the NAS root must not redirect an object write outside the allow-listed root'
    );
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'a rejected linked path must not write outside the NAS root');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
  console.log('storage object store checks passed');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
