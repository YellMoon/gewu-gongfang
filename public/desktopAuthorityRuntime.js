const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableJson } = require('../shared/authorityProtocol');

function runtimeError(code) {
  return Object.assign(new Error(code), { code });
}

function createSecureOutboxId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function createDesktopAuthorityRuntime({
  filePath,
  safeStorage,
  vault,
  cloudBusinessBaseUrl,
  fetchImpl = fetch,
  requestTimeoutMs = 5_000,
  AbortControllerImpl = globalThis.AbortController,
  createId,
  now,
  isOnline = () => true,
  fsImpl = fs,
} = {}) {
  if (!filePath || !safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function'
    || typeof vault?.status !== 'function'
    || typeof isOnline !== 'function') {
    throw runtimeError('DESKTOP_AUTHORITY_RUNTIME_CONFIG_REQUIRED');
  }
  let clientPromise = null;

  function assertEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw runtimeError('DESKTOP_AUTHORITY_OUTBOX_ENCRYPTION_UNAVAILABLE');
    }
  }

  const store = Object.freeze({
    async read() {
      if (!fsImpl.existsSync(filePath)) return '';
      return fsImpl.readFileSync(filePath, 'utf8');
    },
    async write(value) {
      const temporary = `${filePath}.tmp`;
      fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
      try {
        fsImpl.writeFileSync(temporary, String(value), { encoding: 'utf8', mode: 0o600 });
        fsImpl.renameSync(temporary, filePath);
      } catch (error) {
        try {
          if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
        } catch (_cleanupError) {
          // Preserve the prior committed outbox if cleanup itself fails.
        }
        throw runtimeError(error?.code || 'DESKTOP_AUTHORITY_OUTBOX_WRITE_FAILED');
      }
    },
  });
  const codec = Object.freeze({
    async seal(value) {
      assertEncryption();
      return safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    },
    async open(value) {
      assertEncryption();
      try {
        return JSON.parse(safeStorage.decryptString(Buffer.from(String(value), 'base64')));
      } catch (error) {
        throw runtimeError('AUTHORITY_OUTBOX_CORRUPT');
      }
    },
  });

  function validateDraft(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !/^[a-z][a-z0-9_.-]*\.v[1-9][0-9]*$/.test(String(input.type || ''))
      || !input.payload || typeof input.payload !== 'object'
      || Array.isArray(input.payload)) {
      throw runtimeError('AUTHORITY_DRAFT_INVALID');
    }
    if (!isCloudQuestionDraft(input) && !isCloudBusinessDraft(input)) {
      throw runtimeError('CLOUD_AUTHORITY_DRAFT_TYPE_UNSUPPORTED');
    }
  }

  function currentTimeMs() {
    const value = now ? now() : new Date();
    const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
    if (!Number.isFinite(milliseconds)) {
      throw runtimeError('DESKTOP_OFFLINE_DRAFT_SESSION_CLOCK_INVALID');
    }
    return milliseconds;
  }

  function assertLocalDraftSession() {
    const status = typeof vault.status === 'function' ? vault.status() : null;
    const lease = status?.offlineLease;
    if (status?.state !== 'unlocked' || status?.unlocked !== true
      || !lease || typeof lease !== 'object') {
      throw runtimeError('DESKTOP_OFFLINE_DRAFT_SESSION_REQUIRED');
    }
    const issuedAt = Date.parse(String(lease.issuedAt || ''));
    const expiresAt = Date.parse(String(lease.expiresAt || ''));
    const current = currentTimeMs();
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
      || issuedAt > current || expiresAt <= issuedAt) {
      throw runtimeError('DESKTOP_OFFLINE_DRAFT_SESSION_REQUIRED');
    }
    if (expiresAt <= current) {
      throw runtimeError('DESKTOP_OFFLINE_DRAFT_SESSION_EXPIRED');
    }
    if (String(lease.userId || '') !== String(status.user?.id || '')
      || String(lease.deviceId || '') !== String(status.deviceId || '')
      || String(lease.authorizationId || '') !== String(status.authorizationId || '')
      || Number(lease.credentialVersion) !== Number(status.credentialVersion)) {
      throw runtimeError('DESKTOP_OFFLINE_DRAFT_SESSION_REQUIRED');
    }
    return status;
  }

  function assertOnlineSubmission() {
    let online = false;
    try {
      online = isOnline() === true;
    } catch (_error) {
      online = false;
    }
    if (!online) throw runtimeError('DESKTOP_OFFLINE_DRAFT_SUBMISSION_FORBIDDEN');
  }

  function isCloudQuestionDraft(draft) {
    return /^(question|taxonomy-system|taxonomy-node)\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  function isCloudBusinessDraft(draft) {
    return /^(student|course|schedule|teacher|room|institution|school|payment|consumption|grade|personal-asset-record|personal-asset-category)\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  function cloudSessionToken(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).length !== 1 || !Object.hasOwn(value, 'sessionToken')
      || typeof value.sessionToken !== 'string' || !value.sessionToken.trim()
      || value.sessionToken !== value.sessionToken.trim() || value.sessionToken.length > 4096
      || /[\r\n]/.test(value.sessionToken)) {
      throw runtimeError('DESKTOP_CLOUD_SESSION_REQUIRED');
    }
    return value.sessionToken;
  }

  function businessDraftDescriptor(input) {
    const match = /^(student|course|schedule|teacher|room|institution|school|payment|consumption|grade|personal-asset-record|personal-asset-category)\.(create|update|delete)\.(v[1-9][0-9]*)$/.exec(String(input?.type || ''));
    if (!match) return null;
    const rawRecordId = match[2] === 'create' ? input.payload?.record?.id : input.payload?.id;
    if (typeof rawRecordId !== 'string') return null;
    const recordId = rawRecordId.trim();
    return recordId ? { entity: match[1], action: match[2], version: match[3], recordId } : null;
  }

  function mergePendingBusinessDraft(state, input, updatedAt, draftScope) {
    const incoming = businessDraftDescriptor(input);
    if (!incoming) return undefined;
    const existing = Object.values(state.items).find(item => (
      item?.status === 'awaiting_confirmation'
      && item.draftScope?.userId === draftScope.userId
      && item.draftScope?.businessAuthority === draftScope.businessAuthority
      && businessDraftDescriptor(item)?.entity === incoming.entity
      && businessDraftDescriptor(item)?.recordId === incoming.recordId
    ));
    if (!existing) return undefined;
    const previous = businessDraftDescriptor(existing);
    if (previous.action === 'update' && incoming.action === 'update') {
      existing.payload = {
        id: incoming.recordId,
        expectedVersion: existing.payload.expectedVersion || input.payload.expectedVersion,
        changes: {
          ...(existing.payload.changes || {}),
          ...(input.payload.changes || {}),
        },
      };
    } else if (previous.action === 'create' && incoming.action === 'update') {
      existing.payload = {
        record: {
          ...(existing.payload.record || {}),
          ...(input.payload.changes || {}),
          id: incoming.recordId,
        },
      };
    } else if (previous.action === 'create' && incoming.action === 'delete') {
      delete state.items[existing.id];
      return null;
    } else if (previous.action === 'update' && incoming.action === 'delete') {
      existing.type = `${incoming.entity}.delete.${incoming.version}`;
      existing.payload = {
        id: incoming.recordId,
        expectedVersion: existing.payload.expectedVersion || input.payload.expectedVersion,
      };
    } else {
      return undefined;
    }
    existing.preview = JSON.parse(JSON.stringify(input.preview || existing.preview || {}));
    existing.updatedAt = updatedAt;
    return existing;
  }

  function appendDraftBatchSync(inputs) {
    const localDraftStatus = assertLocalDraftSession();
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw runtimeError('AUTHORITY_DRAFT_BATCH_INVALID');
    }
    inputs.forEach(validateDraft);
    assertEncryption();
    let state = { protocol: 'gewu.authority-outbox.v1', items: {} };
    if (fsImpl.existsSync(filePath)) {
      try {
        state = JSON.parse(safeStorage.decryptString(
          Buffer.from(fsImpl.readFileSync(filePath, 'utf8'), 'base64'),
        ));
      } catch (_error) {
        throw runtimeError('AUTHORITY_OUTBOX_CORRUPT');
      }
    }
    if (state?.protocol !== 'gewu.authority-outbox.v1'
      || !state.items || typeof state.items !== 'object' || Array.isArray(state.items)) {
      throw runtimeError('AUTHORITY_OUTBOX_CORRUPT');
    }
    const draftScope = Object.freeze({
      userId: String(localDraftStatus.user.id),
      businessAuthority: String(cloudBusinessBaseUrl || '').replace(/\/+$/, ''),
    });
    const appended = inputs.map(input => {
      const createdAt = new Date(now ? now() : new Date().toISOString()).toISOString();
      const merged = mergePendingBusinessDraft(state, input, createdAt, draftScope);
      if (merged !== undefined) return merged;
      const id = String(createId ? createId() : createSecureOutboxId()).trim();
      if (!id || !Number.isFinite(Date.parse(createdAt))) {
        throw runtimeError('AUTHORITY_DRAFT_ID_OR_CLOCK_INVALID');
      }
      if (state.items[id]) throw runtimeError('AUTHORITY_DRAFT_ID_CONFLICT');
      const item = {
        id,
        type: input.type,
        payload: JSON.parse(JSON.stringify(input.payload)),
        preview: JSON.parse(JSON.stringify(input.preview || {})),
        draftScope,
        status: 'awaiting_confirmation',
        createdAt,
        updatedAt: createdAt,
        confirmation: null,
        submission: null,
        receipt: null,
        conflict: null,
      };
      state.items[id] = item;
      return item;
    }).filter(Boolean);
    const sealed = safeStorage.encryptString(JSON.stringify(state)).toString('base64');
    const temporary = `${filePath}.tmp`;
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      fsImpl.writeFileSync(temporary, sealed, { encoding: 'utf8', mode: 0o600 });
      fsImpl.renameSync(temporary, filePath);
    } catch (error) {
      try {
        if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      } catch (_cleanupError) {
        // Preserve the prior committed outbox if cleanup itself fails.
      }
      throw runtimeError(error?.code || 'DESKTOP_AUTHORITY_OUTBOX_WRITE_FAILED');
    }
    return JSON.parse(JSON.stringify(appended));
  }

  function appendDraftSync(input) {
    return appendDraftBatchSync([input])[0];
  }

  async function requestJson(url, options) {
    const timeoutMs = Math.max(1, Number(requestTimeoutMs) || 5_000);
    const controller = typeof AbortControllerImpl === 'function'
      ? new AbortControllerImpl()
      : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    let body = null;
    try {
      response = await fetchImpl(url, {
        ...(options || {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      try {
        body = await response.json();
      } catch (error) {
        if (controller?.signal?.aborted || error?.name === 'AbortError') throw error;
        body = null;
      }
    } catch (error) {
      if (controller?.signal?.aborted || error?.name === 'AbortError') {
        throw runtimeError('AUTHORITY_HTTP_TIMEOUT');
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      const error = runtimeError(
        body?.error?.code || body?.code || `AUTHORITY_HTTP_${response.status}`
      );
      error.statusCode = response.status;
      throw error;
    }
    return body;
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const [{ createDesktopCommandOutbox }, { createDesktopAuthorityClient },
          { createDesktopIdentityClient },
          { createDesktopCloudBusinessDraftAdapter }] = await Promise.all([
          import('../src/services/desktopCommandOutbox.mjs'),
          import('../src/services/desktopAuthorityClient.mjs'),
          import('../src/services/desktopIdentityClient.mjs'),
          import('../src/services/desktopCloudBusinessDraft.mjs'),
        ]);
        const outbox = createDesktopCommandOutbox({
          store,
          codec,
          // Electron's main-process global may not expose Web Crypto even when
          // Node's crypto.randomUUID is available.  The outbox is a desktop
          // main-process dependency, so provide the Node implementation here
          // instead of relying on globalThis.crypto.
          createId: createId || createSecureOutboxId,
          ...(now ? { now } : {}),
        });
        const normalizedCloudBusinessBaseUrl = String(cloudBusinessBaseUrl || '').replace(/\/+$/, '');
        const cloudBusinessAdapter = normalizedCloudBusinessBaseUrl
          ? createDesktopCloudBusinessDraftAdapter({
            cloudClient: createDesktopIdentityClient({
              desktopIdentity: vault,
              fetchImpl,
              sessionStore: { save: async () => {}, clear: async () => {} },
            }),
            baseUrl: normalizedCloudBusinessBaseUrl,
            sha256: value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'),
            now: now || (() => new Date().toISOString()),
          })
          : null;
        return createDesktopAuthorityClient({
          outbox,
          createCloudQuestionCommand: draft => Object.freeze({
            commandId: draft.id,
            payloadHash: crypto.createHash('sha256')
              .update(stableJson({ type: draft.type, payload: draft.payload }), 'utf8').digest('hex'),
            type: draft.type,
            payload: draft.payload,
          }),
          submitCloudQuestion: async (command, input) => {
            const token = cloudSessionToken(input);
            if (!normalizedCloudBusinessBaseUrl) throw runtimeError('CLOUD_QUESTION_AUTHORITY_UNAVAILABLE');
            const body = await requestJson(`${normalizedCloudBusinessBaseUrl}/api/desktop/question-bank/commands`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(command),
            });
            if (!body?.receipt || typeof body.receipt !== 'object') {
              throw runtimeError('CLOUD_QUESTION_RECEIPT_INVALID');
            }
            return body.receipt;
          },
          createCloudBusinessCommand: cloudBusinessAdapter
            ? draft => cloudBusinessAdapter.createCommand(draft)
            : null,
          submitCloudBusiness: cloudBusinessAdapter
            ? (command, input) => cloudBusinessAdapter.submit(command, {
              sessionToken: cloudSessionToken(input),
            })
            : null,
        });
      })();
    }
    return clientPromise;
  }

  function cloudBusinessUrl(pathname) {
    const base = String(cloudBusinessBaseUrl || '').replace(/\/+$/, '');
    if (!base) throw runtimeError('CLOUD_ROLE_APPLICATION_AUTHORITY_UNAVAILABLE');
    return `${base}${pathname}`;
  }

  async function listRoleApplications(input) {
    assertOnlineSubmission();
    const token = cloudSessionToken(input);
    const body = await requestJson(cloudBusinessUrl('/api/desktop/role-applications/pending'), {
      method: 'GET', headers: { authorization: `Bearer ${token}` },
    });
    if (!body?.ok || !Array.isArray(body.applications)) throw runtimeError('CLOUD_ROLE_APPLICATION_RESPONSE_INVALID');
    return JSON.parse(JSON.stringify(body.applications));
  }

  async function reviewRoleApplication(applicationId, review, input) {
    assertOnlineSubmission();
    const id = String(applicationId || '').trim();
    const decision = String(review?.decision || '').trim();
    const profileId = review?.profileId === null ? null : String(review?.profileId || '').trim();
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || !['approved', 'rejected'].includes(decision)
      || !Object.hasOwn(review || {}, 'profileId') || (decision === 'approved' && review.profileId !== null && !profileId)
      || (decision === 'rejected' && review?.profileId !== null)) {
      throw runtimeError('CLOUD_ROLE_APPLICATION_INPUT_INVALID');
    }
    const token = cloudSessionToken(input);
    const body = await requestJson(cloudBusinessUrl(`/api/desktop/role-applications/${encodeURIComponent(id)}/review`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ decision, profileId }),
    });
    if (!body?.ok || typeof body.application !== 'object' || !body.application) throw runtimeError('CLOUD_ROLE_APPLICATION_RESPONSE_INVALID');
    return JSON.parse(JSON.stringify({ state: body.state, application: body.application }));
  }

  return Object.freeze({
    appendDraft: async input => appendDraftSync(input),
    appendDraftSync,
    appendDraftBatchSync,
    confirmAndSubmit: async (id, input) => {
      assertOnlineSubmission();
      const client = await getClient();
      const draft = await client.get(id);
      if (!isCloudQuestionDraft(draft) && !isCloudBusinessDraft(draft)) {
        throw runtimeError('CLOUD_AUTHORITY_DRAFT_TYPE_UNSUPPORTED');
      }
      cloudSessionToken(input);
      return client.confirmAndSubmit(id, input);
    },
    get: async id => (await getClient()).get(id),
    list: async () => (await getClient()).list(),
    listRoleApplications,
    reviewRoleApplication,
    submit: async (id, input) => {
      assertOnlineSubmission();
      const client = await getClient();
      const draft = await client.get(id);
      if (!isCloudQuestionDraft(draft) && !isCloudBusinessDraft(draft)) {
        throw runtimeError('CLOUD_AUTHORITY_DRAFT_TYPE_UNSUPPORTED');
      }
      cloudSessionToken(input);
      return client.submit(id, input);
    },
  });
}

module.exports = { createDesktopAuthorityRuntime, runtimeError };
