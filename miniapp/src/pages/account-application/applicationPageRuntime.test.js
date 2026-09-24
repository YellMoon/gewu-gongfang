'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const experience = require('../../utils/accountExperience');
const runtime = require('./applicationRuntime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = fs.readFileSync(require.resolve('./index.tsx'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const byClass = (tree, name) => nodes(tree).filter(n => (n.props.className || '').split(' ').includes(name));
function harness({ storage = new Map(), initialState = { state: 'not_submitted' } } = {}) {
  const state = [], effects = []; let cursor = 0;
  // UTF-8: Track verified entry separately from application writes.
  const h = { toasts: [], reads: 0, writes: [], routes: [], storage, epoch: 1, authorizationReads: 0, cacheClears: 0 };
  h.authorizationResult = async () => ({ success: false });
  const user = { id: 'v', role: 'visitor', user_type: 'visitor', identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor', authority_id: 'cloud:v', capabilities: [...experience.VISITOR_CAPABILITIES] };
  storage.set('user_info', user); storage.set('auth_token', 'fixture-token');
  h.result = async () => ({ success: true, data: { state: 'submitted' } });
  h.readResult = async () => ({ success: true, data: initialState });
  const slot = initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return i; };
  const jsx = (type, props) => ({ type, props: props || {} });
  const deps = {
    react: { useState: initial => { const i = slot(initial); return [state[i], next => { state[i] = next; }]; }, useRef: initial => state[slot({ current: initial })], useEffect: fn => { if (!h.mounted) effects.push(fn); } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@tarojs/components': Object.fromEntries(['Button','Input','Picker','Text','View'].map(x => [x,x])),
    '@tarojs/taro': { useDidShow: fn => { h.show = fn; }, useDidHide: fn => { h.hide = fn; }, default: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), showToast: value => h.toasts.push(value), reLaunch: async value => { if (h.navigationFails) throw new Error('navigation failed'); h.routes.push(value); } } },
    '../../utils/accountExperience': experience,
    '../../utils/api': { miniappCloudBusinessApi: { readAuthorization: async () => { h.authorizationReads++; return h.authorizationResult(); }, readRoleApplication: async () => { h.reads++; return h.readResult(); }, submitRoleApplication: (...args) => { h.writes.push(args); return h.result(); } } },
    '../../utils/authSession': { authSessionRuntime: { capture: () => ({ epoch: h.epoch, identity: storage.get('user_info'), token: storage.get('auth_token') }), isSameSession: session => session.epoch === h.epoch, invalidateAndAdvance: () => h.epoch++, activate: () => {} } },
    '../../utils/miniappApiSessionRuntime': require('../../utils/miniappApiSessionRuntime'),
    '../login/cloudSessionIdentityRuntime': require('../login/cloudSessionIdentityRuntime'),
    '../../utils/storage': { clearBusinessCache: () => h.cacheClears++, setBusinessCacheIdentity: () => {} },
    '../../utils/permission': { clearPermissionCache: () => {} },
    './applicationRuntime': runtime, './index.scss': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, module, module.exports);
  h.render = () => { cursor = 0; return module.exports.default(); };
  h.mount = async () => { h.render(); h.mounted = true; h.cleanups = effects.map(fn => fn()); h.show?.(); await tick(); };
  h.input = (index, value) => nodes(h.render()).filter(n => n.type === 'Input')[index].props.onInput({ detail: { value } });
  h.pick = (index, value) => nodes(h.render()).filter(n => n.type === 'Picker')[index].props.onChange({ detail: { value } });
  h.submit = async () => { byClass(h.render(), 'primary-action')[0].props.onClick(); await tick(); };
  return h;
}
async function resubmissionTests() {
  // UTF-8: Approval must have an actionable exit without another phone login.
  for (const role of ['teacher', 'student', 'family_member']) {
    const entered = harness({ initialState: { state: 'approved' } });
    await entered.mount();
    const button = byClass(entered.render(), 'approved-entry')[0];
    assert.ok(button, 'approved result needs an Enter Home action');
    assert.equal(button.props.children, '进入首页');
    entered.authorizationResult = async () => ({ success: true, data: { identity: { accountId: 'v', status: 'active', roles: [role], profile: { type: role === 'teacher' ? 'teacher' : 'student', id: 'profile', relationship: role === 'teacher' ? null : role === 'student' ? 'student' : 'guardian' } } } });
    button.props.onClick(); await tick();
    assert.equal(entered.storage.get('user_info').role, role);
    assert.equal(entered.storage.get('auth_token'), 'fixture-token', 'reuse the validated session, no phone login');
    assert.equal(entered.routes.at(-1).url, '/pages/index/index');
    assert.equal(entered.writes.length, 0); assert.equal(entered.authorizationReads, 1);
    assert.equal(entered.cacheClears, 1);
  }
  for (const response of [{ success: false }, { success: true, data: { identity: { accountId: 'other', status: 'active', roles: ['super_admin'] } } }, { success: true, data: { identity: { accountId: 'v', status: 'visitor', roles: [] } } }]) {
    const h = harness({ initialState: { state: 'approved' } }); await h.mount();
    h.authorizationResult = async () => response;
    byClass(h.render(), 'approved-entry')[0].props.onClick(); await tick();
    assert.equal(h.storage.get('user_info').role, 'visitor'); assert.equal(h.routes.length, 0);
    assert.equal(h.toasts.at(-1).title, '暂时无法进入，请稍后重试'); assert.equal(h.cacheClears, 0);
  }
  for (const reason of ['account', 'hide', 'unmount']) {
    const h = harness({ initialState: { state: 'approved' } }); await h.mount();
    let finish; h.authorizationResult = () => new Promise(resolve => { finish = resolve; });
    const enter = byClass(h.render(), 'approved-entry')[0].props.onClick; enter(); enter(); await tick();
    assert.equal(h.authorizationReads, 1, 'double tap cannot start two identity transitions');
    if (reason === 'account') h.epoch++; else if (reason === 'hide') h.hide(); else h.cleanups.forEach(fn => fn?.());
    finish({ success: true, data: { identity: { accountId: 'v', status: 'active', roles: ['super_admin'] } } }); await tick();
    assert.equal(h.cacheClears, 0); assert.equal(h.routes.length, 0); assert.equal(h.toasts.length, 0);
    if (reason === 'hide') {
      // UTF-8: Returning after a discarded request must not leave a stuck button.
      h.show(); await tick();
      assert.equal(byClass(h.render(), 'approved-entry')[0].props.disabled, false);
    }
  }
  const retryEntry = harness({ initialState: { state: 'approved' } }); await retryEntry.mount();
  retryEntry.authorizationResult = async () => ({ success: true, data: { identity: { accountId: 'v', status: 'active', roles: ['teacher'], profile: { type: 'teacher', id: 't' } } } });
  retryEntry.navigationFails = true;
  byClass(retryEntry.render(), 'approved-entry')[0].props.onClick(); await tick();
  assert.equal(retryEntry.storage.get('user_info').role, 'teacher');
  assert.equal(retryEntry.storage.get('auth_token'), 'fixture-token', 'failed navigation retains verified session');
  assert.equal(retryEntry.toasts.at(-1).title, '暂时无法进入，请稍后重试');
  retryEntry.navigationFails = false;
  byClass(retryEntry.render(), 'approved-entry')[0].props.onClick(); await tick();
  assert.equal(retryEntry.routes.at(-1).url, '/pages/index/index');
  for (const role of ['teacher', 'student', 'family_member', 'super_admin']) {
    const denied = harness();
    denied.storage.set('user_info', { id: 'formal', role, account_state: 'formal' });
    await denied.mount();
    assert.equal(denied.reads, 0, role);
    assert.equal(denied.writes.length, 0, role);
    assert.equal(byClass(denied.render(), 'application-form').length, 0, role);
    assert.equal(denied.routes[0].url, '/pages/login/index');
  }
  const legacy = harness({ storage: new Map([['cloud_role_application_key:v:student:existing', 'legacy-unresolved-key']]) });
  await legacy.mount(); legacy.input(0, 'Test'); legacy.input(1, '13800138000'); await legacy.submit();
  assert.equal(legacy.writes[0][2], 'legacy-unresolved-key', 'upgrade must retain an unresolved legacy attempt');
  assert.equal(legacy.storage.get('cloud_role_application_attempt:v'), 'legacy-unresolved-key');
  for (const latest of [{ state: 'rejected', application: {} }, { state: 'unexpected' }]) {
    const unknown = harness(); await unknown.mount(); unknown.input(0, 'Test'); unknown.input(1, '13800138000');
    unknown.readResult = async () => ({ success: true, data: latest }); await unknown.submit();
    assert.equal(unknown.writes.length, 0, 'missing/unknown authoritative state must fail closed');
  }
  const rejected = { state: 'rejected', application: { applicationId: 'rejected-1', requestedIdentity: 'student', profileMode: 'existing', status: 'rejected' } };
  const storage = new Map([['cloud_role_application_key:v:student:existing', 'old-application-key']]);
  const h = harness({ storage, initialState: rejected }); await h.mount();
  h.input(0, 'Corrected Name'); h.input(1, '13800138000');
  h.result = async () => ({ success: false, error: 'request:fail timeout' });
  await h.submit();
  assert.notEqual(h.writes[0][2], 'old-application-key', 'rejection must start a fresh application attempt');
  await h.submit(); assert.equal(h.writes[0][2], h.writes[1][2], 'ambiguous retry must retain its key');
  const reopened = harness({ storage, initialState: rejected }); await reopened.mount();
  reopened.input(0, 'Corrected Name'); reopened.input(1, '13800138000'); reopened.result = h.result; await reopened.submit();
  assert.equal(reopened.writes[0][2], h.writes[0][2], 'page reopen must preserve unresolved retry key');
  h.readResult = async () => ({ success: true, data: { state: 'rejected', application: { ...rejected.application, applicationId: 'rejected-2' } } });
  await h.submit(); assert.notEqual(h.writes[2][2], h.writes[1][2], 'a later rejection starts another attempt');

  const accepted = harness(); await accepted.mount(); accepted.input(0, 'Test'); accepted.input(1, '13800138000'); accepted.result = h.result;
  await accepted.submit();
  accepted.readResult = async () => ({ success: true, data: { state: 'submitted', application: { applicationId: 'accepted-1', status: 'submitted' } } });
  accepted.input(0, 'Edited after timeout'); await accepted.submit();
  assert.equal(accepted.writes.length, 1, 'accepted-but-lost response cannot create a duplicate with changed inputs');
  assert.equal(byClass(accepted.render(), 'state-submitted').length, 1);

  const changedRole = harness(); await changedRole.mount(); changedRole.input(0, 'Test'); changedRole.input(1, '13800138000'); changedRole.result = h.result;
  await changedRole.submit(); changedRole.pick(0, 1); changedRole.input(0, 'Changed'); await changedRole.submit();
  assert.equal(changedRole.writes[1][2], changedRole.writes[0][2], 'changing role cannot bypass ambiguous-attempt deduplication');

  const deniedRead = harness(); await deniedRead.mount(); deniedRead.input(0, 'Test'); deniedRead.input(1, '13800138000');
  deniedRead.readResult = async () => ({ success: false, error: 'offline' }); await deniedRead.submit();
  assert.equal(deniedRead.writes.length, 0, 'unavailable authoritative state must not start another attempt');

  const approved = harness(); await approved.mount(); approved.input(0, 'Test'); approved.input(1, '13800138000');
  approved.readResult = async () => ({ success: true, data: { state: 'approved', application: { applicationId: 'approved-1' } } });
  await approved.submit(); assert.equal(approved.writes.length, 0); assert.equal(byClass(approved.render(), 'state-approved').length, 1);

  for (const recoveryFails of [false, true]) {
    const conflict = harness(); await conflict.mount(); conflict.input(0, 'Test'); conflict.input(1, '13800138000');
    conflict.result = async () => {
      conflict.readResult = async () => recoveryFails ? { success: false } : { success: true, data: { state: 'submitted', application: { applicationId: 'race-1' } } };
      return { success: false, code: 'CLOUD_ROLE_APPLICATION_IDEMPOTENCY_CONFLICT' };
    };
    await conflict.submit(); assert.equal(conflict.writes.length, 1, 'conflict must not auto-repost');
    assert.equal(byClass(conflict.render(), recoveryFails ? 'state-network_error' : 'state-submitted').length, 1);
  }

  const concurrent = harness(); await concurrent.mount(); concurrent.input(0, 'Test'); concurrent.input(1, '13800138000');
  let resolveRead; concurrent.readResult = () => new Promise(resolve => { resolveRead = resolve; });
  const click = byClass(concurrent.render(), 'primary-action')[0].props.onClick;
  click(); click(); await tick(); assert.equal(concurrent.reads, 2, 'initial read and one preflight only');
  concurrent.hide(); concurrent.show();
  concurrent.readResult = async () => ({ success: true, data: { state: 'not_submitted' } });
  resolveRead({ success: true, data: { state: 'not_submitted' } }); await tick(); await tick();
  assert.equal(concurrent.writes.length, 0); assert.equal(byClass(concurrent.render(), 'application-form').length, 1);

  for (const reason of ['account', 'unmount', 'hide']) {
    const stale = harness(); await stale.mount(); stale.input(0, 'Test'); stale.input(1, '13800138000');
    let finish; stale.readResult = () => new Promise(resolve => { finish = resolve; });
    await stale.submit();
    if (reason === 'account') stale.epoch++; else if (reason === 'hide') stale.hide(); else stale.cleanups.forEach(fn => fn?.());
    finish({ success: true, data: { state: 'not_submitted' } }); await tick();
    assert.equal(stale.writes.length, 0, reason); assert.equal(stale.toasts.length, 0, reason);
    if (reason === 'hide') {
      stale.readResult = async () => ({ success: true, data: { state: 'not_submitted' } });
      stale.show(); await tick();
      assert.equal(byClass(stale.render(), 'application-form').length, 1, 'return after hidden request must recover from submitting state');
    }
  }
  for (const reason of ['account', 'unmount', 'hide']) {
    const latePost = harness(); await latePost.mount(); latePost.input(0, 'Test'); latePost.input(1, '13800138000');
    let resolvePost; latePost.result = () => new Promise(resolve => { resolvePost = resolve; });
    await latePost.submit(); assert.equal(latePost.writes.length, 1);
    if (reason === 'account') latePost.epoch++; else if (reason === 'hide') latePost.hide(); else latePost.cleanups.forEach(fn => fn?.());
    resolvePost({ success: true, data: { state: 'submitted' } }); await tick();
    assert.equal(latePost.toasts.length, 0, reason);
    assert.equal(byClass(latePost.render(), 'state-submitted').length, 0, reason);
  }
  console.log('application rejected/corrected/ambiguous/reopened and stale-session retry tests passed');
}
(async () => {
  const invalid = harness(); await invalid.mount(); await invalid.submit();
  assert.equal(invalid.toasts.at(-1).title, '请填写姓名'); assert.equal(invalid.writes.length, 0);
  invalid.input(0, 'Test Student'); invalid.input(1, '12345'); await invalid.submit();
  assert.equal(invalid.toasts.at(-1).title, '请输入正确的11位手机号'); assert.equal(invalid.writes.length, 0);
  assert.equal(byClass(invalid.render(), 'application-form').length, 1, 'invalid inputs remain editable');
  for (const [role, roleIndex, modeIndex] of [['student',0,0],['student',0,1],['teacher',1,0],['teacher',1,1],['family_member',2,0]]) {
    const h = harness(); await h.mount(); h.pick(0, roleIndex);
    if (role !== 'family_member') h.pick(1, modeIndex);
    h.input(0, ' Test Student '); h.input(1, '138 0013-8000'); await h.submit();
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0][1], { requestedIdentity: role, profileMode: modeIndex ? 'new' : 'existing', profileName: 'Test Student', profilePhone: '13800138000' });
    assert.match(h.writes[0][2], new RegExp(`^miniapp-role-v-${role}-${modeIndex ? 'new' : 'existing'}-`));
  }
  for (const failure of [async () => ({ success: false, error: 'INTERNAL_SERVER_ERROR trace=private' }), async () => { throw new Error('request:fail socket hang up'); }]) {
    const h = harness(); await h.mount(); h.result = failure; h.input(0, 'Test'); h.input(1, '13800138000'); await h.submit();
    assert.equal(h.toasts.at(-1).title, '暂时无法提交申请，请稍后重试');
    assert.equal(byClass(h.render(), 'application-form').length, 1);
    assert.equal(byClass(h.render(), 'state-submit_error').length, 1, 'service failure must not blame valid name/phone inputs');
    assert.equal(byClass(h.render(), 'state-invalid').length, 0);
  }
  // UTF-8: Known service errors retain actionable copy without arbitrary server text.
  const mismatch = harness(); await mismatch.mount();
  mismatch.result = async () => ({ success: false, code: 'CLOUD_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED', error: 'internal phone mismatch detail' });
  mismatch.input(0, 'Test'); mismatch.input(1, '13800138000'); await mismatch.submit();
  assert.equal(mismatch.toasts.at(-1).title, '填写的手机号与当前账号已验证手机号不一致');
  assert.equal(runtime.applicationErrorMessage({code:'constructor',message:'private'}), '暂时无法提交申请，请稍后重试');
  console.log('application page localized validation, no invalid writes, all role payloads and safe error tests passed');
  await resubmissionTests();
})().catch(error => { console.error(error); process.exitCode = 1; });
