const assert = require('assert');
const http = require('http');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const { CloudRelaySocketServer } = require('./cloudRelayServer');
const { createAuthorityRelayRouter } = require('./authorityRelayRouter');

function collect(socket) {
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString('utf8'))));
  return messages;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitFor(messages, predicate, code) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(code);
}

async function waitForClose(socket, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), 3000);
    socket.once('close', (closeCode, reason) => {
      clearTimeout(timer);
      resolve({ code: closeCode, reason: reason.toString('utf8') });
    });
  });
}

function authenticate(socket, deviceId = 'desktop-1') {
  socket.send(JSON.stringify({
    protocol: 'gewu.authority-socket.v1',
    type: 'connection.authenticate',
    auth: { 'x-gewu-authority-device-id': deviceId },
  }));
}

async function verifyDevicePendingLimit() {
  const framesA = [];
  const framesB = [];
  const socketA = {
    gewuAuthorityActor: { deviceId: 'shared-device' },
    send(raw) { framesA.push(JSON.parse(raw)); },
  };
  const socketB = {
    gewuAuthorityActor: { deviceId: 'shared-device' },
    send(raw) { framesB.push(JSON.parse(raw)); },
  };
  const router = createAuthorityRelayRouter({
    authenticateFrame: frame => frame.envelope.actor,
    authorizeCommand: () => ({ scope: { kind: 'teacher' } }),
    targetHostFor: () => 'host-1',
    sendToHost: () => true,
    createRelayId: (() => { let id = 0; return () => `device-pending-${++id}`; })(),
    maxPendingPerClient: 2,
    maxPendingPerDevice: 1,
  });
  const sharedFrame = {
    protocol: 'gewu.authority-socket.v1',
    type: 'command.submit',
    envelope: { actor: { userId: 'user-1', deviceId: 'shared-device', role: 'teacher' } },
  };
  await router.handleDesktopFrame(socketA, { ...sharedFrame, requestId: 'pending-a' });
  await router.handleDesktopFrame(socketB, { ...sharedFrame, requestId: 'pending-b' });
  assert.strictEqual(framesA.length, 0);
  assert.strictEqual(framesB[0].error.code, 'AUTHORITY_RELAY_DEVICE_PENDING_LIMIT');
  router.removeClient(socketA);
  router.removeClient(socketB);
}

(async function main() {
  await verifyDevicePendingLimit();
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE primary_host_epochs(
    id TEXT PRIMARY KEY,db_authority_id TEXT,generation INTEGER,device_id TEXT,status TEXT
  );`);
  const server = http.createServer((_request, response) => response.end('ok'));
  let relaySequence = 0;
  let releaseConcurrentAuthorization = null;
  const relay = new CloudRelaySocketServer(server, {
    db,
    hostIdentity: () => ({ deviceId: 'host-1', role: 'primary-host', userId: 'admin-1' }),
    desktopIdentity: () => ({ deviceId: 'desktop-1', role: 'desktop-client', userId: 'user-1' }),
    authenticateAuthorityFrame: frame => frame.envelope.actor,
    authenticateAuthorityConnection: frame => {
      assert.strictEqual(frame.protocol, 'gewu.authority-socket.v1');
      assert.strictEqual(frame.type, 'connection.authenticate');
      const deviceId = String(frame.auth['x-gewu-authority-device-id'] || '');
      assert.match(deviceId, /^desktop-[1-9]$/);
      return { deviceId, role: 'teacher', userId: 'user-1' };
    },
    authorizeAuthorityCommand: envelope => {
      if (envelope.commandId === 'command-concurrent-1') {
        return new Promise(resolve => { releaseConcurrentAuthorization = resolve; });
      }
      return { scope: { kind: 'teacher' } };
    },
    targetHostFor: () => 'host-1',
    createRelayId: () => `relay-same-db-${++relaySequence}`,
    authorityMaxPayloadBytes: 1024,
    authorityMessageLimit: 10,
    authorityMessageWindowMs: 1000,
    authorityMaxConcurrentMessages: 1,
    authorityMaxConcurrentMessagesPerDevice: 1,
    authorityMaxPendingPerConnection: 1,
    authorityMaxPendingPerDevice: 1,
    authorityMaxConnections: 3,
    authorityMaxUnauthenticatedConnections: 1,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `ws://127.0.0.1:${server.address().port}`;
  const host = new WebSocket(`${base}/ws/cloud-relay?role=host`);
  const hostMessages = collect(host);
  await waitFor(hostMessages, message => message.type === 'connected', 'HOST_RELAY_NOT_CONNECTED');
  const desktop = new WebSocket(`${base}/ws/authority`);
  const desktopMessages = collect(desktop);
  await new Promise(resolve => desktop.once('open', resolve));
  await sleep(30);
  assert.strictEqual(
    desktopMessages.some(message => message.type === 'ready'),
    false,
    'public authority sockets must authenticate before becoming ready',
  );
  authenticate(desktop);
  await waitFor(desktopMessages, message => message.type === 'ready', 'AUTHORITY_RELAY_NOT_READY');

  const heldUnauthenticated = new WebSocket(`${base}/ws/authority`);
  await new Promise(resolve => heldUnauthenticated.once('open', resolve));
  const excessUnauthenticated = new WebSocket(`${base}/ws/authority`);
  const excessUnauthenticatedClosed = waitForClose(
    excessUnauthenticated,
    'SERVER_UNAUTHENTICATED_CONNECTION_LIMIT_REQUIRED',
  );
  await new Promise(resolve => excessUnauthenticated.once('open', resolve));
  assert.strictEqual((await excessUnauthenticatedClosed).code, 1013);
  const heldUnauthenticatedClosed = waitForClose(heldUnauthenticated, 'HELD_UNAUTHENTICATED_CLOSE_REQUIRED');
  heldUnauthenticated.close(1000, 'test complete');
  await heldUnauthenticatedClosed;

  const deviceTwo = new WebSocket(`${base}/ws/authority`);
  const deviceTwoMessages = collect(deviceTwo);
  await new Promise(resolve => deviceTwo.once('open', resolve));
  authenticate(deviceTwo, 'desktop-2');
  await waitFor(deviceTwoMessages, message => message.type === 'ready', 'DEVICE_TWO_NOT_READY');
  const deviceThree = new WebSocket(`${base}/ws/authority`);
  const deviceThreeMessages = collect(deviceThree);
  await new Promise(resolve => deviceThree.once('open', resolve));
  authenticate(deviceThree, 'desktop-3');
  await waitFor(deviceThreeMessages, message => message.type === 'ready', 'DEVICE_THREE_NOT_READY');
  const excessTotal = new WebSocket(`${base}/ws/authority`);
  const excessTotalClosed = waitForClose(excessTotal, 'SERVER_TOTAL_CONNECTION_LIMIT_REQUIRED');
  await new Promise(resolve => excessTotal.once('open', resolve));
  assert.strictEqual((await excessTotalClosed).code, 1013);
  const deviceTwoClosed = waitForClose(deviceTwo, 'DEVICE_TWO_CLOSE_REQUIRED');
  const deviceThreeClosed = waitForClose(deviceThree, 'DEVICE_THREE_CLOSE_REQUIRED');
  deviceTwo.close(1000, 'test complete');
  deviceThree.close(1000, 'test complete');
  await Promise.all([deviceTwoClosed, deviceThreeClosed]);

  const frame = {
    protocol: 'gewu.authority-socket.v1',
    type: 'command.submit',
    requestId: 'request-same-db-1',
    envelope: {
      commandId: 'command-same-db-1',
      authorityId: 'authority-1',
      hostEpochId: 'epoch-1',
      actor: { userId: 'user-1', deviceId: 'desktop-1', role: 'teacher' },
    },
    auth: { 'x-gewu-device-signature': 'isolated-signature' },
  };
  desktop.send(JSON.stringify(frame));
  const forwarded = await waitFor(hostMessages,
    message => message.type === 'authority_command_forward', 'AUTHORITY_FRAME_NOT_FORWARDED');
  assert.strictEqual(forwarded.payload.frame.envelope.commandId, 'command-same-db-1');
  const receipt = {
    protocol: 'gewu.authority-socket.v1',
    type: 'command.receipt',
    requestId: frame.requestId,
    receipt: { commandId: frame.envelope.commandId },
  };
  host.send(JSON.stringify({
    type: 'authority_command_result',
    payload: { relayRequestId: forwarded.payload.relayRequestId, response: receipt },
  }));
  const delivered = await waitFor(desktopMessages,
    message => message.type === 'command.receipt', 'AUTHORITY_RECEIPT_NOT_RETURNED');
  assert.strictEqual(delivered.receipt.commandId, 'command-same-db-1');

  const pendingFirst = {
    ...frame,
    requestId: 'request-pending-1',
    envelope: { ...frame.envelope, commandId: 'command-pending-1' },
  };
  const pendingSecond = {
    ...frame,
    requestId: 'request-pending-2',
    envelope: { ...frame.envelope, commandId: 'command-pending-2' },
  };
  desktop.send(JSON.stringify(pendingFirst));
  const pendingForward = await waitFor(hostMessages,
    message => message.type === 'authority_command_forward'
      && message.payload.frame.requestId === pendingFirst.requestId,
    'FIRST_PENDING_FRAME_NOT_FORWARDED');
  desktop.send(JSON.stringify(pendingSecond));
  const pendingRejected = await waitFor(desktopMessages,
    message => message.type === 'command.error' && message.requestId === pendingSecond.requestId,
    'SECOND_PENDING_FRAME_NOT_REJECTED');
  assert.strictEqual(pendingRejected.error.code, 'AUTHORITY_RELAY_PENDING_LIMIT');
  host.send(JSON.stringify({
    type: 'authority_command_result',
    payload: {
      relayRequestId: pendingForward.payload.relayRequestId,
      response: { ...receipt, requestId: pendingFirst.requestId },
    },
  }));

  const concurrentFirst = {
    ...frame,
    requestId: 'request-concurrent-1',
    envelope: { ...frame.envelope, commandId: 'command-concurrent-1' },
  };
  const concurrentSecond = {
    ...frame,
    requestId: 'request-concurrent-2',
    envelope: { ...frame.envelope, commandId: 'command-concurrent-2' },
  };
  desktop.send(JSON.stringify(concurrentFirst));
  while (!releaseConcurrentAuthorization) await sleep(5);
  desktop.send(JSON.stringify(concurrentSecond));
  const concurrentRejected = await waitFor(desktopMessages,
    message => message.type === 'command.error' && message.requestId === concurrentSecond.requestId,
    'SECOND_CONCURRENT_FRAME_NOT_REJECTED');
  assert.strictEqual(concurrentRejected.error.code, 'AUTHORITY_SOCKET_CONCURRENCY_LIMIT');
  releaseConcurrentAuthorization({ scope: { kind: 'teacher' } });
  const concurrentForward = await waitFor(hostMessages,
    message => message.type === 'authority_command_forward'
      && message.payload.frame.requestId === concurrentFirst.requestId,
    'CONCURRENT_FRAME_NOT_FORWARDED_AFTER_RELEASE');
  host.send(JSON.stringify({
    type: 'authority_command_result',
    payload: {
      relayRequestId: concurrentForward.payload.relayRequestId,
      response: { ...receipt, requestId: concurrentFirst.requestId },
    },
  }));

  const unauthenticated = new WebSocket(`${base}/ws/authority`);
  const unauthenticatedClosed = waitForClose(unauthenticated, 'UNAUTHENTICATED_SOCKET_NOT_CLOSED');
  await new Promise(resolve => unauthenticated.once('open', resolve));
  unauthenticated.send(JSON.stringify(frame));
  assert.strictEqual((await unauthenticatedClosed).code, 1008);

  const invalidAuthentication = new WebSocket(`${base}/ws/authority`);
  const invalidAuthenticationClosed = waitForClose(
    invalidAuthentication,
    'INVALID_AUTHENTICATION_SOCKET_NOT_CLOSED',
  );
  await new Promise(resolve => invalidAuthentication.once('open', resolve));
  invalidAuthentication.send(JSON.stringify({
    protocol: 'gewu.authority-socket.v1',
    type: 'connection.authenticate',
    auth: { 'x-gewu-authority-device-id': 'attacker-device' },
  }));
  assert.strictEqual((await invalidAuthenticationClosed).code, 1008);

  const oversized = new WebSocket(`${base}/ws/authority`);
  const oversizedMessages = collect(oversized);
  await new Promise(resolve => oversized.once('open', resolve));
  authenticate(oversized, 'desktop-4');
  await waitFor(oversizedMessages, message => message.type === 'ready', 'OVERSIZED_SOCKET_NOT_READY');
  const oversizedClosed = waitForClose(oversized, 'OVERSIZED_SOCKET_NOT_CLOSED');
  oversized.send(JSON.stringify({ padding: 'x'.repeat(2048) }));
  assert.strictEqual((await oversizedClosed).code, 1009);

  const rateLimited = new WebSocket(`${base}/ws/authority`);
  const rateMessages = collect(rateLimited);
  await new Promise(resolve => rateLimited.once('open', resolve));
  authenticate(rateLimited, 'desktop-5');
  await waitFor(rateMessages, message => message.type === 'ready', 'RATE_SOCKET_NOT_READY');
  const rateClosed = waitForClose(rateLimited, 'RATE_LIMITED_SOCKET_NOT_CLOSED');
  for (let index = 0; index <= 10; index += 1) {
    rateLimited.send(JSON.stringify({ protocol: 'gewu.authority-socket.v1', type: 'noop' }));
  }
  assert.strictEqual((await rateClosed).code, 1008);

  releaseConcurrentAuthorization = null;
  const replacedInFlight = {
    ...frame,
    requestId: 'request-replaced-inflight',
    envelope: { ...frame.envelope, commandId: 'command-concurrent-1' },
  };
  assert.strictEqual(desktop.readyState, WebSocket.OPEN);
  assert.strictEqual(relay.authorityDeviceInFlight.get('desktop-1'), undefined);
  desktop.send(JSON.stringify(replacedInFlight));
  const replacementAuthorizationDeadline = Date.now() + 3000;
  while (!releaseConcurrentAuthorization && Date.now() < replacementAuthorizationDeadline) await sleep(5);
  assert.strictEqual(typeof releaseConcurrentAuthorization, 'function',
    `replacement authorization did not start: ${JSON.stringify(desktopMessages.slice(-3))}`);
  const oldDesktopClosed = waitForClose(desktop, 'SAME_DEVICE_OLD_SOCKET_NOT_REPLACED');
  const replacement = new WebSocket(`${base}/ws/authority`);
  const replacementMessages = collect(replacement);
  await new Promise(resolve => replacement.once('open', resolve));
  authenticate(replacement);
  await waitFor(replacementMessages, message => message.type === 'ready', 'REPLACEMENT_SOCKET_NOT_READY');
  assert.strictEqual((await oldDesktopClosed).code, 1000);
  replacement.send(JSON.stringify({
    ...frame,
    requestId: 'request-device-inflight-bypass',
    envelope: { ...frame.envelope, commandId: 'command-device-inflight-bypass' },
  }));
  const deviceInflightRejected = await waitFor(replacementMessages,
    message => message.type === 'command.error'
      && message.requestId === 'request-device-inflight-bypass',
    'SAME_DEVICE_INFLIGHT_LIMIT_BYPASSED');
  assert.strictEqual(deviceInflightRejected.error.code, 'AUTHORITY_SOCKET_DEVICE_CONCURRENCY_LIMIT');
  releaseConcurrentAuthorization({ scope: { kind: 'teacher' } });
  const deviceCleanupDeadline = Date.now() + 3000;
  while (relay.authorityDeviceInFlight.has('desktop-1') && Date.now() < deviceCleanupDeadline) await sleep(5);
  assert.strictEqual(relay.authorityDeviceInFlight.has('desktop-1'), false);
  assert.strictEqual(
    relay.authorityDeviceConnections.get('desktop-1')?.readyState,
    WebSocket.OPEN,
    'the replacement must own the live server-side device connection after old-socket cleanup',
  );
  const reconnectFrame = {
    ...frame,
    requestId: 'request-reconnect-after-cleanup',
    envelope: { ...frame.envelope, commandId: 'command-reconnect-after-cleanup' },
  };
  replacement.send(JSON.stringify(reconnectFrame));
  const reconnectForward = await waitFor(hostMessages,
    message => message.type === 'authority_command_forward'
      && message.payload.frame.requestId === reconnectFrame.requestId,
    'LEGAL_RECONNECT_DID_NOT_RECOVER_AFTER_OLD_SOCKET_CLEANUP');
  host.send(JSON.stringify({
    type: 'authority_command_result',
    payload: {
      relayRequestId: reconnectForward.payload.relayRequestId,
      response: { ...receipt, requestId: reconnectFrame.requestId },
    },
  }));
  await waitFor(replacementMessages,
    message => message.type === 'command.receipt' && message.requestId === reconnectFrame.requestId,
    'LEGAL_RECONNECT_RECEIPT_NOT_DELIVERED');

  host.close();
  replacement.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  relay.wss.close();
  relay.authorityWss.close();
  await new Promise(resolve => server.close(resolve));
  db.close();
  console.log('backend same-control-plane authority relay checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
