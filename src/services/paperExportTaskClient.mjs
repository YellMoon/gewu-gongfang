import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';

export const paperExportTaskStorageKey = 'gewu_paper_export_tasks_v1';
export const paperExportTerminalStatuses = new Set(['completed', 'failed', 'cancelled', 'timed_out']);

function trimSlash(value) { return String(value || '').replace(/\/+$/, ''); }
function nowIso(deps) { return (deps.now || (() => new Date().toISOString()))(); }
function randomId(deps) { return (deps.idempotencyKeyFactory || (() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`))(); }
function taskStorage(deps) { return deps.taskStorage || globalThis.localStorage; }
function authHeaders(deps, json = false) {
  const session = readDesktopAuthorizationSession(deps.authStorage || deps.storage || globalThis.sessionStorage);
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: session.authorization,
    'x-device-id': session.authContext.deviceId,
  };
}

export function cloudTaskApiBase(config = {}) {
  const base = cloudBusinessApiBase(config);
  return base + '/api/desktop/paper-export-tasks';
}

function cloudBusinessApiBase(config = {}) {
  const base = trimSlash(config.cloudBusinessIdentityBaseUrl || 'https://physicsedu.xyz/cloud-business');
  if (!base) throw Object.assign(new Error('CLOUD_BASE_URL_REQUIRED'), { code: 'CLOUD_BASE_URL_REQUIRED' });
  return base;
}

function cloudUrl(cloudBaseUrl, path) {
  const base = trimSlash(cloudBaseUrl);
  if (!base) throw Object.assign(new Error('CLOUD_BASE_URL_REQUIRED'), { code: 'CLOUD_BASE_URL_REQUIRED' });
  if (/^https?:\/\//i.test(String(path || ''))) return String(path);
  return `${base}${String(path || '').startsWith('/') ? path : `/${path}`}`;
}

function responseError(payload, status) {
  const code = payload?.code || payload?.error || `HTTP_${status}`;
  return Object.assign(new Error(String(payload?.error || payload?.message || code)), { code, status });
}

function readRows(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(paperExportTaskStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) { return []; }
}

function writeRows(storage, rows) {
  storage?.setItem?.(paperExportTaskStorageKey, JSON.stringify(rows.slice(0, 30)));
  return rows;
}

export function loadPaperExportTasks(storage = globalThis.localStorage) {
  return readRows(storage).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function upsertTask(storage, task) {
  const rows = readRows(storage);
  const index = rows.findIndex(row => row.localId === task.localId);
  if (index >= 0) rows[index] = task; else rows.unshift(task);
  writeRows(storage, rows);
  return task;
}

function resultFromServer(row) {
  return row?.result_payload || row?.result || null;
}

function normalizeRemote(local, row, timestamp) {
    const rawStatus = String(row?.status || local.status || 'queued');
  const status = rawStatus === 'failed' && String(row?.error_code || '').includes('DEADLINE') ? 'timed_out' : rawStatus;
  return {
    ...local,
    serverTaskId: String(row?.taskId || row?.id || local.serverTaskId || ''),
    status,
    phase: String(row?.phase || status),
    progress: Math.max(0, Math.min(100, Number(row?.progress || (status === 'completed' ? 100 : 0)))),
    message: String(row?.message || row?.error_code || resultFromServer(row)?.message || ''),
    errorCode: String(row?.error_code || ''),
    result: resultFromServer(row),
    accepted: true,
    updatedAt: timestamp,
  };
}

async function submitDraft(config, draft, deps) {
  const storage = taskStorage(deps);
  try {
    const fetchImpl = deps.fetchImpl || globalThis.fetch;
    const response = await fetchImpl(cloudTaskApiBase(config), {
      method: 'POST',
      headers: { ...authHeaders(deps, true), 'x-idempotency-key': draft.idempotencyKey },
      body: JSON.stringify({
        taskType: `paper-export-${draft.request.format}`,
        payload: {
          questionIds: [...draft.request.questionIds], answerPosition: draft.request.answerPosition,
          formulaMode: draft.request.formulaMode, title: draft.request.title, subject: draft.request.subject || '',
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.task?.taskId) throw responseError(payload, response.status);
    const task = normalizeRemote(draft, payload.task, nowIso(deps));
    upsertTask(storage, task);
    return { accepted: true, task };
  } catch (error) {
    const task = { ...draft, status: 'draft', accepted: false, errorCode: String(error?.code || ''), message: String(error?.message || error), updatedAt: nowIso(deps) };
    upsertTask(storage, task);
    return { accepted: false, task, error };
  }
}

export async function submitPaperExportTask(config, input, deps = {}) {
  const timestamp = nowIso(deps);
  const idempotencyKey = randomId(deps);
  const draft = {
    localId: `paper_${idempotencyKey}`,
    idempotencyKey,
    request: { ...input, questionIds: [...(input.questionIds || [])] },
    status: 'draft', phase: 'draft', progress: 0, accepted: false,
    createdAt: timestamp, updatedAt: timestamp, message: '', errorCode: '', result: null,
  };
  upsertTask(taskStorage(deps), draft);
  return submitDraft(config, draft, deps);
}

function requireStoredTask(localId, deps) {
  const task = readRows(taskStorage(deps)).find(row => row.localId === localId);
  if (!task) throw Object.assign(new Error('PAPER_EXPORT_TASK_NOT_FOUND'), { code: 'PAPER_EXPORT_TASK_NOT_FOUND' });
  return task;
}

export async function refreshPaperExportTask(config, localId, deps = {}) {
  const local = requireStoredTask(localId, deps);
  if (!local.serverTaskId) return local;
  const response = await (deps.fetchImpl || globalThis.fetch)(`${cloudTaskApiBase(config)}/${encodeURIComponent(local.serverTaskId)}`, { headers: authHeaders(deps) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.task) throw responseError(payload, response.status);
  return upsertTask(taskStorage(deps), normalizeRemote(local, payload.task, nowIso(deps)));
}

export async function refreshPendingPaperExportTasks(config, deps = {}) {
  const rows = loadPaperExportTasks(taskStorage(deps));
  const refreshable = rows.filter(row => row.serverTaskId && !paperExportTerminalStatuses.has(row.status));
  return Promise.all(refreshable.map(row => refreshPaperExportTask(config, row.localId, deps).catch(() => row)));
}

export async function cancelPaperExportTask(config, localId, deps = {}) {
  const local = requireStoredTask(localId, deps);
  if (!local.serverTaskId) return local;
  const response = await (deps.fetchImpl || globalThis.fetch)(`${cloudTaskApiBase(config)}/${encodeURIComponent(local.serverTaskId)}/cancel`, {
    method: 'POST', headers: authHeaders(deps, true), body: '{}',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.task) throw responseError(payload, response.status);
  return upsertTask(taskStorage(deps), normalizeRemote(local, payload.task, nowIso(deps)));
}

export async function retryPaperExportTask(config, localId, deps = {}) {
  const previous = requireStoredTask(localId, deps);
  const key = randomId(deps);
  const draft = {
    ...previous, localId: `paper_${key}`, idempotencyKey: key, serverTaskId: '',
    status: 'draft', phase: 'draft', progress: 0, accepted: false, result: null, message: '', errorCode: '',
    createdAt: nowIso(deps), updatedAt: nowIso(deps), retryOf: previous.localId,
  };
  upsertTask(taskStorage(deps), draft);
  return submitDraft(config, draft, deps);
}

async function exchangeAccess(config, result, deps) {
  const accessPath = String(result?.accessEndpoint || '');
  if (!accessPath) throw Object.assign(new Error('ARTIFACT_ACCESS_ENDPOINT_REQUIRED'), { code: 'ARTIFACT_ACCESS_ENDPOINT_REQUIRED' });
  if (!/^\/api\/desktop\/paper-export-artifacts\/[^/?#]+\/access$/.test(accessPath)) {
    throw Object.assign(new Error('ARTIFACT_ACCESS_ENDPOINT_INVALID'), { code: 'ARTIFACT_ACCESS_ENDPOINT_INVALID' });
  }
  const response = await (deps.fetchImpl || globalThis.fetch)(cloudUrl(cloudBusinessApiBase(config), accessPath), { method: 'GET', headers: authHeaders(deps) });
  const payload = await response.json().catch(() => ({}));
  const data = payload.data || {};
  const filePath = String(data.downloadEndpoint || data.fileUrl || '');
  if (!response.ok || !payload.ok || !data.token || !/^\/api\/desktop\/paper-export-artifacts\/[^/?#]+\/download$/.test(filePath)) {
    throw responseError(payload, response.status);
  }
  return { ...data, accessUrl: cloudUrl(cloudBusinessApiBase(config), accessPath), fileUrl: cloudUrl(cloudBusinessApiBase(config), filePath) };
}

export async function downloadPaperExportResult(config, result, deps = {}) {
  let access = await exchangeAccess(config, result, deps);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const fileHeaders = () => ({ ...authHeaders(deps), 'x-gewu-artifact-token': access.token });
  let response = await fetchImpl(access.fileUrl, { headers: fileHeaders() });
  if ([401, 410].includes(response.status)) {
    access = await exchangeAccess(config, result, deps);
    response = await fetchImpl(access.fileUrl, { headers: fileHeaders() });
  }
  if (!response.ok) throw Object.assign(new Error(`ARTIFACT_DOWNLOAD_FAILED_${response.status}`), { code: 'ARTIFACT_DOWNLOAD_FAILED', status: response.status });
  const blob = await response.blob();
  const createObjectURL = deps.createObjectURL || (value => URL.createObjectURL(value));
  const revokeObjectURL = deps.revokeObjectURL || (value => URL.revokeObjectURL(value));
  const anchor = (deps.createAnchor || (() => document.createElement('a')))();
  const blobUrl = createObjectURL(blob);
  try { anchor.href = blobUrl; anchor.download = result.fileName || access.fileName || 'paper'; anchor.rel = 'noopener'; anchor.click(); }
  finally { revokeObjectURL(blobUrl); }
}
