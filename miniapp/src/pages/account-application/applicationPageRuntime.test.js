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
function harness() {
  const state = [], effects = [], storage = new Map(); let cursor = 0;
  const h = { toasts: [], reads: 0, writes: [], routes: [] };
  const user = { id: 'v', role: 'visitor', user_type: 'visitor', identity_kind: 'visitor', account_state: 'visitor', token_use: 'miniapp-visitor', authority_id: 'cloud:v', capabilities: [...experience.VISITOR_CAPABILITIES] };
  storage.set('user_info', user); storage.set('auth_token', 'fixture-token');
  h.result = async () => ({ success: true, data: { state: 'submitted' } });
  const slot = initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return i; };
  const jsx = (type, props) => ({ type, props: props || {} });
  const deps = {
    react: { useState: initial => { const i = slot(initial); return [state[i], next => { state[i] = next; }]; }, useRef: initial => state[slot({ current: initial })], useEffect: fn => { if (!h.mounted) effects.push(fn); } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@tarojs/components': Object.fromEntries(['Button','Input','Picker','Text','View'].map(x => [x,x])),
    '@tarojs/taro': { default: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), showToast: value => h.toasts.push(value), reLaunch: value => h.routes.push(value) } },
    '../../utils/accountExperience': experience,
    '../../utils/api': { miniappCloudBusinessApi: { readRoleApplication: async () => { h.reads++; return { success: true, data: { state: 'not_submitted' } }; }, submitRoleApplication: (...args) => { h.writes.push(args); return h.result(); } } },
    './applicationRuntime': runtime, './index.scss': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, module, module.exports);
  h.render = () => { cursor = 0; return module.exports.default(); };
  h.mount = async () => { h.render(); h.mounted = true; effects.forEach(fn => fn()); await tick(); };
  h.input = (index, value) => nodes(h.render()).filter(n => n.type === 'Input')[index].props.onInput({ detail: { value } });
  h.pick = (index, value) => nodes(h.render()).filter(n => n.type === 'Picker')[index].props.onChange({ detail: { value } });
  h.submit = async () => { byClass(h.render(), 'primary-action')[0].props.onClick(); await tick(); };
  return h;
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
  }
  // UTF-8: Known service errors retain actionable copy without arbitrary server text.
  const mismatch = harness(); await mismatch.mount();
  mismatch.result = async () => ({ success: false, code: 'CLOUD_ROLE_APPLICATION_VERIFIED_PHONE_REQUIRED', error: 'internal phone mismatch detail' });
  mismatch.input(0, 'Test'); mismatch.input(1, '13800138000'); await mismatch.submit();
  assert.equal(mismatch.toasts.at(-1).title, '填写的手机号与当前账号已验证手机号不一致');
  assert.equal(runtime.applicationErrorMessage({code:'constructor',message:'private'}), '暂时无法提交申请，请稍后重试');
  console.log('application page localized validation, no invalid writes, all role payloads and safe error tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
