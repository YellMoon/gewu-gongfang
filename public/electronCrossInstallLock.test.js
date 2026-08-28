'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const net = require('net');
const { createCrossInstallInstanceLock } = require('./electronCrossInstallLock');

function splitClientWritesNet() {
  let listenCalls = 0;
  return {
    netImpl: {
      createServer(handler) {
        const server = net.createServer(handler);
        const listen = server.listen.bind(server);
        server.listen = function (...args) {
          listenCalls += 1;
          return listen(...args);
        };
        return server;
      },
      createConnection(options) {
        const socket = net.createConnection(options);
        const write = socket.write.bind(socket);
        socket.write = function (frame) {
          const value = String(frame);
          const splitAt = Math.max(1, Math.floor(value.length / 2));
          write(value.slice(0, splitAt));
          setTimeout(() => write(value.slice(splitAt)), 5);
          return true;
        };
        return socket;
      },
    },
    listenCalls: () => listenCalls,
  };
}

async function rawOwnerResponse(port, payload) {
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('RAW_OWNER_RESPONSE_TIMEOUT'));
    }, 1_000);
    socket.setEncoding('utf8');
    socket.on('data', chunk => { response += chunk; });
    socket.once('connect', () => socket.write(payload));
    socket.once('error', reject);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function probeNet(scenario, { allowSecondListen = false, listenErrorCode = 'EADDRINUSE' } = {}) {
  let listenCalls = 0;
  const netImpl = {
    createServer() {
      const server = new EventEmitter();
      server.listening = false;
      server.listen = function () {
        listenCalls += 1;
        queueMicrotask(() => {
          if (allowSecondListen && listenCalls === 2) {
            server.listening = true;
            server.emit('listening');
            return;
          }
          const error = new Error('occupied');
          error.code = listenErrorCode;
          server.emit('error', error);
        });
      };
      server.close = function (callback) {
        server.listening = false;
        callback?.();
      };
      return server;
    },
    createConnection() {
      const socket = new EventEmitter();
      socket.setEncoding = function () {};
      socket.write = function () {};
      socket.destroy = function () {};
      queueMicrotask(() => {
        if (scenario === 'error') {
          const error = new Error('refused');
          error.code = 'ECONNREFUSED';
          socket.emit('error', error);
          return;
        }
        socket.emit('connect');
        if (scenario === 'garbage') socket.emit('data', 'not-the-lock-protocol\n');
        if (scenario === 'close') socket.emit('close');
        if (scenario === 'mismatch') socket.emit('data', 'profile-mismatch\n');
      });
      return socket;
    },
  };
  return { netImpl, listenCalls: () => listenCalls };
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'electronCrossInstallLock.js'), 'utf8');
  assert.ok(source.includes("host: '127.0.0.1'")
    && source.includes('exclusive: true')
    && source.includes('activate:')
    && source.includes('owner:'),
  'the cross-process lock must use an exclusive loopback listener and a profile-bound owner handshake');
  const userDataPath = path.join(os.tmpdir(), `gewu-cross-install-lock-${process.pid}-${Date.now()}`);
  const focusCalls = [];
  const ownerApp = { exit() { throw new Error('owner must not exit'); } };
  const owner = createCrossInstallInstanceLock({
    app: ownerApp,
    userDataPath,
    activateWindow: () => focusCalls.push('activate'),
  });
  assert.strictEqual(await owner.ready, true);

  const contenderExits = [];
  const contender = createCrossInstallInstanceLock({
    app: { exit(code) { contenderExits.push(code); } },
    userDataPath,
    activateWindow: () => { throw new Error('contender must not own activation'); },
  });
  assert.strictEqual(await contender.ready, false);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepStrictEqual(contenderExits, [0]);
  assert.deepStrictEqual(focusCalls, ['activate']);

  await owner.close();
  const replacement = createCrossInstallInstanceLock({
    app: ownerApp,
    userDataPath,
    activateWindow: () => {},
  });
  assert.strictEqual(await replacement.ready, true,
    'the OS pipe lock must be released when the owner closes or exits');
  await replacement.close();

  for (const scenario of ['timeout', 'garbage', 'error', 'close']) {
    const fake = probeNet(scenario);
    const guarded = createCrossInstallInstanceLock({
      app: { exit() { throw new Error('an unverified occupant must reject through the Electron quit path'); } },
      userDataPath: path.join(userDataPath, scenario),
      activateWindow: () => { throw new Error('an unverified occupant must never activate'); },
      netImpl: fake.netImpl,
      probeTimeoutMs: 15,
    });
    await assert.rejects(
      guarded.ready,
      error => error?.code === 'ELECTRON_CROSS_INSTALL_OWNER_UNVERIFIED',
      `${scenario} owner probe must fail closed with a stable code`,
    );
    assert.strictEqual(fake.listenCalls(), 1,
      `${scenario} owner probe must never attempt the next candidate port`);
  }

  const mismatch = probeNet('mismatch', { allowSecondListen: true });
  const collision = createCrossInstallInstanceLock({
    app: ownerApp,
    userDataPath: path.join(userDataPath, 'mismatch'),
    activateWindow: () => {},
    netImpl: mismatch.netImpl,
    probeTimeoutMs: 15,
  });
  assert.strictEqual(await collision.ready, true,
    'only an explicit profile-mismatch response may advance to the next candidate port');
  assert.strictEqual(mismatch.listenCalls(), 2);
  await collision.close();

  const restrictedPort = probeNet('error', { allowSecondListen: true, listenErrorCode: 'EACCES' });
  const restrictedLock = createCrossInstallInstanceLock({
    app: ownerApp,
    userDataPath: path.join(userDataPath, 'reserved-port'),
    activateWindow: () => {},
    netImpl: restrictedPort.netImpl,
    probeTimeoutMs: 15,
  });
  assert.strictEqual(await restrictedLock.ready, true,
    'a Windows-reserved loopback port must advance to the next deterministic candidate without weakening the owner probe');
  assert.strictEqual(restrictedPort.listenCalls(), 2);
  await restrictedLock.close();

  const splitTransport = splitClientWritesNet();
  const splitFocusCalls = [];
  const splitOwner = createCrossInstallInstanceLock({
    app: ownerApp,
    userDataPath: path.join(userDataPath, 'split-frame'),
    activateWindow: () => splitFocusCalls.push('activate'),
    netImpl: splitTransport.netImpl,
    probeTimeoutMs: 50,
  });
  assert.strictEqual(await splitOwner.ready, true);
  const splitOwnerPortIndex = splitOwner.ports.indexOf(splitOwner.ownerPort);
  assert.ok(splitOwnerPortIndex >= 0, 'the split-frame owner must bind one of its deterministic candidate ports');
  const splitExits = [];
  const splitContender = createCrossInstallInstanceLock({
    app: { exit(code) { splitExits.push(code); } },
    userDataPath: path.join(userDataPath, 'split-frame'),
    activateWindow: () => { throw new Error('split contender must not become owner'); },
    netImpl: splitTransport.netImpl,
    probeTimeoutMs: 50,
  });
  const splitReady = await splitContender.ready;
  await splitContender.close();
  await splitOwner.close();
  assert.strictEqual(splitReady, false,
    'a valid activation frame split across TCP chunks must still identify the matching owner');
  assert.deepStrictEqual(splitExits, [0]);
  assert.deepStrictEqual(splitFocusCalls, ['activate']);
  assert.strictEqual(splitTransport.listenCalls(), 2 * (splitOwnerPortIndex + 1),
    'a fragmented matching-owner handshake must never advance the contender beyond the owner port, even when an earlier candidate is occupied');

  for (const fixture of [
    ['unterminated', 'activate:partial'],
    ['oversized', 'x'.repeat(2_048)],
  ]) {
    const guardedOwner = createCrossInstallInstanceLock({
      app: ownerApp,
      userDataPath: path.join(userDataPath, fixture[0]),
      activateWindow: () => { throw new Error(`${fixture[0]} frame must not activate`); },
      probeTimeoutMs: 20,
    });
    assert.strictEqual(await guardedOwner.ready, true);
    assert.strictEqual(await rawOwnerResponse(guardedOwner.ownerPort, fixture[1]), '',
      `${fixture[0]} request must close unverified without a profile-mismatch response`);
    await guardedOwner.close();
  }
}

main().then(() => console.log('Electron cross-install instance lock checks passed')).catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
