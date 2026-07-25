const crypto = require('crypto');

const PHYSICAL_CONFIRMATION = 'I_AM_PHYSICALLY_AT_THIS_DEVICE';
const RECEIPT_TTL_MS = 2 * 60 * 1000;
const OPERATIONS = new Set(['bootstrap', 'transfer', 'recovery']);

function receiptError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function requiredText(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw receiptError(code);
  return normalized;
}

function safeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw receiptError(code);
  return number;
}

function timestamp(value, code) {
  const normalized = requiredText(value, code, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw receiptError(code);
  return normalized;
}

function canonicalJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw receiptError('PRIMARY_HOST_OPERATION_MANIFEST_INVALID');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw receiptError('PRIMARY_HOST_OPERATION_MANIFEST_INVALID');
  }
  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map(item => canonicalJson(item, seen)).join(',')}]`;
  } else {
    serialized = `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`
    )).join(',')}}`;
  }
  seen.delete(value);
  return serialized;
}

function primaryHostOperationManifestHash(value) {
  if (value == null) return '';
  const serialized = canonicalJson(value);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 128 * 1024) {
    throw receiptError('PRIMARY_HOST_OPERATION_MANIFEST_INVALID');
  }
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function normalizePrimaryHostLocalReceipt(value = {}) {
  const operation = requiredText(value.operation, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 32);
  const runtimeNodeRole = requiredText(value.runtimeNodeRole, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 32);
  const dbInstanceDigest = requiredText(value.dbInstanceDigest, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 64).toLowerCase();
  const operationManifestHash = String(value.operationManifestHash || '').trim().toLowerCase();
  const receipt = Object.freeze({
    version: Number(value.version),
    operation,
    challengeId: requiredText(value.challengeId, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 128),
    userId: requiredText(value.userId, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 128),
    deviceId: requiredText(value.deviceId, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 128),
    authorizationId: requiredText(value.authorizationId, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 128),
    credentialVersion: safeInteger(value.credentialVersion, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID'),
    runtimeNodeRole,
    dbInstanceDigest,
    schemaVersion: safeInteger(value.schemaVersion, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID'),
    storeId: requiredText(value.storeId, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 256),
    dbAuthorityId: requiredText(value.dbAuthorityId, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 256),
    quickCheck: requiredText(value.quickCheck, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 32),
    operationManifestHash,
    physicalConfirmationAt: timestamp(value.physicalConfirmationAt, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID'),
    issuedAt: timestamp(value.issuedAt, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID'),
    expiresAt: timestamp(value.expiresAt, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID'),
    nonce: requiredText(value.nonce, 'PRIMARY_HOST_LOCAL_RECEIPT_INVALID', 128),
  });
  if (receipt.version !== 2 || !OPERATIONS.has(operation)
    || !['primary-host', 'desktop-client'].includes(runtimeNodeRole)
    || !/^[a-f0-9]{64}$/.test(dbInstanceDigest)
    || receipt.quickCheck !== 'ok'
    || (operationManifestHash && !/^[a-f0-9]{64}$/.test(operationManifestHash))
    || Date.parse(receipt.expiresAt) <= Date.parse(receipt.issuedAt)
    || Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt) > RECEIPT_TTL_MS
    || Date.parse(receipt.physicalConfirmationAt) !== Date.parse(receipt.issuedAt)) {
    throw receiptError('PRIMARY_HOST_LOCAL_RECEIPT_INVALID');
  }
  return receipt;
}

function primaryHostReceiptSigningPayload(value = {}) {
  const receipt = normalizePrimaryHostLocalReceipt(value);
  return `gewu-primary-host-local-receipt-v2\n${JSON.stringify([
    receipt.version,
    receipt.operation,
    receipt.challengeId,
    receipt.userId,
    receipt.deviceId,
    receipt.authorizationId,
    receipt.credentialVersion,
    receipt.runtimeNodeRole,
    receipt.dbInstanceDigest,
    receipt.schemaVersion,
    receipt.storeId,
    receipt.dbAuthorityId,
    receipt.quickCheck,
    receipt.operationManifestHash,
    receipt.physicalConfirmationAt,
    receipt.issuedAt,
    receipt.expiresAt,
    receipt.nonce,
  ])}`;
}

function createPrimaryHostLocalReceipt({
  operation,
  challengeId,
  identity = {},
  evidence = {},
  physicalConfirmation,
  operationManifest = null,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (physicalConfirmation !== PHYSICAL_CONFIRMATION) {
    throw receiptError('PRIMARY_HOST_PHYSICAL_CONFIRMATION_REQUIRED');
  }
  const current = now();
  const currentDate = current instanceof Date ? new Date(current) : new Date(current);
  if (!Number.isFinite(currentDate.getTime())) throw receiptError('PRIMARY_HOST_LOCAL_RECEIPT_CLOCK_INVALID');
  const issuedAt = currentDate.toISOString();
  return normalizePrimaryHostLocalReceipt({
    version: 2,
    operation,
    challengeId,
    userId: identity.userId,
    deviceId: identity.deviceId,
    authorizationId: identity.authorizationId,
    credentialVersion: identity.credentialVersion,
    runtimeNodeRole: evidence.runtimeNodeRole,
    dbInstanceDigest: evidence.dbInstanceDigest,
    schemaVersion: evidence.schemaVersion,
    storeId: evidence.storeId,
    dbAuthorityId: evidence.dbAuthorityId,
    quickCheck: evidence.quickCheck,
    operationManifestHash: primaryHostOperationManifestHash(operationManifest),
    physicalConfirmationAt: issuedAt,
    issuedAt,
    expiresAt: new Date(currentDate.getTime() + RECEIPT_TTL_MS).toISOString(),
    nonce: Buffer.from(randomBytes(18)).toString('hex'),
  });
}

function verifyPrimaryHostLocalReceiptSignature({ receipt, signature, publicKey } = {}) {
  const normalizedSignature = requiredText(signature, 'PRIMARY_HOST_LOCAL_RECEIPT_SIGNATURE_INVALID', 512);
  try {
    const valid = crypto.verify(
      null,
      Buffer.from(primaryHostReceiptSigningPayload(receipt), 'utf8'),
      crypto.createPublicKey(publicKey),
      Buffer.from(normalizedSignature, 'base64')
    );
    if (!valid) throw receiptError('PRIMARY_HOST_LOCAL_RECEIPT_SIGNATURE_INVALID');
    return true;
  } catch (error) {
    if (error?.code === 'PRIMARY_HOST_LOCAL_RECEIPT_SIGNATURE_INVALID') throw error;
    throw receiptError('PRIMARY_HOST_LOCAL_RECEIPT_SIGNATURE_INVALID', error);
  }
}

module.exports = {
  OPERATIONS,
  PHYSICAL_CONFIRMATION,
  RECEIPT_TTL_MS,
  createPrimaryHostLocalReceipt,
  normalizePrimaryHostLocalReceipt,
  primaryHostOperationManifestHash,
  primaryHostReceiptSigningPayload,
  verifyPrimaryHostLocalReceiptSignature,
};
