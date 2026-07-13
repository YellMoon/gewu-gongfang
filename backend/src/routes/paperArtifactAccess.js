const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { getInstance } = require('../database');
const { resolveBoundQuestionBankRoot } = require('../services/questionBankStorageService');
const { createArtifactDownloadToken, verifyArtifactDownloadToken } = require('../services/paperArtifactAccess');

const router = Router();
function actor(req) {
  return { id: req.user?.id || req.authz?.userId || '', role: req.user?.role || req.user?.user_type || req.authz?.role || '',
    tenantId: req.tenantId || req.user?.tenantId || req.user?.tenant_id || 'default' };
}
function artifactRow(req) {
  const service = getInstance(); const db = service.db || service;
  return { db, artifact: db.prepare("SELECT * FROM paper_artifacts WHERE artifact_id=? AND storage_status='verified'").get(req.params.artifactId) };
}

router.get('/:artifactId/access', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { artifact } = artifactRow(req); const currentActor = actor(req);
    if (!currentActor.id) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'authentication required' });
    if (!artifact) return res.status(404).json({ success: false, code: 'ARTIFACT_NOT_FOUND', error: 'artifact not found' });
    if (artifact.expires_at && artifact.expires_at <= new Date().toISOString()) return res.status(410).json({ success: false, code: 'ARTIFACT_EXPIRED', error: 'artifact expired' });
    const authorized = currentActor.id === artifact.owner_user_id || (['admin', 'super_admin'].includes(currentActor.role) && String(currentActor.tenantId) === String(artifact.tenant_id));
    if (!authorized) return res.status(403).json({ success: false, code: 'ARTIFACT_DOWNLOAD_FORBIDDEN', error: 'artifact download is forbidden' });
    const token = createArtifactDownloadToken(artifact, { secret: process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET || '',
      kid: process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_KID || 'current', ttlSeconds: Number(process.env.GEWU_ARTIFACT_DOWNLOAD_TTL_SECONDS || 300) });
    return res.json({ success: true, data: { artifactId: artifact.artifact_id, fileName: path.basename(artifact.file_path),
      fileUrl: `/api/cloud-relay-host/artifacts/${encodeURIComponent(artifact.artifact_id)}`, token } });
  } catch (error) { if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, error: error.message }); next(error); }
});

router.get('/:artifactId', (req, res, next) => {
  try {
    const { db, artifact } = artifactRow(req); const currentActor = actor(req);
    if (!currentActor.id) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'authentication required' });
    if (!artifact) return res.status(404).json({ success: false, code: 'ARTIFACT_NOT_FOUND', error: 'artifact not found' });
    const currentKid = process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_KID || 'current'; const currentSecret = process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_SECRET || '';
    if (!currentSecret) return res.status(503).json({ success: false, code: 'ARTIFACT_DOWNLOAD_SECRET_REQUIRED', error: 'artifact downloads are not configured' });
    const secrets = { [currentKid]: currentSecret };
    if (process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_PREVIOUS_SECRET) secrets[process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_PREVIOUS_KID || 'previous'] = process.env.GEWU_ARTIFACT_DOWNLOAD_HMAC_PREVIOUS_SECRET;
    const authorization = String(req.headers.authorization || '');
    verifyArtifactDownloadToken(artifact, req.get('x-gewu-artifact-token') || (authorization.startsWith('Artifact ') ? authorization.slice(9).trim() : ''), {
      secrets, actorUserId: currentActor.id, tenantId: currentActor.tenantId, isAdmin: ['admin', 'super_admin'].includes(currentActor.role),
    });
    if (artifact.expires_at && artifact.expires_at <= new Date().toISOString()) return res.status(410).json({ success: false, code: 'ARTIFACT_EXPIRED', error: 'artifact expired' });
    const root = resolveBoundQuestionBankRoot(db); const expected = path.resolve(root, 'assets', 'exports'); const filePath = path.resolve(artifact.file_path);
    const relative = path.relative(expected, filePath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return res.status(403).json({ success: false, code: 'ARTIFACT_PATH_INVALID', error: 'artifact path invalid' });
    if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) return res.status(404).json({ success: false, code: 'ARTIFACT_NOT_FOUND', error: 'artifact not found' });
    return res.download(filePath, path.basename(filePath));
  } catch (error) { if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, error: error.message }); next(error); }
});

module.exports = router;
