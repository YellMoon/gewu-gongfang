'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw failure('STORAGE_OBJECT_INVALID');
  const objectId = String(descriptor.objectId || '');
  const version = Number(descriptor.version);
  const sha256 = String(descriptor.sha256 || '');
  const bytes = Number(descriptor.bytes);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(objectId)) throw failure('STORAGE_OBJECT_INVALID');
  if (!Number.isSafeInteger(version) || version < 1) throw failure('STORAGE_OBJECT_INVALID');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw failure('STORAGE_OBJECT_INVALID');
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw failure('STORAGE_OBJECT_INVALID');
  return { objectId, version, sha256, bytes };
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertInsideRoot(candidate, nasRoot) {
  const relative = path.relative(nasRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('STORAGE_OBJECT_INVALID');
  return candidate;
}

function createObjectStore({ nasRoot } = {}) {
  if (typeof nasRoot !== 'string' || !path.isAbsolute(nasRoot)) throw failure('STORAGE_OBJECT_INVALID');
  const root = path.resolve(nasRoot);

  function objectPath(descriptor) {
    const { objectId, version, sha256 } = validateDescriptor(descriptor);
    return assertInsideRoot(path.join(root, 'objects', objectId, String(version), sha256), root);
  }

  async function verifyExisting(target, descriptor) {
    const existing = await fs.promises.readFile(target);
    if (existing.length !== descriptor.bytes) throw failure('STORAGE_OBJECT_IMMUTABLE_CONFLICT');
    if (hashBytes(existing) !== descriptor.sha256) throw failure('STORAGE_OBJECT_IMMUTABLE_CONFLICT');
    return { status: 'already_verified' };
  }

  async function putVerified(descriptorInput, value) {
    const descriptor = validateDescriptor(descriptorInput);
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (bytes.length !== descriptor.bytes) throw failure('STORAGE_OBJECT_BYTES_MISMATCH');
    if (hashBytes(bytes) !== descriptor.sha256) throw failure('STORAGE_OBJECT_HASH_MISMATCH');

    const target = objectPath(descriptor);
    try {
      return await verifyExisting(target, descriptor);
    } catch (error) {
      if (error.code === 'STORAGE_OBJECT_IMMUTABLE_CONFLICT') throw error;
      if (error.code !== 'ENOENT') throw error;
    }

    const stagingDirectory = assertInsideRoot(path.join(root, '.gewu-storage-agent', 'staging'), root);
    const partial = assertInsideRoot(path.join(stagingDirectory, `${descriptor.objectId}-${descriptor.version}-${crypto.randomUUID()}.partial`), root);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.mkdir(stagingDirectory, { recursive: true });
    try {
      await fs.promises.writeFile(partial, bytes, { flag: 'wx' });
      const written = await fs.promises.readFile(partial);
      if (written.length !== descriptor.bytes) throw failure('STORAGE_OBJECT_BYTES_MISMATCH');
      if (hashBytes(written) !== descriptor.sha256) throw failure('STORAGE_OBJECT_HASH_MISMATCH');
      try {
        await fs.promises.rename(partial, target);
      } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
        return verifyExisting(target, descriptor);
      }
      return { status: 'stored' };
    } finally {
      await fs.promises.rm(partial, { force: true });
    }
  }

  return Object.freeze({ objectPath, putVerified });
}

module.exports = {
  createObjectStore,
};
