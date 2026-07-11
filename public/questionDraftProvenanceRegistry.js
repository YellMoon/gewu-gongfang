const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class QuestionDraftProvenanceRegistry {
  constructor({ filePath, tokenVerifier }) { this.filePath = filePath; this.tokenVerifier = tokenVerifier; }
  _read() { try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch (_error) { return {}; } }
  _write(value) { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(tmp, this.filePath); }
  async issue(token) {
    const claims = await this.tokenVerifier(token);
    if (!claims?.userId || !claims?.deviceId || claims.tokenUse !== 'desktop-session') throw Object.assign(new Error('TRUSTED_DESKTOP_TOKEN_REQUIRED'), { code: 'TRUSTED_DESKTOP_TOKEN_REQUIRED' });
    const data = this._read(); let questionId;
    do { questionId = crypto.randomUUID(); } while (data[questionId]);
    data[questionId] = { userId: claims.userId, deviceId: claims.deviceId, registeredAt: new Date().toISOString() }; this._write(data);
    return { questionId };
  }
  async verify(questionId, token) {
    const claims = await this.tokenVerifier(token); const existing = this._read()[questionId];
    return Boolean(existing && claims?.tokenUse === 'desktop-session' && existing.userId === claims.userId && existing.deviceId === claims.deviceId);
  }
}
module.exports = { QuestionDraftProvenanceRegistry };
