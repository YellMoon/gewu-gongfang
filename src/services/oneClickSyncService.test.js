const assert = require('assert');

function makeEngine(pendingChanges = []) {
  const state = {
    pendingChanges: [...pendingChanges],
    pushed: 0,
    pulled: 0,
  };
  return {
    state,
    getDeviceId: () => 'desktop_test',
    getPendingChanges: () => [...state.pendingChanges],
    getStatus: () => ({ lastSyncTime: 0 }),
    async push(pushFn) {
      const result = await pushFn({
        changes: [...state.pendingChanges],
        operations: [...state.pendingChanges],
        deviceId: 'desktop_test',
        clientId: 'desktop_test',
        tenantId: 'default',
        lastSyncTimestamp: 0,
      });
      if (result.success) {
        state.pushed = state.pendingChanges.length;
        state.pendingChanges = [];
        return { success: true, pushed: state.pushed };
      }
      return { success: false, pushed: 0 };
    },
    async pull(pullFn, localData) {
      const result = await pullFn(0);
      if (!result.success) return { success: false, applied: 0, conflicts: [] };
      state.pulled = result.changes.length;
      if (localData?.students) {
        result.changes.forEach(change => localData.students.set(change.data.id, change.data));
      }
      return { success: true, applied: state.pulled, conflicts: [] };
    },
  };
}

function makeTransport(name, options = {}) {
  return {
    name,
    label: options.label || name,
    async check() {
      return options.check || { ok: true };
    },
    async preview() {
      return {
        success: true,
        hostOnline: options.hostOnline !== false,
        incomingChanges: options.incomingChanges || [],
      };
    },
    async pushSyncBatch(batch) {
      if (options.waitingHost) return { success: false, waitingHost: true };
      return { success: options.pushSuccess !== false, serverTimestamp: 100, applied: batch.changes.length };
    },
    async pullSyncOps() {
      return {
        success: options.pullSuccess !== false,
        changes: options.incomingChanges || [],
        operations: options.incomingChanges || [],
        serverTimestamp: 100,
      };
    },
    async submitSyncRequest(input) {
      return {
        success: true,
        requestId: options.requestId || 'relay_req_1',
        acceptedChanges: input.pendingChanges.length,
      };
    },
  };
}

async function main() {
  const {
    buildOneClickSyncPreview,
    chooseSyncTransport,
    runOneClickSync,
  } = await import('./oneClickSyncService.mjs');
  const onlineActor = {
    authorization: 'Bearer desktop-v2',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authContext: {
      userId: 'u1', deviceId: 'desktop_test', activeRole: 'teacher', teacherId: 't1',
      sessionId: 'sid-1', authVersion: 1, credentialVersion: 1,
    },
  };
  const requireOnlineSession = async () => onlineActor;

  const preview = buildOneClickSyncPreview({
    channel: 'direct',
    pendingChanges: [
      { table: 'courses', action: 'create', data: { id: 'c1' } },
      { table: 'schedules', action: 'delete', data: { id: 's1', _risk_level: 'high' } },
    ],
    incomingChanges: [
      { table: 'students', action: 'update', data: { id: 'stu1' } },
    ],
  });
  assert.strictEqual(preview.upload.total, 2);
  assert.strictEqual(preview.upload.byAction.create, 1);
  assert.strictEqual(preview.upload.byAction.delete, 1);
  assert.strictEqual(preview.download.total, 1);
  assert.strictEqual(preview.risk.high, 1);
  assert.ok(preview.confirmationRequired);

  const direct = makeTransport('direct');
  const cloud = makeTransport('cloud');
  const chosenDirect = await chooseSyncTransport([direct, cloud]);
  assert.strictEqual(chosenDirect.name, 'direct', 'direct transport should win when available');

  const chosenCloud = await chooseSyncTransport([
    makeTransport('direct', { check: { ok: false, reason: 'lan unavailable' } }),
    cloud,
  ]);
  assert.strictEqual(chosenCloud.name, 'cloud', 'cloud relay should be used when direct is unavailable');

  const cancelledEngine = makeEngine([{ table: 'students', action: 'update', data: { id: 'stu1' } }]);
  const cancelled = await runOneClickSync({
    engine: cancelledEngine,
    transports: [direct],
    requireOnlineSession,
    confirmPreview: async () => false,
    buildLocalDataMaps: () => ({ students: new Map() }),
    applyLocalDataMaps: () => {},
  });
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.strictEqual(cancelledEngine.state.pushed, 0, 'cancel must not invoke push');
  assert.strictEqual(cancelledEngine.state.pendingChanges.length, 1, 'cancel should keep pending queue');

  const confirmedEngine = makeEngine([{ table: 'students', action: 'update', data: { id: 'stu1' } }]);
  const confirmed = await runOneClickSync({
    engine: confirmedEngine,
    transports: [
      makeTransport('direct', {
        incomingChanges: [{ table: 'students', action: 'update', data: { id: 'stu2', name: 'Host Student' } }],
      }),
    ],
    requireOnlineSession,
    confirmPreview: async () => true,
    buildLocalDataMaps: () => ({ students: new Map() }),
    applyLocalDataMaps: () => {},
  });
  assert.strictEqual(confirmed.status, 'synced');
  assert.strictEqual(confirmed.channel, 'direct');
  assert.strictEqual(confirmed.uploaded, 1);
  assert.strictEqual(confirmed.downloaded, 1);
  assert.strictEqual(confirmedEngine.state.pendingChanges.length, 0, 'successful push should clear pending queue');

  const waitingEngine = makeEngine([{ table: 'courses', action: 'create', data: { id: 'c2' } }]);
  const waiting = await runOneClickSync({
    engine: waitingEngine,
    transports: [
      makeTransport('direct', { check: { ok: false } }),
      makeTransport('cloud', { hostOnline: false, requestId: 'relay_req_wait' }),
    ],
    requireOnlineSession,
    confirmPreview: async () => true,
    buildLocalDataMaps: () => ({ students: new Map() }),
    applyLocalDataMaps: () => {},
  });
  assert.strictEqual(waiting.status, 'waiting-host');
  assert.strictEqual(waiting.channel, 'cloud');
  assert.strictEqual(waiting.requestId, 'relay_req_wait');
  assert.strictEqual(waitingEngine.state.pendingChanges.length, 1, 'relay waiting should keep local queue until host confirms');

  let offlineTransportChecks = 0;
  const offlineEngine = makeEngine([{ table: 'courses', action: 'update', data: { id: 'c-offline' } }]);
  const offline = await runOneClickSync({
    engine: offlineEngine,
    transports: [{ ...direct, check: async () => { offlineTransportChecks += 1; return { ok: true }; } }],
    requireOnlineSession: async () => {
      const error = new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
      error.code = 'ONLINE_DESKTOP_SESSION_REQUIRED';
      throw error;
    },
    confirmPreview: async () => true,
    buildLocalDataMaps: () => ({ students: new Map() }),
    applyLocalDataMaps: () => {},
  });
  assert.strictEqual(offline.status, 'failed');
  assert.strictEqual(offline.error, 'ONLINE_DESKTOP_SESSION_REQUIRED');
  assert.strictEqual(offlineTransportChecks, 0, 'offline lease must fail before transport discovery or mutation');
  assert.strictEqual(offlineEngine.state.pendingChanges.length, 1);

  console.log('one-click sync service checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
