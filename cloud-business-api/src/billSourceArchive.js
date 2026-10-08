'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const hash = data => createHash('sha256').update(data).digest('hex');
function createBillSourceArchive({ root, key, maxBytes = 24 * 1024 * 1024 }) {
  if (!path.isAbsolute(root || '') || !Buffer.isBuffer(key) || key.length !== 32) throw fail('BILL_ARCHIVE_CONFIGURATION');
  const scope = input => {
    if (!input.tenantId || !input.ownerAccountId) throw fail('BILL_ARCHIVE_SCOPE');
    return hash(JSON.stringify([input.tenantId, input.ownerAccountId]));
  };
  const archive = async input => {
    if (!Buffer.isBuffer(input.buffer) || !input.buffer.length || input.buffer.length > maxBytes) throw fail('BILL_ARCHIVE_SIZE');
    const fileHash = hash(input.buffer);
    if (input.fileHash && input.fileHash !== fileHash) throw fail('BILL_ARCHIVE_HASH');
    const owner = scope(input), id = owner + '-' + fileHash;
    const target = path.join(root, id + '.enc');
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(root)).isSymbolicLink()) throw fail('BILL_ARCHIVE_PATH');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(input.buffer), cipher.final()]);
    const envelope = Buffer.concat([Buffer.from('GWB1'), iv, cipher.getAuthTag(), encrypted]);
    const reference = { id, fileHash, byteLength: input.buffer.length, filename: path.basename(String(input.filename || 'bill').replace(/\\/g, '/')).slice(0, 180), storage: 'controlled-private', encrypted: true };
    const temporary = path.join(root, id + '-' + randomBytes(12).toString('hex') + '.tmp');
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(envelope); await handle.sync(); } finally { await handle.close(); }
      try { await fs.link(temporary, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // A prior upload is reusable only after authenticated decryption.
        if (!(await archive.read({ ...input, reference })).equals(input.buffer)) throw fail('BILL_ARCHIVE_HASH');
      }
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return reference;
  };
  archive.read = async input => {
    const ref = input.reference || {}, owner = scope(input);
    if (!/^[a-f0-9]{64}-[a-f0-9]{64}$/.test(ref.id || '') || ref.id !== owner + '-' + ref.fileHash) throw fail('BILL_ARCHIVE_SCOPE');
    const target = path.join(root, ref.id + '.enc'), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes + 32) throw fail('BILL_ARCHIVE_PATH');
    const raw = await fs.readFile(target);
    if (raw.length < 32 || raw.subarray(0, 4).toString() !== 'GWB1') throw fail('BILL_ARCHIVE_FORMAT');
    const cipher = createDecipheriv('aes-256-gcm', key, raw.subarray(4, 16));
    cipher.setAAD(Buffer.from(ref.id)); cipher.setAuthTag(raw.subarray(16, 32));
    const buffer = Buffer.concat([cipher.update(raw.subarray(32)), cipher.final()]);
    if (hash(buffer) !== ref.fileHash) throw fail('BILL_ARCHIVE_HASH');
    return buffer;
  };
  return archive;
}
module.exports = { createBillSourceArchive };
