const crypto = require('crypto');
const {
  AUTHORITY_PROJECTION_PROTOCOL,
  createSignedAuthorityProjection,
} = require('./authorityProjectionProtocol');

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const KEY_DERIVATION_SALT = Buffer.from('gewu.primary-host.signing.v1', 'utf8');
const KEY_DERIVATION_INFO = Buffer.from('authority-projection-ed25519', 'utf8');

function signingKeyError(code, cause) {
  return Object.assign(new Error(code), { code, cause });
}

function derivePrimaryHostSigningKey(hostCredential) {
  const credential = String(hostCredential || '');
  if (credential.length < 16 || credential.length > 1024) {
    throw signingKeyError('PRIMARY_HOST_SIGNING_CREDENTIAL_INVALID');
  }
  try {
    const seed = Buffer.from(crypto.hkdfSync(
      'sha256',
      Buffer.from(credential, 'utf8'),
      KEY_DERIVATION_SALT,
      KEY_DERIVATION_INFO,
      32,
    ));
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });
    seed.fill(0);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const publicKeyFingerprint = crypto.createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    return Object.freeze({
      algorithm: 'Ed25519',
      publicKeyPem,
      publicKeyFingerprint,
      privateKey,
    });
  } catch (cause) {
    if (cause?.code === 'PRIMARY_HOST_SIGNING_CREDENTIAL_INVALID') throw cause;
    throw signingKeyError('PRIMARY_HOST_SIGNING_KEY_DERIVATION_FAILED', cause);
  }
}

function validatePrimaryHostSigningPublicKey(value = {}) {
  try {
    const publicKeyPem = String(value.publicKeyPem || '').trim();
    const publicKeyFingerprint = String(value.publicKeyFingerprint || '').trim().toLowerCase();
    const publicKey = crypto.createPublicKey(publicKeyPem);
    const derivedPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const derivedFingerprint = crypto.createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    if (value.algorithm !== 'Ed25519'
      || publicKey.asymmetricKeyType !== 'ed25519'
      || !/^[a-f0-9]{64}$/.test(publicKeyFingerprint)
      || publicKeyFingerprint !== derivedFingerprint) {
      throw signingKeyError('PRIMARY_HOST_SIGNING_PUBLIC_KEY_INVALID');
    }
    return Object.freeze({
      algorithm: 'Ed25519',
      publicKeyPem: derivedPem,
      publicKeyFingerprint: derivedFingerprint,
    });
  } catch (cause) {
    if (cause?.code === 'PRIMARY_HOST_SIGNING_PUBLIC_KEY_INVALID') throw cause;
    throw signingKeyError('PRIMARY_HOST_SIGNING_PUBLIC_KEY_INVALID', cause);
  }
}

function signPrimaryHostProjection({ hostCredential, projection } = {}) {
  const signingKey = derivePrimaryHostSigningKey(hostCredential);
  try {
    return createSignedAuthorityProjection({
      protocol: AUTHORITY_PROJECTION_PROTOCOL,
      ...(projection || {}),
      privateKey: signingKey.privateKey,
    });
  } catch (cause) {
    throw signingKeyError(cause?.code || 'PRIMARY_HOST_PROJECTION_SIGNING_FAILED', cause);
  }
}

module.exports = {
  derivePrimaryHostSigningKey,
  signPrimaryHostProjection,
  signingKeyError,
  validatePrimaryHostSigningPublicKey,
};
