'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../../shared/migrationBundleProtocol');
const { assertSafeOutputRoot } = require('./pathSafety');
const { fingerprintPublicKey } = require('./sealedMigrationBundle');

const KEY_FILES = Object.freeze([
  'encryption-key.b64', 'metadata.json', 'signing-private.pem', 'signing-public.pem',
]);

function keyError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function assertOutsideRepository(keyDirectory, repositoryRoot) {
  const candidate = path.resolve(keyDirectory);
  const repository = path.resolve(repositoryRoot);
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const key = normalize(candidate);
  const repo = normalize(repository);
  if (key === repo || key.startsWith(`${repo}${path.sep}`)) throw keyError('VNEXT_MIGRATION_KEY_DIRECTORY_IN_REPOSITORY');
  return candidate;
}

function writeSecret(filePath, value) {
  fs.writeFileSync(filePath, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Windows ACL is verified operationally, not by POSIX mode. */ }
}

function createExternalMigrationKeys({ keyDirectory, repositoryRoot } = {}) {
  if (!keyDirectory || !repositoryRoot) throw keyError('VNEXT_MIGRATION_KEY_ARGUMENT_REQUIRED');
  const requested = assertOutsideRepository(keyDirectory, repositoryRoot);
  if (fs.existsSync(requested)) throw keyError('VNEXT_MIGRATION_KEY_DIRECTORY_EXISTS');
  const safeDirectory = assertSafeOutputRoot(requested);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const encryptionKey = crypto.randomBytes(32);
  const publicKeyFingerprint = fingerprintPublicKey(publicKey);
  fs.mkdirSync(safeDirectory);
  writeSecret(path.join(safeDirectory, 'signing-private.pem'), privatePem);
  fs.writeFileSync(path.join(safeDirectory, 'signing-public.pem'), publicPem, { encoding: 'utf8', flag: 'wx' });
  writeSecret(path.join(safeDirectory, 'encryption-key.b64'), `${encryptionKey.toString('base64')}\n`);
  fs.writeFileSync(path.join(safeDirectory, 'metadata.json'), `${canonicalJson({
    schemaVersion: 1, signatureAlgorithm: 'ed25519', encryptionAlgorithm: 'aes-256-gcm', publicKeyFingerprint,
  })}\n`, { encoding: 'utf8', flag: 'wx' });
  return Object.freeze({ keyDirectory: safeDirectory, publicKeyFingerprint });
}

function loadExternalMigrationKeys({ keyDirectory, repositoryRoot } = {}) {
  if (!keyDirectory || !repositoryRoot) throw keyError('VNEXT_MIGRATION_KEY_ARGUMENT_REQUIRED');
  const directory = assertOutsideRepository(keyDirectory, repositoryRoot);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw keyError('VNEXT_MIGRATION_KEY_DIRECTORY_MISSING');
  const files = fs.readdirSync(directory).sort();
  if (canonicalJson(files) !== canonicalJson(KEY_FILES)) throw keyError('VNEXT_MIGRATION_KEY_FILE_SET_INVALID');
  try {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(path.join(directory, 'signing-private.pem'), 'utf8'));
    const publicKey = crypto.createPublicKey(fs.readFileSync(path.join(directory, 'signing-public.pem'), 'utf8'));
    const encryptionKey = Buffer.from(fs.readFileSync(path.join(directory, 'encryption-key.b64'), 'utf8').trim(), 'base64');
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
    const fingerprint = fingerprintPublicKey(publicKey);
    if (encryptionKey.length !== 32 || fingerprint !== fingerprintPublicKey(crypto.createPublicKey(privateKey))
      || metadata.publicKeyFingerprint !== fingerprint || metadata.schemaVersion !== 1) {
      throw new Error('key mismatch');
    }
    return Object.freeze({ privateKey, publicKey, encryptionKey, publicKeyFingerprint: fingerprint });
  } catch (error) {
    throw keyError('VNEXT_MIGRATION_KEY_MATERIAL_INVALID', error);
  }
}

module.exports = { createExternalMigrationKeys, loadExternalMigrationKeys };
