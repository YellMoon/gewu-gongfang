const assert = require('assert');
const {
  createArtifactDownloadToken,
  verifyArtifactDownloadToken,
} = require('./paperArtifactAccess');

const artifact = { artifact_id: 'artifact-1', task_id: 'task-1', owner_user_id: 'owner-a', tenant_id: 'tenant-a' };
const secrets = { current: 'download-secret-current-32-bytes!!', previous: 'download-secret-previous-32-bytes!' };
assert.throws(() => createArtifactDownloadToken(artifact, { secret: '' }), error => error.code === 'ARTIFACT_DOWNLOAD_SECRET_REQUIRED');
assert.throws(() => createArtifactDownloadToken(artifact, { secret: 'short-secret' }), error => error.code === 'ARTIFACT_DOWNLOAD_SECRET_WEAK');
assert.throws(() => createArtifactDownloadToken(artifact, { secret: 'a'.repeat(32) }), error => error.code === 'ARTIFACT_DOWNLOAD_SECRET_WEAK');
const token = createArtifactDownloadToken(artifact, {
  secret: secrets.current, kid: 'current', now: '2026-07-13T00:00:00.000Z', ttlSeconds: 60,
});
assert.deepStrictEqual(
  verifyArtifactDownloadToken(artifact, token, { secrets, actorUserId: 'owner-a', tenantId: 'tenant-a', now: '2026-07-13T00:00:30.000Z' }),
  { authorized: true, kid: 'current' },
  'owner can download with a valid task/tenant/expiry-bound signature'
);
assert.strictEqual(verifyArtifactDownloadToken(artifact, token, { secrets, actorUserId: 'admin-a', tenantId: 'tenant-a', isAdmin: true, now: '2026-07-13T00:00:30.000Z' }).authorized, true);
assert.throws(() => verifyArtifactDownloadToken(artifact, token, { secrets, actorUserId: 'other', tenantId: 'tenant-a', now: '2026-07-13T00:00:30.000Z' }), error => error.code === 'ARTIFACT_DOWNLOAD_FORBIDDEN');
assert.throws(() => verifyArtifactDownloadToken({ ...artifact, task_id: 'task-tampered' }, token, { secrets, actorUserId: 'owner-a', tenantId: 'tenant-a', now: '2026-07-13T00:00:30.000Z' }), error => error.code === 'ARTIFACT_DOWNLOAD_SIGNATURE_INVALID');
assert.throws(() => verifyArtifactDownloadToken(artifact, `${token.slice(0, -1)}x`, { secrets, actorUserId: 'owner-a', tenantId: 'tenant-a', now: '2026-07-13T00:00:30.000Z' }), error => error.code === 'ARTIFACT_DOWNLOAD_SIGNATURE_INVALID');
assert.throws(() => verifyArtifactDownloadToken(artifact, token, { secrets, actorUserId: 'owner-a', tenantId: 'tenant-a', now: '2026-07-13T00:02:00.000Z' }), error => error.code === 'ARTIFACT_DOWNLOAD_EXPIRED');
assert.throws(() => verifyArtifactDownloadToken(artifact, token, { secrets, actorUserId: 'owner-a', tenantId: 'tenant-a', now: '2026-07-13T00:01:00.000Z' }), error => error.code === 'ARTIFACT_DOWNLOAD_EXPIRED', 'token must be expired at now === exp');
assert.throws(() => verifyArtifactDownloadToken(artifact, token, { secrets: { other: secrets.current }, actorUserId: 'owner-a', tenantId: 'tenant-a' }), error => error.code === 'ARTIFACT_DOWNLOAD_KID_UNKNOWN');

console.log('paper artifact access checks passed');
