// UTF-8: execute the real connectivity effects so offline and online modes switch without a restart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ast = ts.createSourceFile('DesktopIdentityGate.tsx', fs.readFileSync(path.join(__dirname, 'DesktopIdentityGate.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sources = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'renewSessionSilently') sources.renew = node.initializer.getText(ast);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
    const text = node.getText(ast);
    if (text.includes('switchToOffline')) sources.mode = text;
    if (text.includes('retryInitialization')) sources.loginGate = text;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert(sources.mode, 'test must execute the real online/offline mode effect');
assert(sources.loginGate, 'test must execute the real login-gate reconnect effect');
const compiled = {};
for (const key of Object.keys(sources)) {
  compiled[key] = ts.transpileModule(`return () => { return ${sources[key]}; };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const run = (key, scope) => new Function(...Object.keys(scope), compiled[key])(...Object.values(scope))();
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(effectKey, { kind, online, renewed = true, lease }) {
  const calls = { renew: 0, offlineResume: 0, accepted: [], retried: 0 };
  const listeners = new Map(), timers = [];
  const state = { online };
  const scope = {
    useEffect: fn => fn(),
    canStartBusinessRuntime: ({ gateState }) => ['online-unlocked', 'offline-unlocked'].includes(gateState.kind),
    browserOnline: () => state.online,
    renewSessionSilently: async () => { calls.renew++; return renewed; },
    resumeOfflineAfterNetworkFailure: async input => {
      calls.offlineResume++;
      assert.deepEqual(input, { client: scope.clientRef.current, baseUrl: 'https://cloud.test' });
      if (lease === null) throw new Error('DESKTOP_IDENTITY_OFFLINE_LEASE_INVALID');
      return { gateState: lease };
    },
    acceptRuntime: result => calls.accepted.push(result.gateState.kind),
    retryInitialization: () => { calls.retried++; },
    gateState: { kind }, baseUrl: 'https://cloud.test', runtimeEpochRef: { current: 7 }, clientRef: { current: { id: 'client' } },
    window: {
      addEventListener: (event, fn) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
      removeEventListener: (event, fn) => { const list = listeners.get(event) || []; const at = list.indexOf(fn); if (at >= 0) list.splice(at, 1); },
      setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
      clearTimeout: timer => { timer.cleared = true; },
    },
  };
  const cleanup = run(effectKey, scope);
  const fire = async event => {
    for (const fn of [...(listeners.get(event) || [])]) await fn();
    await tick(); await tick();
  };
  return { calls, cleanup, fire, timers, listeners, setOnline: value => { state.online = value; } };
}

(async () => {
  const { isDesktopIdentityAuthorizationRejection } = await import('../services/desktopIdentityClient.mjs');
  for (const code of ['DESKTOP_DEVICE_NOT_ACTIVE', 'VNEXT_DESKTOP_AUTHORIZATION_INVALID', 'CLOUD_ONLINE_IDENTITY_REJECTED', 'DESKTOP_IDENTITY_NETWORK_TIMEOUT']) {
    const runtimeEpochRef = { current: 9 }, locked = [];
    const renew = run('renew', {
      useCallback: fn => fn, browserOnline: () => true, roleSwitchRecoveryRef: { current: null },
      runtimeEpochRef, baseUrl: 'https://cloud.test', isDesktopIdentityAuthorizationRejection,
      clientRef: { current: { resume: async () => { throw Object.assign(new Error(code), { code }); } } },
      acceptRuntime: () => assert.fail('rejection must not accept a runtime'),
      secureRelock: async state => { runtimeEpochRef.current++; locked.push(state.kind); },
    });
    assert.equal(await renew(), false);
    assert.deepEqual(locked, code === 'DESKTOP_IDENTITY_NETWORK_TIMEOUT' ? [] : ['online-authentication-required']);
  }
  // 断网启动后恢复联网：静默续期，不需要用户重启或手动登录。
  const restored = await setup('mode', { kind: 'offline-unlocked', online: false });
  assert.equal(restored.calls.renew, 0, 'an offline runtime without connectivity must not call the cloud');
  restored.setOnline(true);
  await restored.fire('online');
  assert.equal(restored.calls.renew, 1, 'connectivity must silently renew the cloud session');
  restored.cleanup();

  // 挂载时已经联网（例如离线租约期间网络悄悄恢复）也要立刻续期。
  const mounted = await setup('mode', { kind: 'offline-unlocked', online: true });
  assert.equal(mounted.calls.renew, 1, 'an offline runtime mounted while online must renew immediately');
  mounted.cleanup();

  // 云端仍不可达时按固定间隔重试，卸载后取消。
  const retrying = await setup('mode', { kind: 'offline-unlocked', online: true, renewed: false });
  const pending = retrying.timers.at(-1);
  assert(pending && pending.ms === 15000 && !pending.cleared, 'a failed silent renew must schedule one retry');
  retrying.cleanup();
  assert.equal(pending.cleared, true, 'unmounting must cancel the pending renew retry');
  let finishRenew;
  const inFlight = await setup('mode', { kind: 'offline-unlocked', online: true, renewed: new Promise(resolve => { finishRenew = resolve; }) });
  await inFlight.fire('online');
  assert.equal(inFlight.calls.renew, 1, 'repeated connectivity events must share an in-flight renewal');
  inFlight.cleanup();finishRenew(false);await tick();
  assert.equal(inFlight.timers.length, 0, 'an unmounted mode watcher must never restart a retry');

  // 联网运行中断网：改用仍然有效的离线租约，业务不中断。
  const dropped = await setup('mode', { kind: 'online-unlocked', online: true, lease: { kind: 'offline-unlocked' } });
  assert.equal(dropped.calls.offlineResume, 0, 'connectivity alone must not reopen the offline lease');
  dropped.setOnline(false);
  await dropped.fire('offline');
  assert.deepEqual(dropped.calls.accepted, ['offline-unlocked'], 'losing the network must move to the offline lease');
  dropped.cleanup();

  // 租约不可用时保持当前运行时，由到期逻辑做安全锁定。
  const expired = await setup('mode', { kind: 'online-unlocked', online: true, lease: { kind: 'offline-blocked' } });
  expired.setOnline(false);
  await expired.fire('offline');
  assert.equal(expired.calls.offlineResume, 1);
  assert.deepEqual(expired.calls.accepted, [], 'an unusable lease must not reopen the business runtime');
  expired.cleanup();

  // 登录页：联网恢复后自动重试托管会话；其它状态不注册监听。
  for (const kind of ['offline-authentication-required', 'locked', 'online-authentication-required']) {
    const gate = await setup('loginGate', { kind, online: false });
    const expected = kind === 'online-authentication-required' ? 0 : 1;
    assert.equal((gate.listeners.get('online') || []).length, expected, kind + ' must listen for reconnect only while the cloud session is missing');
    gate.setOnline(true);
    await gate.fire('online');
    assert.equal(gate.calls.retried, expected, kind + ' must auto-retry the managed session once online');
    gate.cleanup?.();
    assert.equal((gate.listeners.get('online') || []).length, 0, 'unmounting must remove the reconnect listener');
  }
  console.log('desktop online/offline automatic mode switch checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
