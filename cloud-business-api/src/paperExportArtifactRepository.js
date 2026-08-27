'use strict';

const crypto = require('crypto');
const { sealForAgent } = require('../../shared/encryptedNasRelay');
const { assertPdfArtifact } = require('./pdfArtifactValidation');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function text(value, max) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) throw failure('CLOUD_PAPER_ARTIFACT_INPUT_INVALID');
  return value;
}

function createPaperExportArtifactRepository({ query, agentPublicKey, randomId = () => crypto.randomUUID(), now = () => new Date() } = {}) {
  if (typeof query !== 'function' || typeof agentPublicKey !== 'string' || !agentPublicKey || typeof randomId !== 'function' || typeof now !== 'function') {
    throw failure('CLOUD_PAPER_ARTIFACT_INPUT_INVALID');
  }
  return Object.freeze({
    async archive(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('CLOUD_PAPER_ARTIFACT_INPUT_INVALID');
      const taskId = text(input.taskId, 160);
      const tenantId = text(input.tenantId, 128);
      const accountId = text(input.accountId, 512);
      const format = ['word', 'pdf'].includes(input.format) ? input.format : null;
      const fileName = text(input.fileName, 512);
      const mimeType = text(input.mimeType, 255);
      const bytes = Buffer.isBuffer(input.bytes) ? Buffer.from(input.bytes) : null;
      if (!format || !bytes || bytes.length < 1 || bytes.length > 64 * 1024 * 1024) throw failure('CLOUD_PAPER_ARTIFACT_INPUT_INVALID');
      if (format === 'pdf') assertPdfArtifact(bytes);
      const suffix = String(randomId()).replace(/[^A-Za-z0-9_-]/g, '');
      const artifactId = 'paper_artifact_' + suffix;
      const storageTaskId = 'task_' + suffix;
      const objectId = 'obj_paper_' + suffix;
      const contentSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const sealed = sealForAgent({ agentPublicKey, binding: storageTaskId + ':' + objectId + ':1', plaintext: bytes });
      const expiresAt = new Date(now().getTime() + 15 * 60 * 1000);
      const result = await query([
        'WITH storage_task AS (',
        "INSERT INTO business.storage_object_tasks(task_id,object_id,object_version,expected_sha256,expected_bytes,media_type,state)",
        "VALUES($1,$2,1,$3,$4,$5,'queued') RETURNING task_id",
        '), artifact AS (',
        "INSERT INTO business.paper_export_artifacts(artifact_id,paper_task_id,tenant_id,account_id,format,file_name,mime_type,object_id,content_sha256,size_bytes,storage_task_id)",
        'SELECT $6,$7,$8,$9,$10,$11,$5,$2,$3,$4,$1 FROM storage_task RETURNING artifact_id',
        '), relay AS (',
        "INSERT INTO business.encrypted_paper_export_artifact_relays(storage_task_id,artifact_id,tenant_id,agent_key_fingerprint,envelope_json,ciphertext,ciphertext_sha256,expires_at)",
        'SELECT $1,$6,$8,$12,$13::jsonb,$14,$15,$16::timestamptz FROM artifact RETURNING artifact_id',
        ') SELECT artifact_id AS "artifactId" FROM relay',
      ].join(' '), [storageTaskId, objectId, contentSha256, bytes.length, mimeType, artifactId, taskId, tenantId, accountId, format, fileName,
        crypto.createHash('sha256').update(Buffer.from(agentPublicKey, 'base64url')).digest('hex'), JSON.stringify(sealed.envelope), sealed.ciphertext, sealed.envelope.ciphertextSha256, expiresAt.toISOString()]);
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 || result.rows[0].artifactId !== artifactId) throw failure('CLOUD_PAPER_ARTIFACT_UNAVAILABLE');
      return { artifactId };
    },
  });
}

module.exports = Object.freeze({ createPaperExportArtifactRepository });
