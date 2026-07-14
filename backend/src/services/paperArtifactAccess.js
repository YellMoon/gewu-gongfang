const crypto = require('crypto');

function accessError(code, message, statusCode = 403) { return Object.assign(new Error(message), { code, statusCode }); }
function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function signature(encoded, secret) { return crypto.createHmac('sha256', secret).update(encoded).digest('base64url'); }
function assertStrongSecret(secret) {
  const bytes = Buffer.from(String(secret || ''), 'utf8');
  if (!bytes.length) throw accessError('ARTIFACT_DOWNLOAD_SECRET_REQUIRED', 'GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET is required', 503);
  const counts = new Map(); for (const byte of bytes) counts.set(byte, (counts.get(byte) || 0) + 1);
  const entropy = [...counts.values()].reduce((sum, count) => { const p = count / bytes.length; return sum - p * Math.log2(p); }, 0);
  if (bytes.length < 32 || entropy < 3.5) throw accessError('ARTIFACT_DOWNLOAD_SECRET_WEAK', 'artifact download secret must be at least 32 bytes with sufficient entropy', 503);
  return String(secret);
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  const padded = Buffer.alloc(Math.max(a.length, b.length));
  const paddedOther = Buffer.alloc(padded.length);
  a.copy(padded); b.copy(paddedOther);
  return crypto.timingSafeEqual(padded, paddedOther) && a.length === b.length;
}

function createArtifactDownloadToken(artifact, options = {}) {
  const secret = assertStrongSecret(options.secret || process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET || '');
  const nowMs = new Date(options.now || Date.now()).getTime();
  const payload = {
    artifactId: artifact.artifact_id, taskId: artifact.task_id, ownerUserId: artifact.owner_user_id,
    tenantId: artifact.tenant_id, exp: Math.floor(nowMs / 1000) + Math.max(1, Number(options.ttlSeconds || 300)),
    kid: String(options.kid || process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_KID || 'current'),
  };
  const encoded = b64(JSON.stringify(payload));
  return `${encoded}.${signature(encoded, secret)}`;
}

function verifyArtifactDownloadToken(artifact, token, options = {}) {
  const [encoded, supplied, extra] = String(token || '').split('.');
  if (!encoded || !supplied || extra !== undefined) throw accessError('ARTIFACT_DOWNLOAD_SIGNATURE_INVALID', 'artifact signature is invalid');
  let payload;
  try { payload = JSON.parse(unb64(encoded)); } catch (_error) { throw accessError('ARTIFACT_DOWNLOAD_SIGNATURE_INVALID', 'artifact signature is invalid'); }
  const secrets = options.secrets || {};
  const secret = String(secrets[payload.kid] || '');
  if (!secret) throw accessError('ARTIFACT_DOWNLOAD_KID_UNKNOWN', 'artifact signature key is unknown');
  assertStrongSecret(secret);
  if (!safeEqual(signature(encoded, secret), supplied)) throw accessError('ARTIFACT_DOWNLOAD_SIGNATURE_INVALID', 'artifact signature is invalid');
  const bound = payload.artifactId === artifact.artifact_id && payload.taskId === artifact.task_id
    && payload.ownerUserId === artifact.owner_user_id && payload.tenantId === artifact.tenant_id;
  if (!bound) throw accessError('ARTIFACT_DOWNLOAD_SIGNATURE_INVALID', 'artifact signature binding is invalid');
  const nowSeconds = Math.floor(new Date(options.now || Date.now()).getTime() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw accessError('ARTIFACT_DOWNLOAD_EXPIRED', 'artifact signature expired', 410);
  const sameTenant = String(options.tenantId || '') === String(artifact.tenant_id);
  const authorizedActor = String(options.actorUserId || '') === String(artifact.owner_user_id) || Boolean(options.isAdmin);
  if (!sameTenant || !authorizedActor) throw accessError('ARTIFACT_DOWNLOAD_FORBIDDEN', 'artifact download is forbidden');
  return { authorized: true, kid: payload.kid };
}

module.exports = { createArtifactDownloadToken, verifyArtifactDownloadToken };
