const crypto = require('crypto');

const SOCKET_PROTOCOL = 'gewu.authority-socket.v1';

function relayError(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}

function send(socket, frame) {
  if (socket?.readyState !== undefined && socket.readyState !== 1) return false;
  socket.send(JSON.stringify(frame));
  return true;
}

function errorFrame(requestId, error) {
  return {
    protocol: SOCKET_PROTOCOL,
    type: 'command.error',
    requestId: String(requestId || ''),
    error: {
      code: String(error?.code || 'AUTHORITY_RELAY_REQUEST_FAILED'),
      retryable: error?.retryable === true,
    },
  };
}

function createAuthorityRelayRouter({
  authenticateFrame,
  authorizeCommand,
  targetHostFor,
  sendToHost,
  createRelayId = () => crypto.randomUUID(),
  timeoutMs = 30_000,
  maxPendingPerClient = 32,
  maxPendingPerDevice = 32,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (typeof authenticateFrame !== 'function' || typeof authorizeCommand !== 'function'
    || typeof targetHostFor !== 'function' || typeof sendToHost !== 'function'
    || !Number.isSafeInteger(maxPendingPerClient) || maxPendingPerClient < 1
    || !Number.isSafeInteger(maxPendingPerDevice) || maxPendingPerDevice < 1) {
    throw relayError('AUTHORITY_RELAY_ROUTER_CONFIG_INVALID');
  }
  const pending = new Map();

  async function handleDesktopFrame(socket, frame) {
    try {
      if (!frame || frame.protocol !== SOCKET_PROTOCOL || frame.type !== 'command.submit'
        || !String(frame.requestId || '').trim() || !frame.envelope) {
        throw relayError('AUTHORITY_SOCKET_FRAME_INVALID');
      }
      const actor = await authenticateFrame(frame);
      if (socket.gewuAuthorityReplaced) throw relayError('AUTHORITY_SOCKET_REPLACED', true);
      if (actor.userId !== frame.envelope.actor?.userId
        || actor.deviceId !== frame.envelope.actor?.deviceId
        || actor.role !== frame.envelope.actor?.role) {
        throw relayError('AUTHORITY_ACTOR_MISMATCH');
      }
      await authorizeCommand(frame.envelope);
      if (socket.gewuAuthorityReplaced) throw relayError('AUTHORITY_SOCKET_REPLACED', true);
      const hostDeviceId = String(await targetHostFor(frame.envelope) || '').trim();
      if (!hostDeviceId) throw relayError('AUTHORITY_HOST_EPOCH_INACTIVE');
      const clientPending = Array.from(pending.values())
        .filter(item => item.socket === socket).length;
      if (clientPending >= maxPendingPerClient) {
        throw relayError('AUTHORITY_RELAY_PENDING_LIMIT', true);
      }
      const deviceId = String(socket.gewuAuthorityActor?.deviceId || actor.deviceId || '').trim();
      const devicePending = Array.from(pending.values())
        .filter(item => item.deviceId === deviceId).length;
      if (!deviceId || devicePending >= maxPendingPerDevice) {
        throw relayError('AUTHORITY_RELAY_DEVICE_PENDING_LIMIT', true);
      }
      const relayRequestId = String(createRelayId() || '').trim();
      if (!relayRequestId) throw relayError('AUTHORITY_RELAY_REQUEST_ID_INVALID');
      const timer = setTimeoutImpl(() => {
        const item = pending.get(relayRequestId);
        if (!item) return;
        pending.delete(relayRequestId);
        send(item.socket, errorFrame(item.requestId,
          relayError('AUTHORITY_RELAY_HOST_UNAVAILABLE', true)));
      }, timeoutMs);
      pending.set(relayRequestId, {
        socket, requestId: frame.requestId, hostDeviceId, deviceId, timer,
      });
      const forwarded = sendToHost(hostDeviceId, {
        type: 'authority_command_forward',
        payload: { relayRequestId, frame },
      });
      if (!forwarded) {
        pending.delete(relayRequestId);
        clearTimeoutImpl(timer);
        throw relayError('AUTHORITY_RELAY_HOST_UNAVAILABLE', true);
      }
    } catch (error) {
      send(socket, errorFrame(frame?.requestId, error));
    }
  }

  function handleHostResult(hostDeviceId, payload = {}) {
    const relayRequestId = String(payload.relayRequestId || '');
    const item = pending.get(relayRequestId);
    if (!item || item.hostDeviceId !== String(hostDeviceId || '')) return false;
    pending.delete(relayRequestId);
    clearTimeoutImpl(item.timer);
    send(item.socket, payload.response);
    return true;
  }

  function removeClient(socket) {
    for (const [id, item] of pending.entries()) {
      if (item.socket !== socket) continue;
      clearTimeoutImpl(item.timer);
      pending.delete(id);
    }
  }

  return Object.freeze({ handleDesktopFrame, handleHostResult, removeClient });
}

module.exports = { createAuthorityRelayRouter, relayError };
