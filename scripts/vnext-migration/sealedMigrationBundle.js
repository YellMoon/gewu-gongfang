'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const { assertSafeOutputRoot } = require('./pathSafety');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELATIVE_PATH_PATTERN = /^(business|archive|offline|reports)\/[A-Za-z0-9][A-Za-z0-9._/-]*\.ndjson$/;

function sealedError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalBuffer(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
}

function requireHash(value, code) {
  if (!HASH_PATTERN.test(String(value || ''))) throw sealedError(code);
  return value;
}

function requireEncryptionKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw sealedError('MIGRATION_BUNDLE_ENCRYPTION_KEY_INVALID');
  return value;
}

function fingerprintPublicKey(publicKey) {
  try {
    const key = publicKey instanceof crypto.KeyObject && publicKey.type === 'public'
      ? publicKey
      : crypto.createPublicKey(publicKey);
    return sha256Buffer(key.export({ type: 'spki', format: 'der' }));
  } catch (error) {
    throw sealedError('MIGRATION_BUNDLE_SIGNING_KEY_INVALID', error);
  }
}

function validateRelativePath(value) {
  const relativePath = String(value || '').replace(/\\/g, '/');
  if (!RELATIVE_PATH_PATTERN.test(relativePath) || relativePath.includes('../') || relativePath.includes('//')) {
    throw sealedError('MIGRATION_BUNDLE_PAYLOAD_PATH_INVALID');
  }
  return relativePath;
}

function encryptBytes(bytes, key, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function decryptBytes({ ciphertext, key, nonce, authTag, aad }) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw sealedError('MIGRATION_BUNDLE_DECRYPT_FAILED', error);
  }
}

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw sealedError(code, error);
  }
}

function listFiles(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...listFiles(root, child));
    else if (entry.isFile()) result.push(child);
    else throw sealedError('MIGRATION_BUNDLE_FILE_SET_INVALID');
  }
  return result.sort();
}

function createSealedMigrationBundle({
  bundlePath, bundleId, environment, sourceSnapshotHash, sourceInventoryHash,
  catalogHash, signingPrivateKey, encryptionKey, payloads, testHooks = {},
} = {}) {
  const key = requireEncryptionKey(encryptionKey);
  if (!ID_PATTERN.test(String(bundleId || ''))) throw sealedError('MIGRATION_BUNDLE_ID_INVALID');
  if (!['development', 'shadow', 'production'].includes(environment)) {
    throw sealedError('MIGRATION_BUNDLE_ENVIRONMENT_INVALID');
  }
  if (!bundlePath) throw sealedError('MIGRATION_BUNDLE_PATH_REQUIRED');
  const requested = path.resolve(bundlePath);
  if (fs.existsSync(requested)) throw sealedError('MIGRATION_BUNDLE_ALREADY_EXISTS');
  const partial = `${requested}.partial`;
  if (fs.existsSync(partial)) throw sealedError('MIGRATION_BUNDLE_PARTIAL_EXISTS');
  requireHash(sourceSnapshotHash, 'MIGRATION_SNAPSHOT_HASH_INVALID');
  requireHash(sourceInventoryHash, 'MIGRATION_SOURCE_INVENTORY_HASH_INVALID');
  requireHash(catalogHash, 'MIGRATION_SOURCE_CATALOG_HASH_INVALID');
  if (!Array.isArray(payloads) || payloads.length === 0) throw sealedError('MIGRATION_BUNDLE_PAYLOADS_REQUIRED');
  const safeOutput = assertSafeOutputRoot(requested);

  let privateKey;
  try {
    privateKey = signingPrivateKey instanceof crypto.KeyObject && signingPrivateKey.type === 'private'
      ? signingPrivateKey
      : crypto.createPrivateKey(signingPrivateKey);
  } catch (error) {
    throw sealedError('MIGRATION_BUNDLE_SIGNING_KEY_INVALID', error);
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyFingerprint = fingerprintPublicKey(publicKey);
  const seenPaths = new Set();
  const seenNonces = new Set();
  let completed = false;
  try {
    fs.mkdirSync(partial);
    const encryptedPayloads = [];
    for (const payload of [...payloads].sort((left, right) => String(left.relativePath).localeCompare(String(right.relativePath)))) {
      const relativePath = validateRelativePath(payload.relativePath);
      const encryptedRelativePath = `${relativePath}.enc`;
      if (seenPaths.has(encryptedRelativePath)) throw sealedError('MIGRATION_BUNDLE_PAYLOAD_PATH_DUPLICATE');
      seenPaths.add(encryptedRelativePath);
      if (!Array.isArray(payload.records)) throw sealedError('MIGRATION_BUNDLE_PAYLOAD_RECORDS_INVALID');
      const plaintext = Buffer.from(payload.records.length
        ? `${payload.records.map(record => canonicalJson(record)).join('\n')}\n`
        : '', 'utf8');
      const aad = canonicalBuffer({ bundleId, environment, relativePath, classification: payload.classification });
      const encrypted = encryptBytes(plaintext, key, aad);
      if (typeof testHooks.overrideNonce === 'function') {
        encrypted.nonce = Buffer.from(testHooks.overrideNonce(relativePath, encrypted.nonce));
        const cipher = crypto.createCipheriv('aes-256-gcm', key, encrypted.nonce);
        cipher.setAAD(aad);
        encrypted.ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        encrypted.authTag = cipher.getAuthTag();
      }
      const nonceKey = encrypted.nonce.toString('base64');
      if (seenNonces.has(nonceKey)) throw sealedError('MIGRATION_BUNDLE_NONCE_REUSE');
      seenNonces.add(nonceKey);
      const absolutePath = path.join(partial, ...encryptedRelativePath.split('/'));
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, encrypted.ciphertext, { flag: 'wx' });
      encryptedPayloads.push({
        relativePath: encryptedRelativePath,
        sourceRelativePath: relativePath,
        classification: String(payload.classification || ''),
        recordCount: payload.records.length,
        plaintextHash: sha256Buffer(plaintext),
        ciphertextHash: sha256Buffer(encrypted.ciphertext),
        nonce: encrypted.nonce.toString('base64'),
        authTag: encrypted.authTag.toString('base64'),
        aadHash: sha256Buffer(aad),
      });
    }
    const manifest = {
      schemaVersion: 1,
      bundleId,
      environment,
      encryption: 'aes-256-gcm',
      signatureAlgorithm: 'ed25519',
      publicKeyFingerprint,
      sourceSnapshotHash,
      sourceInventoryHash,
      catalogHash,
      payloads: encryptedPayloads,
    };
    const manifestBytes = canonicalBuffer(manifest);
    const signature = crypto.sign(null, manifestBytes, privateKey);
    const signatureDocument = {
      schemaVersion: 1,
      algorithm: 'ed25519',
      manifestHash: sha256Buffer(manifestBytes),
      publicKeyFingerprint,
      signature: signature.toString('base64'),
    };
    fs.writeFileSync(path.join(partial, 'manifest.json'), manifestBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(partial, 'signature.json'), canonicalBuffer(signatureDocument), { flag: 'wx' });
    const bundleHash = sha256Buffer(canonicalBuffer({ manifestHash: signatureDocument.manifestHash, payloads: encryptedPayloads.map(item => [item.relativePath, item.ciphertextHash]) }));
    fs.writeFileSync(path.join(partial, 'bundle-hash.txt'), `${bundleHash}\n`, { encoding: 'ascii', flag: 'wx' });
    fs.renameSync(partial, safeOutput);
    completed = true;
    return Object.freeze({ bundleId, bundleHash, publicKeyFingerprint, encryptedFileCount: encryptedPayloads.length });
  } catch (error) {
    if (error && String(error.code || '').startsWith('MIGRATION_')) throw error;
    throw sealedError('MIGRATION_BUNDLE_CREATE_FAILED', error);
  } finally {
    if (!completed && fs.existsSync(partial)) {
      try { fs.writeFileSync(path.join(partial, 'FAILED'), 'incomplete\n', { encoding: 'utf8', flag: 'wx' }); } catch (_) { /* preserve */ }
    }
  }
}

function loadAndVerify({ bundlePath, signingPublicKey, allowedPublicKeyFingerprints, expectedEnvironment }) {
  const root = path.resolve(String(bundlePath || ''));
  if (!bundlePath || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw sealedError('MIGRATION_BUNDLE_MISSING');
  const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
  const manifest = readJson(path.join(root, 'manifest.json'), 'MIGRATION_BUNDLE_MANIFEST_INVALID');
  const signature = readJson(path.join(root, 'signature.json'), 'MIGRATION_BUNDLE_SIGNATURE_INVALID');
  const fingerprint = fingerprintPublicKey(signingPublicKey);
  if (!Array.isArray(allowedPublicKeyFingerprints) || !allowedPublicKeyFingerprints.includes(fingerprint)
    || signature.publicKeyFingerprint !== fingerprint || manifest.publicKeyFingerprint !== fingerprint) {
    throw sealedError('MIGRATION_BUNDLE_SIGNING_KEY_NOT_ALLOWED');
  }
  if (manifest.environment !== expectedEnvironment) throw sealedError('MIGRATION_BUNDLE_ENVIRONMENT_MISMATCH');
  if (signature.manifestHash !== sha256Buffer(manifestBytes)
    || !crypto.verify(null, manifestBytes, signingPublicKey, Buffer.from(signature.signature, 'base64'))) {
    throw sealedError('MIGRATION_BUNDLE_SIGNATURE_INVALID');
  }
  const expectedFiles = ['bundle-hash.txt', 'manifest.json', 'signature.json', ...manifest.payloads.map(item => item.relativePath)].sort();
  if (canonicalJson(listFiles(root)) !== canonicalJson(expectedFiles)) throw sealedError('MIGRATION_BUNDLE_FILE_SET_INVALID');
  for (const payload of manifest.payloads) {
    const bytes = fs.readFileSync(path.join(root, ...payload.relativePath.split('/')));
    if (sha256Buffer(bytes) !== payload.ciphertextHash) throw sealedError('MIGRATION_BUNDLE_CIPHERTEXT_HASH_MISMATCH');
  }
  const bundleHash = sha256Buffer(canonicalBuffer({ manifestHash: signature.manifestHash, payloads: manifest.payloads.map(item => [item.relativePath, item.ciphertextHash]) }));
  if (fs.readFileSync(path.join(root, 'bundle-hash.txt'), 'ascii').trim() !== bundleHash) throw sealedError('MIGRATION_BUNDLE_HASH_MISMATCH');
  return { root, manifest, bundleHash };
}

function decryptPayload({ root, manifest, payload, encryptionKey }) {
  const key = requireEncryptionKey(encryptionKey);
  const aad = canonicalBuffer({
    bundleId: manifest.bundleId,
    environment: manifest.environment,
    relativePath: payload.sourceRelativePath,
    classification: payload.classification,
  });
  if (sha256Buffer(aad) !== payload.aadHash) throw sealedError('MIGRATION_BUNDLE_AAD_MISMATCH');
  const plaintext = decryptBytes({
    ciphertext: fs.readFileSync(path.join(root, ...payload.relativePath.split('/'))),
    key,
    nonce: Buffer.from(payload.nonce, 'base64'),
    authTag: Buffer.from(payload.authTag, 'base64'),
    aad,
  });
  if (sha256Buffer(plaintext) !== payload.plaintextHash) throw sealedError('MIGRATION_BUNDLE_PLAINTEXT_HASH_MISMATCH');
  return plaintext;
}

function verifySealedMigrationBundle(options = {}) {
  const loaded = loadAndVerify(options);
  for (const payload of loaded.manifest.payloads) decryptPayload({ ...loaded, payload, encryptionKey: options.encryptionKey });
  return Object.freeze({
    bundleId: loaded.manifest.bundleId,
    bundleHash: loaded.bundleHash,
    publicKeyFingerprint: loaded.manifest.publicKeyFingerprint,
    environment: loaded.manifest.environment,
    sourceSnapshotHash: loaded.manifest.sourceSnapshotHash,
    sourceInventoryHash: loaded.manifest.sourceInventoryHash,
    catalogHash: loaded.manifest.catalogHash,
    payloads: Object.freeze(loaded.manifest.payloads.map(Object.freeze)),
  });
}

function decryptBundleFile({
  bundlePath, relativePath, encryptionKey, signingPublicKey,
  allowedPublicKeyFingerprints, expectedEnvironment,
} = {}) {
  const loaded = loadAndVerify({
    bundlePath, signingPublicKey, allowedPublicKeyFingerprints, expectedEnvironment,
  });
  const { root, manifest } = loaded;
  const requested = String(relativePath || '').replace(/\\/g, '/');
  const payload = manifest.payloads.find(item => item.relativePath === requested);
  if (!payload) throw sealedError('MIGRATION_BUNDLE_PAYLOAD_MISSING');
  return decryptPayload({ root, manifest, payload, encryptionKey });
}

module.exports = {
  createSealedMigrationBundle,
  decryptBundleFile,
  fingerprintPublicKey,
  verifySealedMigrationBundle,
};
