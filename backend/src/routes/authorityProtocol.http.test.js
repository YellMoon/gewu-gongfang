const assert = require('assert');
const express = require('express');
const { PROTOCOL } = require('../../../shared/authorityProtocol');
const { createAuthorityProtocolRouter } = require('./authorityProtocol');

async function requestJson(baseUrl, method, pathname, { body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let responseBody = null;
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch (_error) {
    responseBody = null;
  }
  return { status: response.status, body: responseBody };
}

function command(overrides = {}) {
  return {
    protocol: PROTOCOL,
    commandId: 'command-http-1',
    idempotencyKey: 'idempotency-http-1',
    authorityId: 'authority-http-1',
    hostEpochId: 'epoch-http-1',
    actor: { userId: 'user-http-1', deviceId: 'device-http-1', role: 'teacher' },
    lease: { id: 'lease-http-1', grantVersion: 3 },
    type: 'schedule.update.v1',
    payload: { id: 'schedule-http-1', title: '隔离契约测试' },
    payloadHash: 'payload-hash-http-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

(async function main() {
  const executed = [];
  const receiptLookups = [];
  const receipt = {
    protocol: 'gewu.authority-receipt.v1',
    commandId: 'command-http-1',
    payloadHash: 'payload-hash-http-1',
    status: 'committed',
    resultHash: 'result-hash-http-1',
    authorityId: 'authority-http-1',
    hostEpochId: 'epoch-http-1',
    projectionVersion: 9,
    completedAt: '2026-07-28T00:00:01.000Z',
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.authorityActor = {
      userId: req.headers['x-test-user-id'],
      deviceId: req.headers['x-test-device-id'],
      role: req.headers['x-test-role'],
    };
    next();
  });
  app.use('/api/authority', createAuthorityProtocolRouter({
    executeCommand: async ({ envelope, actor }) => {
      if (envelope.lease.id === 'blocked-lease') {
        throw Object.assign(new Error('DEVICE_LEASE_INACTIVE'), {
          code: 'DEVICE_LEASE_INACTIVE',
          statusCode: 403,
        });
      }
      executed.push({ envelope, actor });
      return { command: { id: envelope.commandId, status: 'committed' }, receipt };
    },
    findReceipt: async ({ commandId, actor }) => {
      receiptLookups.push({ commandId, actor });
      return commandId === receipt.commandId ? receipt : null;
    },
  }));

  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const actorHeaders = {
    'x-test-user-id': 'user-http-1',
    'x-test-device-id': 'device-http-1',
    'x-test-role': 'teacher',
  };
  try {
    const invalid = await requestJson(baseUrl, 'POST', '/api/authority/commands', {
      headers: actorHeaders,
      body: command({ protocol: 'legacy.raw-sync.v1' }),
    });
    assert.strictEqual(invalid.status, 400);
    assert.strictEqual(invalid.body.error.code, 'AUTHORITY_PROTOCOL_INVALID');
    assert.strictEqual(executed.length, 0);

    const mismatchedActor = await requestJson(baseUrl, 'POST', '/api/authority/commands', {
      headers: { ...actorHeaders, 'x-test-device-id': 'other-device' },
      body: command(),
    });
    assert.strictEqual(mismatchedActor.status, 403);
    assert.strictEqual(mismatchedActor.body.error.code, 'AUTHORITY_ACTOR_MISMATCH');
    assert.strictEqual(executed.length, 0);

    const blockedLease = await requestJson(baseUrl, 'POST', '/api/authority/commands', {
      headers: actorHeaders,
      body: command({ lease: { id: 'blocked-lease', grantVersion: 3 } }),
    });
    assert.strictEqual(blockedLease.status, 403);
    assert.strictEqual(blockedLease.body.error.code, 'DEVICE_LEASE_INACTIVE');
    assert.strictEqual(executed.length, 0);

    const accepted = await requestJson(baseUrl, 'POST', '/api/authority/commands', {
      headers: actorHeaders,
      body: command(),
    });
    assert.strictEqual(accepted.status, 200);
    assert.deepStrictEqual(accepted.body, {
      success: true,
      command: { id: 'command-http-1', status: 'committed' },
      receipt,
    });
    assert.deepStrictEqual(executed, [{
      envelope: command(),
      actor: { userId: 'user-http-1', deviceId: 'device-http-1', role: 'teacher' },
    }], 'the cloud executor must receive the canonical envelope unchanged');

    const receiptResponse = await requestJson(
      baseUrl,
      'GET',
      '/api/authority/commands/command-http-1/receipt',
      { headers: actorHeaders },
    );
    assert.strictEqual(receiptResponse.status, 200);
    assert.deepStrictEqual(receiptResponse.body, { success: true, receipt });
    assert.deepStrictEqual(receiptLookups, [{
      commandId: 'command-http-1',
      actor: { userId: 'user-http-1', deviceId: 'device-http-1', role: 'teacher' },
    }]);

    const missingReceipt = await requestJson(
      baseUrl,
      'GET',
      '/api/authority/commands/unknown-command/receipt',
      { headers: actorHeaders },
    );
    assert.strictEqual(missingReceipt.status, 404);
    assert.strictEqual(missingReceipt.body.error.code, 'AUTHORITY_RECEIPT_NOT_FOUND');

    const retiredHostRoute = await requestJson(baseUrl, 'POST', '/api/authority/host/commands/claim', {
      body: { claimToken: 'retired-host-claim', leaseMs: 30_000, limit: 5 },
    });
    assert.strictEqual(retiredHostRoute.status, 404);

    console.log('authorityProtocol HTTP contract tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
