// Exercise the mounted gate: stale presence must lead to fresh login, not repeated failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

(async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const errorModule = await import('../services/desktopIdentityError.mjs');
  const runtimeModule = await import('../services/desktopIdentityGateRuntime.mjs');
  const identityModule = await import('../services/desktopIdentityClient.mjs');
  const partitionModule = await import('../services/desktopIdentityPartition.mjs');
  let now = 0, authenticatedAt = 0, account = 'original', failure = '', switches = [], locks = 0, verificationSequence = 0;
  const runtime = (userId = account, activeRole = 'teacher') => ({
    token: userId + '-token', session: { userId, activeRole, eligibleRoles: ['teacher', 'super_admin'] },
    profile: { user: { name: userId } },
    gateState: { kind: 'online-unlocked', userId, activeRole, eligibleRoles: ['teacher', 'super_admin'], partitionKey: userId + ':' + activeRole },
  });
  let current = runtime();
  let resolveOldEnsure;
  const client = {
    status: async () => ({ state: 'unlocked' }), resume: async () => current,
    ensureOnlineSession: () => new Promise(resolve => { resolveOldEnsure = resolve; }),
    lock: async () => { locks++; },
    switchRole: async ({ currentSession, activeRole }) => {
      switches.push({ userId: currentSession.session.userId, activeRole });
      if (now - authenticatedAt > 120000) throw new Error("Error invoking remote method 'sign': Error: DESKTOP_IDENTITY_RECENT_UNLOCK_REQUIRED");
      if (failure === 'rotated') throw Object.assign(new Error('LOCAL_SAVE_FAILED'), { cloudRoleSessionRotated: true });
      if (failure === 'uncertain') throw Object.assign(new Error('Failed to fetch'), { cloudRoleSessionUncertain: true });
      current = runtime(currentSession.session.userId, activeRole);
      return current;
    },
    beginPasswordVerification: async () => {
      if (failure === 'password') throw new Error('DESKTOP_IDENTITY_VAULT_UNLOCK_FAILED');
      if (failure === 'network') throw new Error('Failed to fetch');
      return { status: 'verified', verificationToken: 'fresh-' + ++verificationSequence, desktopAccess: { access: failure === 'visitor' ? 'teacher_registration_required' : 'allowed' } };
    },
    beginUnifiedOnlineRegistration: async () => ({ status: 'awaiting_online_verification', pairingId: 'qr' }),
    pollUnifiedOnlineRegistration: async () => ({ status: 'verified', verificationToken: 'qr-fresh-' + now, desktopAccess: { access: 'allowed' } }),
    completeUnifiedOnlineRegistration: async () => { authenticatedAt = now; current = runtime(); return current; },
  };
  window.desktopIdentity = {};
  window.dbService = { prepareIdentityPartitionChange() {}, switchIdentityPartition() {} };
  const buttons = new Map();
  const block = tag => props => React.createElement(tag, null, props.children);
  const Input = props => React.createElement('input', { value: props.value, onChange: props.onChange });
  Input.Password = Input;
  const deps = {
    react: React,
    antd: {
      Alert: props => React.createElement('div', { role: 'alert' }, props.message, props.description),
      Button: props => { buttons.set(props.children, props); return React.createElement('button', { onClick: props.onClick, disabled: props.loading || props.disabled, type: props.htmlType }, props.children); },
      Card: block('section'), Divider: block('div'), Input, Select: () => null, Space: block('div'), Spin: block('div'), Tag: block('span'),
      Typography: { Paragraph: block('p'), Text: block('span'), Title: block('h1') },
    },
    '@ant-design/icons': new Proxy({}, { get: () => () => null }),
    '../services/runtimeConfigClient': { getRuntimeConfig: async () => ({}) },
    '../services/managedSyncConfig.mjs': { resolveDesktopIdentityBaseUrl: () => 'https://cloud.test' },
    '../services/desktopIdentityError.mjs': errorModule,
    '../services/desktopIdentityClient.mjs': { ...identityModule, createDesktopIdentityClient: () => client, resolveDesktopGateState: () => current.gateState },
    '../services/desktopIdentityPartition.mjs': partitionModule,
    '../services/desktopIdentityGateRuntime.mjs': runtimeModule,
    '../services/desktopLoginMemory.mjs': { loadRememberedLogin: () => ({ type: 'account_name', value: 'original' }), saveRememberedLogin() {}, maskPhone: x => x },
    './DesktopIdentityGate.css': {}, './DesktopAutoSync': () => null,
    '../App': () => React.createElement('div', { id: 'business' }, 'business'),
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'DesktopIdentityGate.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { assert(name in deps, name); return deps[name]; }, loaded, loaded.exports);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const root = createRoot(document.getElementById('root'));
  const click = async text => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === text);
    assert(button, 'missing button: ' + text);
    await act(async () => { button.click(); await flush(); await flush(); });
  };
  try {
    await act(async () => { root.render(React.createElement(loaded.exports.default)); await flush(); await flush(); });
    now = 120001;
    const roleAction = buttons.get('切换为超级管理员').onClick;
    await act(async () => { roleAction(); roleAction(); await flush(); });
    assert.match(document.body.textContent, /重新验证.*超级管理员/, 'after two minutes the role switch must open an actionable authentication flow');
    assert.equal(switches.length, 1, 'repeated clicks must not duplicate the expired switch');
    assert.equal(document.querySelector('#business'), null, 'business runtime must be suspended during authentication');
    assert(buttons.has('密码登录') && buttons.has('微信扫码登录'));
    failure = 'password';
    await click('密码登录');
    assert.match(document.body.textContent, /账号或密码不正确/);
    assert.equal(switches.length, 1);
    failure = 'network';
    await click('密码登录');
    assert.equal(switches.length, 1);
    failure = '';
    await click('密码登录');
    assert.deepEqual(switches, [{ userId: 'original', activeRole: 'super_admin' }, { userId: 'original', activeRole: 'super_admin' }]);
    assert.match(document.body.textContent, /超级管理员/);
    assert(document.querySelector('#business'));
    await click('切换为老师');
    now += 120001;
    await click('切换为超级管理员');
    failure = 'visitor';
    await click('密码登录');
    assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === '完成并进入'), false,
      'reauthentication must not enroll a different account as a teacher');
    await click('返回密码登录');
    failure = '';
    account = 'other';
    const beforeMismatch = switches.length;
    await click('密码登录');
    assert.equal(switches.length, beforeMismatch, 'another verified account must never inherit the original elevation intent');
    assert.match(document.body.textContent, /同一账号/);
    assert.equal(document.querySelector('#business'), null);
    await click('取消身份切换');
    await click('密码登录');
    assert.equal(switches.length, beforeMismatch, 'cancellation must discard the elevation intent');
    assert(document.querySelector('#business'));
    now += 120001;
    await click('切换为超级管理员');
    await click('微信扫码登录');
    await click('刷新登录状态');
    assert.equal(switches.at(-1).userId, 'other');
    assert.equal(current.session.activeRole, 'super_admin', 'fresh WeChat authentication must finish the same intended switch');
    failure = 'rotated';
    await click('切换为老师');
    assert.equal(document.querySelector('#business'), null, 'a rotated cloud session cannot restore its revoked predecessor');
    assert.match(document.body.textContent, /密码登录/);
    failure = '';
    await click('密码登录');
    failure = 'uncertain';
    await click('切换为超级管理员');
    assert.equal(document.querySelector('#business'), null, 'a lost role-exchange response cannot restore an uncertain predecessor');
    assert.match(document.body.textContent, /密码登录/);
    assert(locks >= 4);
    failure = '';
    await click('密码登录');
    const oldRuntime = current;
    const oldEnsure = window.desktopIdentitySessionProvider.ensureOnline().catch(error => error);
    now += 120001;
    await click('切换为超级管理员');
    await click('取消身份切换');
    await act(async () => { resolveOldEnsure(oldRuntime); await oldEnsure; await flush(); });
    assert.equal(document.querySelector('#business'), null,
      'an ensureOnline request started before recovery must not reopen business after cancellation');
    assert.match(document.body.textContent, /密码登录/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
  console.log('desktop role switch authentication recovery UI checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
