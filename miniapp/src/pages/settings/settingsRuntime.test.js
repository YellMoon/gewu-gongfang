'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const experience = require('../../utils/accountExperience');
const { createAuthSessionRuntime } = require('../../utils/miniappApiSessionRuntime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = fs.readFileSync(require.resolve('./index.tsx'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
}
const byClass = (tree, name) => nodes(tree).filter(n => (n.props.className || '').split(' ').includes(name));
const words = tree => Array.isArray(tree) ? tree.map(words).join('') : tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'object' ? words(tree.props?.children) : String(tree);
function harness({ offline = false, visitor = false, realSession = false } = {}) {
  const state = [], effects = [];
  let cursor = 0;
  const h = { epoch: 1, online: !offline, lastSync: 0, pulls: 0, toasts: [], modals: [], routes: [], cleanups: [], clearCalls: 0, removed: [], invalidated: 0 };
  h.user = visitor ? { id: 'v', role: 'visitor', user_type: 'visitor', identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor', authority_id: 'cloud:v', capabilities: [...experience.VISITOR_CAPABILITIES] }
    : { id: 't', role: 'teacher', account_state: 'formal', token_use: 'miniapp-cloud', name: 'Teacher' };
  h.result = async () => true;
  h.sessionStorage = { version: 1, generation: h.epoch, invalidated: false };
  const actualSession = realSession ? createAuthSessionRuntime({
    readToken: () => 'fixture-token', readIdentity: () => h.user,
    readGeneration: () => h.epoch, writeGeneration: value => { h.epoch = value; },
    readSessionState: () => h.sessionStorage, writeSessionState: value => { h.sessionStorage = value; },
  }) : null;
  const jsx = (type, props) => ({ type, props: props || {} });
  const slot = initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return i; };
  h.networkResult = async () => ({ networkType: h.online ? 'wifi' : 'none' });
  const taro = { getNetworkType: () => h.networkResult(), getStorageSync: key => key === 'user_info' ? h.user : null, removeStorageSync: key => h.removed.push(key),
    showToast: value => h.toasts.push(value), showModal: value => h.modals.push(value),
    navigateTo: value => h.routes.push(value), redirectTo: value => h.routes.push(value), reLaunch: value => h.routes.push(value) };
  const deps = {
    react: { useState: initial => { const i = slot(typeof initial === 'function' ? initial() : initial); return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useRef: initial => state[slot({ current: initial })], useEffect: fn => { slot(null); if (!h.mounted) effects.push(fn); } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@tarojs/components': { View: 'View', Text: 'Text' },
    '@tarojs/taro': { default: taro, onNetworkStatusChange: fn => { h.network = fn; }, offNetworkStatusChange: fn => { h.unsubscribed = fn === h.network; },
      useDidShow: fn => { h.show = fn; }, useDidHide: fn => { h.hide = fn; } },
    '../../utils/authSession': { authSessionRuntime: actualSession || { capture: () => h.epoch, isSameSession: (epoch, options = {}) => epoch === h.epoch && (!h.sessionInvalidated || options.allowInvalidated === true), invalidateAndAdvance: () => { h.epoch++; h.invalidated++; } } },
    '../../utils/miniappApiSessionRuntime': { clearAuthenticatedSession: (dependencies, users) => { h.clearCalls++; h.clearedUsers = users; dependencies.invalidateAndAdvance(); dependencies.clearPermissionCache(); dependencies.clearBusinessCache(); dependencies.cleanupStorageKeys().forEach(dependencies.removeStorage); } },
    '../../utils/accountExperience': experience,
    '../../utils/storage': { isOnline: () => true, getLastSyncTimestamp: () => h.lastSync, clearBusinessCache: () => { h.businessCleared = true; } },
    '../../utils/permission': { clearPermissionCache: () => { h.permissionsCleared = true; } },
    '../../utils/sync': { pullFromCloud: () => { h.pulls++; return h.result(); } },
    '../../components/MembershipBadge': { default: 'MembershipBadge' }, '../../../package.json': { default: { version: 'test-version' } }, './index.scss': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, module, module.exports);
  h.render = () => { cursor = 0; return module.exports.default(); };
  h.mount = () => { const tree = h.render(); h.mounted = true; h.cleanups = effects.map(fn => fn()); return tree; };
  h.enter = async () => { h.mount(); h.show?.(); await tick(); };
  h.refresh = () => byClass(h.render(), 'btn-sync')[0].props.onClick();
  h.logout = () => byClass(h.render(), 'logout-btn')[0].props.onClick();
  return h;
}
const tests = {
  'logout cancellation and exact cleanup': async () => {
    const h = harness(); h.mount(); h.logout(); h.modals[0].success({ confirm: false }); assert.equal(h.clearCalls, 0);
    h.logout(); h.modals[1].success({ confirm: true }); assert.equal(h.clearCalls, 1); assert.equal(h.invalidated, 1);
    assert.equal(h.businessCleared, true); assert.equal(h.permissionsCleared, true);
    assert.deepEqual(h.removed, experience.accountSessionCleanupStorageKeys()); assert.equal(h.routes[0].url, '/pages/login/index');
  },
  'stale logout modal cannot clear a replacement account': async () => {
    const h = harness(); h.mount(); h.logout(); h.epoch++; h.user = { ...h.user, id: 'new-account' };
    h.modals[0].success({ confirm: true }); assert.equal(h.clearCalls, 0); assert.equal(h.routes.length, 0);
  },
  'already-invalidated unchanged session can still sign out locally': async () => {
    const h = harness(); h.sessionInvalidated = true; h.mount(); h.logout();
    h.modals[0].success({ confirm: true }); assert.equal(h.clearCalls, 1); assert.equal(h.routes[0].url, '/pages/login/index');
  },
  'actual persistent session runtime validates both logout boundaries': async () => {
    const expired = harness({ realSession: true }); expired.sessionStorage.invalidated = true;
    expired.mount(); expired.logout(); expired.modals[0].success({ confirm: true });
    assert.equal(expired.clearCalls, 1); assert.equal(expired.sessionStorage.invalidated, true);
    const replaced = harness({ realSession: true }); replaced.mount(); replaced.logout();
    replaced.epoch++; replaced.sessionStorage.generation = replaced.epoch; replaced.user = { ...replaced.user, id: 'replacement' };
    replaced.modals[0].success({ confirm: true }); assert.equal(replaced.clearCalls, 0);
  },
  'offline initial state and handler check': async () => {
    const h = harness({ offline: true }); await h.enter(); assert.equal(byClass(h.render(), 'btn-sync')[0].props.disabled, true);
    await h.refresh(); assert.equal(h.pulls, 0);
  },
  'return refreshes status without fetching business data': async () => {
    const h = harness(); h.mount(); h.lastSync = new Date(2026, 8, 23, 9, 7).getTime(); h.online = false;
    assert.equal(typeof h.show, 'function'); h.show(); await tick(); assert.ok(words(h.render()).includes('9/23 9:07'));
    assert.equal(byClass(h.render(), 'btn-sync')[0].props.disabled, true); assert.equal(h.pulls, 0);
    h.user = { ...h.user, name: 'Updated name' }; h.show(); assert.ok(words(h.render()).includes('Updated name'));
    h.online = true; h.network({ isConnected: true }); assert.equal(byClass(h.render(), 'btn-sync')[0].props.disabled, false);
  },
  'refresh results and concurrent click suppression': async () => {
    const h = harness(); await h.enter(); let finish; h.result = () => new Promise(resolve => { finish = resolve; });
    const first = h.refresh(); const second = h.refresh(); assert.equal(h.pulls, 1); finish(true); await Promise.all([first, second]);
    assert.equal(h.toasts.length, 1); assert.equal(h.toasts[0].icon, 'success');
    h.result = async () => false; await h.refresh(); assert.equal(h.toasts.at(-1).icon, 'none');
    h.result = async () => { throw Error('network'); }; await h.refresh(); assert.equal(h.toasts.at(-1).icon, 'none');
    assert.equal(byClass(h.render(), 'btn-sync')[0].props.disabled, false);
  },
  'late refresh cannot notify another page or account': async () => {
    for (const reason of ['identity', 'hide', 'unmount', 'logout']) {
      const h = harness(); await h.enter(); let finish; h.result = () => new Promise(resolve => { finish = resolve; });
      const pending = h.refresh(); await tick();
      if (reason === 'identity') h.epoch++;
      if (reason === 'hide') { assert.equal(typeof h.hide, 'function'); h.hide(); }
      if (reason === 'unmount') h.cleanups.forEach(fn => fn?.());
      if (reason === 'logout') { h.logout(); h.modals[0].success({ confirm: true }); }
      finish(true); await pending; assert.equal(h.toasts.length, 0, reason);
    }
  },
  'visitor application and logout preserve existing branch': async () => {
    const h = harness({ visitor: true }); h.mount(); assert.equal(byClass(h.render(), 'btn-sync').length, 0);
    byClass(h.render(), 'role-application-entry')[0].props.onClick(); assert.equal(h.routes[0].url, '/pages/account-application/index');
    h.logout(); h.modals[0].success({ confirm: true }); assert.equal(h.clearCalls, 1); assert.equal(h.routes[1].url, '/pages/login/index');
    h.cleanups.forEach(fn => fn?.()); assert.equal(h.unsubscribed, true);
  },
  'late network query cannot override a new event or hidden page': async () => {
    const h = harness(); h.mount(); let finish;
    h.networkResult = () => new Promise(resolve => { finish = resolve; }); h.show();
    h.network({ isConnected: false }); finish({ networkType: 'wifi' }); await tick();
    assert.equal(byClass(h.render(), 'btn-sync')[0].props.disabled, true);
    h.show(); h.hide(); finish({ networkType: 'wifi' }); await tick();
    assert.equal(byClass(h.render(), 'btn-sync')[0].props.disabled, true);
  },
};
(async () => {
  let failures = 0;
  for (const [name, test] of Object.entries(tests)) {
    try { await test(); console.log('PASS', name); } catch (error) { failures++; console.error('FAIL', name, error.message); }
  }
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
