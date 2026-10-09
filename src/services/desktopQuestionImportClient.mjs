import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';
import { resolveDesktopIdentityBaseUrl } from './managedSyncConfig.mjs';

function failure(code, status = 0) {
  return Object.assign(new Error(code), { code, status });
}

function trimSlash(value) { return String(value || '').replace(/\/+$/, ''); }
function safeWordFileName(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 5
    && value.length <= 512
    && !/[\\/\u0000\r\n]/.test(value)
    && /^[\p{L}\p{N}]/u.test(value)
    && /\.(?:doc|docx)$/iu.test(value);
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
  return value;
}
function ids(value, prefix) { return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_-]{8,128}$`).test(value); }
function taskRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !ids(value.taskId, 'question_import_task')
    || typeof value.status !== 'string' || typeof value.phase !== 'string') throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
  return value;
}
function apiBase(config) {
  const base = trimSlash(resolveDesktopIdentityBaseUrl(config));
  if (!/^https:\/\//i.test(base)) throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
  return `${base}/api/desktop/question-imports`;
}
function assetApiBase(config) {
  const base = trimSlash(resolveDesktopIdentityBaseUrl(config));
  if (!/^https:\/\//i.test(base)) throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
  return `${base}/api/desktop/question-bank/assets`;
}
function authorization(deps) {
  const session = (deps.readSession || readDesktopAuthorizationSession)(deps.authStorage || globalThis.sessionStorage);
  if (!session?.authorization || !session?.authContext?.deviceId) throw failure('AUTHORIZATION_CONTEXT_REQUIRED');
  return { Authorization: session.authorization, 'x-device-id': session.authContext.deviceId };
}
async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw failure(String(payload?.code || `HTTP_${response.status}`), response.status);
  return payload;
}
function nextId(prefix, deps) {
  const raw = String((deps.idFactory || (() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`))()).replace(/[^A-Za-z0-9_-]/g, '');
  const value = `${prefix}_${raw}`;
  if (!ids(value, prefix)) throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
  return value;
}
function relayRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !ids(value.taskId, 'task') || !ids(value.assetId, 'asset')
    || typeof value.expiresAt !== 'string' || new Date(value.expiresAt).toISOString() !== value.expiresAt) {
    throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
  }
  return value;
}
function relayStatusRow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !ids(value.taskId, 'task') || !ids(value.assetId, 'asset')
    || !['queued', 'leased', 'verified', 'failed_retryable', 'quarantined'].includes(value.state)
    || !(value.verifiedAt === null || (typeof value.verifiedAt === 'string' && new Date(value.verifiedAt).toISOString() === value.verifiedAt))) {
    throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
  }
  if ((value.state === 'verified') !== (typeof value.verifiedAt === 'string')) throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
  return value;
}

export function createDesktopQuestionImportClient(config = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const seal = deps.seal || globalThis.questionImportRelay?.sealSource;
  const sealAsset = deps.sealAsset || globalThis.questionImportRelay?.sealAsset;
  const parse = deps.parse || globalThis.questionImportRelay?.parseSource;
  const now = deps.now || (() => new Date());
  if (typeof fetchImpl !== 'function' || (typeof seal !== 'function' && typeof sealAsset !== 'function' && typeof parse !== 'function') || typeof now !== 'function') throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
  const base = apiBase(config);
  const assetBase = assetApiBase(config);
  const pendingCreates = new WeakMap();
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: { ...authorization(deps), ...(options.headers || {}) } });
    return responseJson(response);
  }
  function parsedRow(value, allowSkippedEmpty = false) {
    if (!value || !/^[0-9a-f]{64}$/.test(value.sourceSha256 || '') || !/^[0-9a-f]{64}$/.test(value.parserSha256 || '')
      || !Array.isArray(value.candidates) || (value.candidates.length < 1 && !(allowSkippedEmpty && value.qualityReport?.topic_collection?.skipped_groups?.length)) || value.candidates.length > 500
      || !Array.isArray(value.mediaBytes) || value.mediaBytes.length !== value.candidates.length
      || value.candidates.some((item, index) => !Array.isArray(item.mediaManifest) || !Array.isArray(value.mediaBytes[index])
        || item.mediaManifest.length !== value.mediaBytes[index].length
        || value.mediaBytes[index].some(bytes => !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 64 * 1024 * 1024))) {
      throw failure('QUESTION_INTAKE_RESULT_INVALID');
    }
    return value;
  }
  async function uploadParsedMedia(task, parsed) {
    const targets = task.mediaTargets || [];
    if (targets.length !== parsed.mediaBytes.reduce((sum, media) => sum + media.length, 0)) throw failure('QUESTION_INTAKE_MEDIA_TARGETS_INVALID');
    const seen = new Set();
    for (const target of targets) {
      const key = `${target.itemIndex}:${target.assetIndex}`;
      const bytes = parsed.mediaBytes[target.itemIndex]?.[target.assetIndex];
      const expected = parsed.candidates[target.itemIndex]?.mediaManifest?.[target.assetIndex];
      if (seen.has(key) || !bytes || !expected || target.sha256 !== expected.sha256 || target.bytes !== bytes.length
        || target.mimeType !== expected.mimeType || !ids(target.storageTaskId, 'task') || !ids(target.objectId, 'obj')
        || !ids(target.mediaId, 'question_import_media') || target.objectVersion !== 1 || typeof sealAsset !== 'function') throw failure('QUESTION_INTAKE_MEDIA_TARGETS_INVALID');
      seen.add(key);
      if (target.storageState === 'verified') continue;
      const relayKey = await request('/relay-key');
      if (relayKey.intakeProcessing !== 'desktop-v1' || !/^[A-Za-z0-9_-]{40,4096}$/.test(relayKey.agentPublicKey || '')
        || !/^[0-9a-f]{64}$/.test(relayKey.agentKeyFingerprint || '')) throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
      const sealed = await sealAsset({ agentPublicKey: relayKey.agentPublicKey, storageTaskId: target.storageTaskId, objectId: target.objectId, objectVersion: target.objectVersion, bytes });
      if (sealed.sourceSha256 !== target.sha256 || sealed.sourceBytes !== target.bytes) throw failure('QUESTION_INTAKE_SOURCE_MISMATCH');
      await request(`/${encodeURIComponent(task.taskId)}/media/${encodeURIComponent(target.mediaId)}/relay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          agentKeyFingerprint: relayKey.agentKeyFingerprint, envelope: sealed.envelope, ciphertextBase64: sealed.ciphertextBase64,
          expiresAt: new Date(now().getTime() + 15 * 60 * 1000).toISOString(),
        }),
      });
    }
    return task;
  }
  return Object.freeze({
    async withEditedCandidates(value, questions) {
      const parsed = parsedRow(value);
      if (!Array.isArray(questions) || questions.length !== parsed.candidates.length) throw failure('QUESTION_INTAKE_RESULT_INVALID');
      function stable(value) {
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
        return JSON.stringify(value);
      }
      const candidates = await Promise.all(parsed.candidates.map(async (item, index) => {
        const candidate = JSON.parse(JSON.stringify({ ...questions[index], assets: item.candidate.assets }));
        const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(candidate)));
        return { ...item, candidate, contentHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
      }));
      return { ...parsed, candidates };
    },
    async parseFromWord(input) {
      const current = exact(input, ['sourceType', 'sourceFileName', 'bytes']);
      if (!['lecture', 'exam', 'topic'].includes(current.sourceType) || !safeWordFileName(current.sourceFileName)
        || !(current.bytes instanceof Uint8Array) || !current.bytes.length || current.bytes.length > 64 * 1024 * 1024) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      if (typeof parse !== 'function') throw failure('QUESTION_INTAKE_DESKTOP_REQUIRED');
      return parsedRow(await parse(current), current.sourceType === 'topic');
    },
    async createFromWord(input) {
      const original = exact(input, ['sourceType', 'sourceFileName', 'sourceMimeType', 'bytes', 'metadata']);
      const parsed = await this.parseFromWord({ sourceType: original.sourceType, sourceFileName: original.sourceFileName, bytes: original.bytes });
      return this.createFromParsed({ ...original, parsed,
        sourceType: original.sourceType === 'topic' ? 'lecture' : original.sourceType,
        metadata: original.sourceType === 'topic' ? { ...original.metadata, importFormat: 'topic' } : original.metadata });
    },
    async createFromParsed(input) {
      if (typeof seal !== 'function') throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
      const requestInput = exact(input, ['sourceType', 'sourceFileName', 'sourceMimeType', 'bytes', 'metadata', 'parsed']);
      if (!['lecture', 'exam'].includes(requestInput.sourceType) || !safeWordFileName(requestInput.sourceFileName)
        || !['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(requestInput.sourceMimeType)
        || !(requestInput.bytes instanceof Uint8Array) || !requestInput.bytes.byteLength || requestInput.bytes.byteLength > (64 * 1024 * 1024)
        || !requestInput.metadata || typeof requestInput.metadata !== 'object' || Array.isArray(requestInput.metadata)) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      const parsed = parsedRow(requestInput.parsed);
      const retryDigest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(requestInput.bytes));
      const sourceIdentity = Array.from(new Uint8Array(retryDigest), byte => byte.toString(16).padStart(2, '0')).join('');
      const retrySignature = JSON.stringify([requestInput.sourceType, requestInput.sourceFileName, requestInput.sourceMimeType,
        sourceIdentity, requestInput.metadata, parsed.sourceSha256, parsed.parserSha256, parsed.candidates]);
      let pending = pendingCreates.get(parsed);
      if (pending && pending.signature !== retrySignature) throw failure('QUESTION_INTAKE_RETRY_CHANGED');
      if (!pending) {
        const relayKey = await request('/relay-key');
        if (relayKey.intakeProcessing !== 'desktop-v1') throw failure('QUESTION_INTAKE_CLOUD_UPGRADE_REQUIRED');
        if (typeof relayKey.agentPublicKey !== 'string' || !/^[A-Za-z0-9_-]{40,4096}$/.test(relayKey.agentPublicKey)
          || typeof relayKey.agentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(relayKey.agentKeyFingerprint)) throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
        const storageTaskId = nextId('task', deps);
        const objectId = nextId('obj', deps);
        const sealed = await seal({ agentPublicKey: relayKey.agentPublicKey, storageTaskId, objectId, objectVersion: 1, bytes: requestInput.bytes });
        if (sealed?.sourceSha256 !== parsed.sourceSha256) throw failure('QUESTION_INTAKE_SOURCE_MISMATCH');
        if (!sealed || typeof sealed !== 'object' || !/^[0-9a-f]{64}$/.test(sealed.sourceSha256 || '') || !Number.isSafeInteger(sealed.sourceBytes)
          || sealed.sourceBytes !== requestInput.bytes.byteLength || !sealed.envelope || typeof sealed.ciphertextBase64 !== 'string') throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
        const current = now();
        if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
        const expiresAt = new Date(current.getTime() + (15 * 60 * 1000)).toISOString();
        const idempotencyKey = nextId('question_import_request', deps);
        pending = { signature: retrySignature, idempotencyKey, body: JSON.stringify({
            sourceType: requestInput.sourceType, sourceFileName: requestInput.sourceFileName, sourceMimeType: requestInput.sourceMimeType,
            sourceSha256: sealed.sourceSha256, sourceBytes: sealed.sourceBytes, metadata: requestInput.metadata,
            storage: { taskId: storageTaskId, objectId, objectVersion: 1 },
            relay: { agentKeyFingerprint: relayKey.agentKeyFingerprint, envelope: sealed.envelope, ciphertextBase64: sealed.ciphertextBase64, expiresAt },
            parsed: { parserSha256: parsed.parserSha256, candidates: parsed.candidates },
          }),
        };
        pendingCreates.set(parsed, pending);
      }
      const payload = await request('/parsed', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-idempotency-key': pending.idempotencyKey }, body: pending.body,
      });
      const task = taskRow(payload.task);
      try { return await uploadParsedMedia(task, parsed); }
      catch (error) { error.task = task; throw error; }
    },
    async resumeMedia(task, parsed) { return uploadParsedMedia(taskRow(task), parsedRow(parsed)); },
    async read(taskId) {
      if (!ids(taskId, 'question_import_task')) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      return taskRow((await request(`/${encodeURIComponent(taskId)}`)).task);
    },
    async prepareDrafts(taskId) {
      if (!ids(taskId, 'question_import_task')) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      return taskRow((await request(`/${encodeURIComponent(taskId)}/prepare-drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).task);
    },
    async relayAsset(input) {
      if (typeof sealAsset !== 'function') throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
      const requestInput = exact(input, ['questionId', 'assetId', 'assetType', 'fileName', 'mimeType', 'bytes', 'storage']);
      if (typeof requestInput.questionId !== 'string' || !requestInput.questionId.trim() || requestInput.questionId.length > 128
        || !ids(requestInput.assetId, 'asset') || typeof requestInput.assetType !== 'string' || !requestInput.assetType.trim() || requestInput.assetType.length > 128
        || !(requestInput.fileName === null || (typeof requestInput.fileName === 'string' && requestInput.fileName.trim() && requestInput.fileName.length <= 512 && !/[\\/\r\n]/.test(requestInput.fileName)))
        || typeof requestInput.mimeType !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+/-]{0,254}$/.test(requestInput.mimeType)
        || !(requestInput.bytes instanceof Uint8Array) || !requestInput.bytes.byteLength || requestInput.bytes.byteLength > (64 * 1024 * 1024)) {
        throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      }
      const storage = requestInput.storage;
      if (!storage || typeof storage !== 'object' || Array.isArray(storage)
        || !ids(storage.taskId, 'task') || !ids(storage.objectId, 'obj')
        || !Number.isSafeInteger(storage.objectVersion) || storage.objectVersion < 1) {
        throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      }
      const relayKeyResponse = await fetchImpl(`${assetBase}/relay-key`, { headers: authorization(deps) });
      const relayKey = await responseJson(relayKeyResponse);
      if (typeof relayKey.agentPublicKey !== 'string' || !/^[A-Za-z0-9_-]{40,4096}$/.test(relayKey.agentPublicKey)
        || typeof relayKey.agentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(relayKey.agentKeyFingerprint)) throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
      const sealed = await sealAsset({ agentPublicKey: relayKey.agentPublicKey, storageTaskId: storage.taskId, objectId: storage.objectId, objectVersion: storage.objectVersion, bytes: requestInput.bytes });
      if (!sealed || typeof sealed !== 'object' || !/^[0-9a-f]{64}$/.test(sealed.sourceSha256 || '') || !Number.isSafeInteger(sealed.sourceBytes)
        || sealed.sourceBytes !== requestInput.bytes.byteLength || !sealed.envelope || typeof sealed.ciphertextBase64 !== 'string') throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
      const current = now();
      if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
      const response = await fetchImpl(`${assetBase}/relay`, {
        method: 'POST',
        headers: { ...authorization(deps), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: requestInput.questionId, assetId: requestInput.assetId, taskId: storage.taskId, objectId: storage.objectId, objectVersion: storage.objectVersion,
          assetType: requestInput.assetType, fileName: requestInput.fileName, mimeType: requestInput.mimeType,
          agentKeyFingerprint: relayKey.agentKeyFingerprint, envelope: sealed.envelope, ciphertextBase64: sealed.ciphertextBase64,
          expiresAt: new Date(current.getTime() + (15 * 60 * 1000)).toISOString(),
        }),
      });
      return relayRow((await responseJson(response)).relay);
    },
    async readAssetRelay(taskId) {
      if (!ids(taskId, 'task')) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      const response = await fetchImpl(`${assetBase}/relay/${encodeURIComponent(taskId)}`, { headers: authorization(deps) });
      return relayStatusRow((await responseJson(response)).relay);
    },
  });
}
