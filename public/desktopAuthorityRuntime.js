const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  verifySignedAuthorityProjection,
} = require('../shared/authorityProjectionProtocol');

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
  durableRelayBaseUrl,
  lanBaseUrl,
  relayWebSocketBaseUrl,
  lanTransport,
  relayWebSocketTransport,
  WebSocketImpl,
  fetchImpl = fetch,
  requestTimeoutMs = 5_000,
  AbortControllerImpl = globalThis.AbortController,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
  receiptPollAttempts = 30,
  receiptPollIntervalMs = 1000,
  createId,
  now,
  isOnline = () => true,
  fsImpl = fs,
} = {}) {
  if (!filePath || !safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function'
    || typeof vault?.createAuthorityCommand !== 'function'
    || typeof vault?.signAuthorityHttpRequest !== 'function'
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

  function appendDraftBatchSync(inputs) {
    assertLocalDraftSession();
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
    const appended = inputs.map(input => {
      const id = String(createId ? createId() : createSecureOutboxId()).trim();
      const createdAt = new Date(now ? now() : new Date().toISOString()).toISOString();
      if (!id || !Number.isFinite(Date.parse(createdAt))) {
        throw runtimeError('AUTHORITY_DRAFT_ID_OR_CLOCK_INVALID');
      }
      if (state.items[id]) throw runtimeError('AUTHORITY_DRAFT_ID_CONFLICT');
      const item = {
        id,
        type: input.type,
        payload: JSON.parse(JSON.stringify(input.payload)),
        preview: JSON.parse(JSON.stringify(input.preview || {})),
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
    });
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

  function durableTransport() {
    const baseUrl = String(durableRelayBaseUrl || '').replace(/\/+$/, '');
    return Object.freeze({
      name: 'durable-relay',
      isReady: async () => Boolean(baseUrl),
      async submit(envelope) {
        if (!baseUrl) throw runtimeError('HOST_TRANSPORT_UNAVAILABLE');
        const submitPath = '/api/authority/commands';
        const submitAuth = vault.signAuthorityHttpRequest({
          method: 'POST',
          path: submitPath,
          body: envelope,
        });
        try {
          await requestJson(`${baseUrl}${submitPath}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(submitAuth.headers || {}),
            },
            body: JSON.stringify(envelope),
          });
        } catch (error) {
          // A timeout can happen after the cloud has durably accepted the
          // idempotent command. Continue by reading its receipt; never submit
          // a second envelope from inside this transport attempt.
          if (error?.code !== 'AUTHORITY_HTTP_TIMEOUT') throw error;
        }
        const receiptPath = `/api/authority/commands/${encodeURIComponent(envelope.commandId)}/receipt`;
        const attempts = Math.max(1, Number(receiptPollAttempts) || 1);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const readAuth = vault.signAuthorityHttpRequest({
            method: 'GET',
            path: receiptPath,
            body: null,
          });
          try {
            const body = await requestJson(`${baseUrl}${receiptPath}`, {
              method: 'GET',
              headers: { ...(readAuth.headers || {}) },
            });
            if (body?.receipt) return body.receipt;
          } catch (error) {
            if (error?.statusCode !== 404 && error?.code !== 'AUTHORITY_HTTP_TIMEOUT') throw error;
          }
          if (attempt + 1 < attempts) await sleep(receiptPollIntervalMs);
        }
        throw runtimeError('AUTHORITY_RECEIPT_PENDING');
      },
    });
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const [{ createDesktopCommandOutbox }, { createDesktopAuthorityClient },
          { createAuthorityTransportSelector },
          { authorityWebSocketUrl, createAuthorityWebSocketTransport }] = await Promise.all([
          import('../src/services/desktopCommandOutbox.mjs'),
          import('../src/services/desktopAuthorityClient.mjs'),
          import('../src/services/authorityTransports.mjs'),
          import('../src/services/authorityWebSocketTransport.mjs'),
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
        const socketTransport = (name, baseUrl) => {
          const normalized = String(baseUrl || '').trim();
          if (!normalized || typeof WebSocketImpl !== 'function') return null;
          return createAuthorityWebSocketTransport({
            name,
            url: authorityWebSocketUrl(normalized),
            WebSocketImpl,
            signRequest: input => vault.signAuthorityHttpRequest(input),
          });
        };
        const transports = createAuthorityTransportSelector({
          lanTransport: lanTransport || socketTransport('lan-websocket', lanBaseUrl),
          relayWebSocketTransport: relayWebSocketTransport
            || socketTransport('relay-websocket', relayWebSocketBaseUrl),
          durableRelayTransport: durableTransport(),
        });
        return createDesktopAuthorityClient({
          outbox,
          createEnvelope: async draft => vault.createAuthorityCommand({
            type: draft.type,
            payload: draft.payload,
          }).envelope,
          transports,
        });
      })();
    }
    return clientPromise;
  }

  async function readProjection({ minSourceVersion = 0 } = {}) {
    const minimumVersion = Number(minSourceVersion || 0);
    if (!Number.isSafeInteger(minimumVersion) || minimumVersion < 0) {
      throw runtimeError('AUTHORITY_PROJECTION_VERSION_INVALID');
    }
    const projectionPath = '/api/authority/projections/current';
    const requestAuth = vault.signAuthorityHttpRequest({
      method: 'GET',
      path: projectionPath,
      body: null,
    });
    const headers = {
      ...(requestAuth.headers || {}),
      'x-gewu-authority-id': requestAuth.authorityId,
      'x-gewu-authority-lease-id': requestAuth.leaseId,
      'x-gewu-authority-grant-version': String(requestAuth.grantVersion),
    };
    const bases = Array.from(new Set(
      [lanBaseUrl, durableRelayBaseUrl]
        .map(value => String(value || '').replace(/\/+$/, ''))
        .filter(Boolean)
    ));
    let lastError = null;
    const attempts = minimumVersion > 0
      ? Math.max(1, Number(receiptPollAttempts) || 1)
      : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      for (const base of bases) {
        try {
          const body = await requestJson(`${base}${projectionPath}`, {
            method: 'GET',
            headers,
          });
          const projection = verifySignedAuthorityProjection({
            projection: body?.projection,
            publicKey: requestAuth.hostPublicKey,
          });
          if (projection.authorityId !== requestAuth.authorityId
            || projection.hostEpochId !== requestAuth.hostEpochId
            || projection.userId !== requestAuth.actor?.userId
            || projection.role !== requestAuth.actor?.role) {
            throw runtimeError('AUTHORITY_PROJECTION_SCOPE_MISMATCH');
          }
          if (Number(projection.sourceVersion) < minimumVersion) {
            lastError = runtimeError('AUTHORITY_PROJECTION_VERSION_PENDING');
            continue;
          }
          return projection;
        } catch (error) {
          lastError = error;
          if (Number(error?.statusCode) > 0 && Number(error.statusCode) < 500
            && error.statusCode !== 404) {
            throw error;
          }
        }
      }
      if (attempt + 1 < attempts) await sleep(receiptPollIntervalMs);
    }
    throw lastError || runtimeError('AUTHORITY_PROJECTION_UNAVAILABLE');
  }

  return Object.freeze({
    appendDraft: async input => {
      assertLocalDraftSession();
      return (await getClient()).appendDraft(input);
    },
    appendDraftSync,
    appendDraftBatchSync,
    confirmAndExecuteLocal: async (id, executeLocalDraft) => (
      (await getClient()).confirmAndExecuteLocal(id, executeLocalDraft)
    ),
    confirmAndSubmit: async id => {
      assertOnlineSubmission();
      return (await getClient()).confirmAndSubmit(id);
    },
    get: async id => (await getClient()).get(id),
    list: async () => (await getClient()).list(),
    readProjection,
    submit: async id => {
      assertOnlineSubmission();
      return (await getClient()).submit(id);
    },
    submitLocal: async (id, executeLocalDraft) => (
      (await getClient()).submitLocal(id, executeLocalDraft)
    ),
  });
}

module.exports = { createDesktopAuthorityRuntime, runtimeError };
