function socketError(code, cause, retryable = true) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable;
  if (cause) error.cause = cause;
  return error;
}

function bind(socket, event, listener) {
  if (typeof socket?.on === 'function') socket.on(event, listener);
  else if (typeof socket?.addEventListener === 'function') socket.addEventListener(event, listener);
  else throw socketError('AUTHORITY_SOCKET_INVALID');
}

function parseFrame(raw) {
  const value = raw?.data === undefined ? raw : raw.data;
  const text = typeof value === 'string' ? value : value?.toString?.('utf8');
  const frame = JSON.parse(text);
  if (!frame || frame.protocol !== 'gewu.authority-socket.v1' || typeof frame.type !== 'string') {
    throw socketError('AUTHORITY_SOCKET_FRAME_INVALID', undefined, false);
  }
  return frame;
}

export function authorityWebSocketUrl(baseUrl) {
  const url = new URL(String(baseUrl || '').trim());
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw socketError('AUTHORITY_SOCKET_URL_INVALID');
  }
  url.pathname = '/ws/authority';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function createAuthorityWebSocketTransport({
  name,
  url,
  WebSocketImpl = globalThis.WebSocket,
  signRequest,
  createRequestId = () => globalThis.crypto?.randomUUID?.()
    || `authority-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  timeoutMs = 5000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const transportName = String(name || '').trim();
  const socketUrl = String(url || '').trim();
  if (!transportName || !socketUrl || typeof WebSocketImpl !== 'function'
    || typeof signRequest !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw socketError('AUTHORITY_SOCKET_TRANSPORT_CONFIG_INVALID', undefined, false);
  }

  let socket = null;
  let connecting = null;
  let ready = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const item of pending.values()) {
      clearTimeoutImpl(item.timer);
      item.reject(error);
    }
    pending.clear();
  }

  function close() {
    ready = false;
    const current = socket;
    socket = null;
    if (current && typeof current.close === 'function') {
      try { current.close(); } catch (_error) { /* best effort */ }
    }
  }

  async function connect() {
    if (ready && socket?.readyState === WebSocketImpl.OPEN) return socket;
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      let settled = false;
      const candidate = new WebSocketImpl(socketUrl);
      socket = candidate;
      const timer = setTimeoutImpl(() => {
        if (settled) return;
        settled = true;
        close();
        reject(socketError('AUTHORITY_SOCKET_UNAVAILABLE'));
      }, timeoutMs);
      const fail = cause => {
        ready = false;
        if (!settled) {
          settled = true;
          clearTimeoutImpl(timer);
          reject(socketError('AUTHORITY_SOCKET_UNAVAILABLE', cause));
        }
        rejectPending(socketError('AUTHORITY_SOCKET_UNAVAILABLE', cause));
      };
      bind(candidate, 'error', fail);
      bind(candidate, 'close', () => fail());
      bind(candidate, 'message', raw => {
        let frame;
        try {
          frame = parseFrame(raw);
        } catch (error) {
          fail(error);
          return;
        }
        if (frame.type === 'ready') {
          ready = true;
          if (!settled) {
            settled = true;
            clearTimeoutImpl(timer);
            resolve(candidate);
          }
          return;
        }
        const item = pending.get(String(frame.requestId || ''));
        if (!item) return;
        pending.delete(frame.requestId);
        clearTimeoutImpl(item.timer);
        if (frame.type === 'command.receipt') {
          item.resolve(frame.receipt);
          return;
        }
        if (frame.type === 'command.error') {
          item.reject(socketError(
            String(frame.error?.code || 'AUTHORITY_SOCKET_REQUEST_FAILED'),
            undefined,
            frame.error?.retryable === true,
          ));
        }
      });
    }).finally(() => { connecting = null; });
    return connecting;
  }

  return Object.freeze({
    name: transportName,
    async isReady() {
      try {
        await connect();
        return true;
      } catch (_error) {
        return false;
      }
    },
    async submit(envelope) {
      const liveSocket = await connect();
      const requestId = String(createRequestId() || '').trim();
      if (!requestId) throw socketError('AUTHORITY_SOCKET_REQUEST_ID_REQUIRED', undefined, false);
      const signed = await signRequest({
        method: 'POST',
        path: '/api/authority/commands',
        body: envelope,
      });
      const auth = signed?.headers && typeof signed.headers === 'object'
        ? { ...signed.headers }
        : {};
      return new Promise((resolve, reject) => {
        const timer = setTimeoutImpl(() => {
          pending.delete(requestId);
          close();
          reject(socketError('AUTHORITY_SOCKET_UNAVAILABLE'));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        try {
          liveSocket.send(JSON.stringify({
            protocol: 'gewu.authority-socket.v1',
            type: 'command.submit',
            requestId,
            envelope,
            auth,
          }));
        } catch (cause) {
          pending.delete(requestId);
          clearTimeoutImpl(timer);
          close();
          reject(socketError('AUTHORITY_SOCKET_UNAVAILABLE', cause));
        }
      });
    },
    close,
  });
}

export { socketError };
