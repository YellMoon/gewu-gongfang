import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';
import { resolveDesktopIdentityBaseUrl } from './managedSyncConfig.mjs';

function failure(code, status = 0) {
  return Object.assign(new Error(code), { code, status });
}

function trimSlash(value) { return String(value || '').replace(/\/+$/, ''); }
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

export function createDesktopQuestionImportClient(config = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const seal = deps.seal || globalThis.questionImportRelay?.sealSource;
  const now = deps.now || (() => new Date());
  if (typeof fetchImpl !== 'function' || typeof seal !== 'function' || typeof now !== 'function') throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
  const base = apiBase(config);
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: { ...authorization(deps), ...(options.headers || {}) } });
    return responseJson(response);
  }
  return Object.freeze({
    async createFromWord(input) {
      const requestInput = exact(input, ['sourceType', 'sourceFileName', 'sourceMimeType', 'bytes', 'metadata']);
      if (!['lecture', 'exam'].includes(requestInput.sourceType) || typeof requestInput.sourceFileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,507}\.(?:doc|docx)$/iu.test(requestInput.sourceFileName)
        || !['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(requestInput.sourceMimeType)
        || !(requestInput.bytes instanceof Uint8Array) || !requestInput.bytes.byteLength || requestInput.bytes.byteLength > (64 * 1024 * 1024)
        || !requestInput.metadata || typeof requestInput.metadata !== 'object' || Array.isArray(requestInput.metadata)) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      const relayKey = await request('/relay-key');
      if (typeof relayKey.agentPublicKey !== 'string' || !/^[A-Za-z0-9_-]{40,4096}$/.test(relayKey.agentPublicKey)
        || typeof relayKey.agentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(relayKey.agentKeyFingerprint)) throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
      const storageTaskId = nextId('task', deps);
      const objectId = nextId('obj', deps);
      const sealed = await seal({ agentPublicKey: relayKey.agentPublicKey, storageTaskId, objectId, objectVersion: 1, bytes: requestInput.bytes });
      if (!sealed || typeof sealed !== 'object' || !/^[0-9a-f]{64}$/.test(sealed.sourceSha256 || '') || !Number.isSafeInteger(sealed.sourceBytes)
        || sealed.sourceBytes !== requestInput.bytes.byteLength || !sealed.envelope || typeof sealed.ciphertextBase64 !== 'string') throw failure('QUESTION_IMPORT_CLIENT_RESPONSE_INVALID');
      const current = now();
      if (!(current instanceof Date) || !Number.isFinite(current.getTime())) throw failure('QUESTION_IMPORT_CLIENT_CONFIG_INVALID');
      const expiresAt = new Date(current.getTime() + (15 * 60 * 1000)).toISOString();
      const idempotencyKey = nextId('question_import_request', deps);
      const payload = await request('', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idempotencyKey }, body: JSON.stringify({
          sourceType: requestInput.sourceType, sourceFileName: requestInput.sourceFileName, sourceMimeType: requestInput.sourceMimeType,
          sourceSha256: sealed.sourceSha256, sourceBytes: sealed.sourceBytes, metadata: requestInput.metadata,
          storage: { taskId: storageTaskId, objectId, objectVersion: 1 },
          relay: { agentKeyFingerprint: relayKey.agentKeyFingerprint, envelope: sealed.envelope, ciphertextBase64: sealed.ciphertextBase64, expiresAt },
        }),
      });
      return taskRow(payload.task);
    },
    async read(taskId) {
      if (!ids(taskId, 'question_import_task')) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      return taskRow((await request(`/${encodeURIComponent(taskId)}`)).task);
    },
    async prepareDrafts(taskId) {
      if (!ids(taskId, 'question_import_task')) throw failure('QUESTION_IMPORT_CLIENT_INPUT_INVALID');
      return taskRow((await request(`/${encodeURIComponent(taskId)}/prepare-drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).task);
    },
  });
}
