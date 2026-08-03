'use strict';

const crypto = require('crypto');
const net = require('net');
const path = require('path');

const OWNER_PROBE = Object.freeze({
  MATCHING: 'matching-owner',
  MISMATCH: 'profile-mismatch',
  UNVERIFIED: 'unverified',
});
const MAX_HANDSHAKE_FRAME_BYTES = 1_024;

function lockIdentityForUserData(userDataPath) {
  const normalized = path.resolve(String(userDataPath || '')).replace(/\\/g, '/').toLowerCase();
  if (!normalized || normalized === '/') throw new Error('ELECTRON_CROSS_INSTALL_USER_DATA_REQUIRED');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function lockPortsForIdentity(identity) {
  const bytes = Buffer.from(identity, 'hex');
  const ports = [];
  for (let index = 0; index < 12 && ports.length < 6; index += 2) {
    const candidate = 40_000 + (bytes.readUInt16BE(index) % 20_000);
    if (!ports.includes(candidate)) ports.push(candidate);
  }
  return Object.freeze(ports);
}

function probeProfileOwner({ netImpl, port, identity, timeoutMs = 750 }) {
  return new Promise(resolve => {
    let response = '';
    let settled = false;
    const socket = netImpl.createConnection({ host: '127.0.0.1', port });
    let timer = null;
    const classify = value => {
      const message = String(value || '').replace(/\r$/, '');
      if (message === `owner:${identity}`) return OWNER_PROBE.MATCHING;
      if (message === OWNER_PROBE.MISMATCH) return OWNER_PROBE.MISMATCH;
      return OWNER_PROBE.UNVERIFIED;
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      socket.removeListener('connect', onConnect);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      resolve(result);
    };
    const onConnect = () => socket.write(`activate:${identity}\n`);
    const onData = chunk => {
      response += chunk;
      if (Buffer.byteLength(response, 'utf8') > MAX_HANDSHAKE_FRAME_BYTES) {
        finish(OWNER_PROBE.UNVERIFIED);
        return;
      }
      const delimiter = response.indexOf('\n');
      if (delimiter < 0) return;
      if (response.slice(delimiter + 1).length > 0) {
        finish(OWNER_PROBE.UNVERIFIED);
        return;
      }
      finish(classify(response.slice(0, delimiter)));
    };
    const onError = () => finish(OWNER_PROBE.UNVERIFIED);
    const onClose = () => {
      const legacyResponse = String(response || '').trim();
      finish(legacyResponse === `owner:${identity}` ? OWNER_PROBE.MATCHING : OWNER_PROBE.UNVERIFIED);
    };
    timer = setTimeout(() => finish(OWNER_PROBE.UNVERIFIED), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', onConnect);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function createCrossInstallInstanceLock({
  app,
  userDataPath,
  activateWindow,
  netImpl = net,
  probeTimeoutMs = 750,
} = {}) {
  if (!app || typeof app.exit !== 'function' || typeof activateWindow !== 'function') {
    throw new Error('ELECTRON_CROSS_INSTALL_LOCK_CONFIG_REQUIRED');
  }
  const identity = lockIdentityForUserData(userDataPath);
  const ports = lockPortsForIdentity(identity);
  let ownerServer = null;
  let ownerPort = null;

  async function attemptPort(index) {
    if (index >= ports.length) throw new Error('ELECTRON_CROSS_INSTALL_LOCK_PORTS_EXHAUSTED');
    const port = ports[index];
    const server = netImpl.createServer(socket => {
      let request = '';
      let settled = false;
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        socket.removeListener('data', onData);
      };
      const closeUnverified = () => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
      };
      const respond = frame => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.end(`${frame}\n`);
      };
      const onData = chunk => {
        if (settled) return;
        request += chunk;
        if (Buffer.byteLength(request, 'utf8') > MAX_HANDSHAKE_FRAME_BYTES) {
          closeUnverified();
          return;
        }
        const delimiter = request.indexOf('\n');
        if (delimiter < 0) return;
        if (request.slice(delimiter + 1).length > 0) {
          closeUnverified();
          return;
        }
        const frame = request.slice(0, delimiter).replace(/\r$/, '');
        if (frame === `activate:${identity}`) {
          try {
            activateWindow();
          } catch (_error) {
            closeUnverified();
            return;
          }
          respond(`owner:${identity}`);
        } else {
          respond(OWNER_PROBE.MISMATCH);
        }
      };
      socket.setEncoding('utf8');
      socket.on('data', onData);
      socket.once('error', closeUnverified);
      socket.once('close', cleanup);
      timer = setTimeout(closeUnverified, probeTimeoutMs);
    });
    return new Promise((resolve, reject) => {
      server.once('listening', () => {
        ownerServer = server;
        ownerPort = port;
        resolve(true);
      });
      server.once('error', async error => {
        if (error?.code !== 'EADDRINUSE') {
          reject(error);
          return;
        }
        let ownerProbe = OWNER_PROBE.UNVERIFIED;
        try {
          ownerProbe = await probeProfileOwner({ netImpl, port, identity, timeoutMs: probeTimeoutMs });
        } catch (_error) { /* any unverifiable occupant fails closed below */ }
        if (ownerProbe === OWNER_PROBE.MATCHING) {
          app.exit(0);
          resolve(false);
          return;
        }
        if (ownerProbe !== OWNER_PROBE.MISMATCH) {
          const probeError = new Error('ELECTRON_CROSS_INSTALL_OWNER_UNVERIFIED');
          probeError.code = 'ELECTRON_CROSS_INSTALL_OWNER_UNVERIFIED';
          reject(probeError);
          return;
        }
        try {
          resolve(await attemptPort(index + 1));
        } catch (nextError) {
          reject(nextError);
        }
      });
      server.listen({ host: '127.0.0.1', port, exclusive: true });
    });
  }

  const ready = attemptPort(0);
  async function close() {
    if (!ownerServer?.listening) return;
    const server = ownerServer;
    ownerServer = null;
    ownerPort = null;
    await new Promise(resolve => server.close(resolve));
  }
  return Object.freeze({ identity, ports, ready, close, get ownerPort() { return ownerPort; } });
}

module.exports = {
  createCrossInstallInstanceLock,
  lockIdentityForUserData,
  lockPortsForIdentity,
};
