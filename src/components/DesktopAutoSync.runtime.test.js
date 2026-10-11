'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), React = require('react'), { JSDOM } = require('jsdom');
const { act } = React;
(async () => {
  await import('../services/desktopSyncController.test.mjs');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  global.window = dom.window; global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const intervals = new Set(), calls = [], relays = []; let modal, panel;
  let onlineSessionAvailable = false, cloudUnavailable = true, networkAvailable = false, renewals = 0;
  window.desktopIdentitySessionProvider = { ensureOnline: async () => {
    renewals += 1;
    if (!networkAvailable) throw new TypeError('Failed to fetch');
    onlineSessionAvailable = true; cloudUnavailable = false;
  } };
  window.setInterval = fn => { intervals.add(fn); return fn; }; window.clearInterval = fn => intervals.delete(fn);
  const draft = (id, createdOffline) => ({ id, type: 'student.update.v1', status: 'awaiting_confirmation', createdOffline, payload: { id, changes: { name: id } } });
  let items = [draft('offline-one', true), draft('offline-two', true), { ...draft('history', false), status: 'completed' }];
  window.desktopAuthority = { list: async () => structuredClone(items), confirmBatch: async snapshots => { for (const snapshot of snapshots) { const item = items.find(row => row.id === snapshot.id); if (item) item.status = 'confirmed'; } }, confirmAndSubmit: async id => {
    calls.push(id); items.find(row => row.id === id).status = 'completed'; return { receipt: { status: 'committed' } };
  } };
  window.dbService = { data: {}, refreshAuthorityProjection: async options => assert.equal(options.businessOnly, true) };
  const deps = {
    react: React,
    antd: { Modal: props => { modal = props; return props.open ? React.createElement('div', { role: 'dialog' }, props.children, props.footer) : null; }, Button: props => React.createElement('button', { onClick: props.onClick, disabled: props.disabled }, props.children) },
    '../services/desktopAutoSync.mjs': { sessionTokenFromStore: () => {
      if (!onlineSessionAvailable) throw new Error('DESKTOP_CLOUD_SESSION_REQUIRED');
      return 'ephemeral-token';
    }, planDesktopAutoSync: (await import('../services/desktopAutoSync.mjs')).planDesktopAutoSync },
    '../services/desktopIdentityClient.mjs': { desktopCloudTransportUnavailable: () => cloudUnavailable },
    '../services/desktopSyncController.mjs': await import('../services/desktopSyncController.mjs'),
    '../services/desktopSyncReview.mjs': await import('../services/desktopSyncReview.mjs'),
    '../services/desktopQuestionAssetRelay': { hasPendingQuestionAssetVerification: () => false, refreshQuestionAssetVerification: async () => {}, relayQuestionAssetsAfterReceipt: async item => relays.push(item.id) },
    './AuthorityOutboxPanel': { PendingChangesPanel: props => { panel = props; return null; } }, './sync/DesktopSync.css': {},
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'DesktopAutoSync.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', compiled)(name => {
    assert(name in deps, name); return deps[name];
  }, loaded, loaded.exports);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const tick = async () => act(async () => { for (const fn of intervals) fn(); await flush(); });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => { root.render(React.createElement(loaded.exports.default)); await flush(); });
    assert.equal(navigator.onLine, true, 'virtual adapters keep the OS online signal true');
    assert.equal(document.querySelectorAll('[role=dialog]').length, 0, 'physical offline cold start must not demand approval before the cloud session is renewed');
    assert(renewals > 0, 'missing online context must attempt the existing verified-session renewal');
    assert.deepEqual(calls, []);
    networkAvailable = true;
    await tick();
    assert.equal(document.querySelectorAll('[role=dialog]').length, 1); assert.deepEqual(calls, []);
    assert.deepEqual(panel.state.items.map(x => x.id), ['offline-one', 'offline-two']);
    await tick(); await tick(); assert.equal(document.querySelectorAll('[role=dialog]').length, 1);
    await act(async () => { await modal.footer.find(x => x?.key === 'confirm').props.onClick(); await flush(); });
    assert.deepEqual(calls, ['offline-one', 'offline-two']); assert.equal(modal.open, false);
    assert.deepEqual(relays, calls);
    items.push(draft('online', false));
    await act(async () => { window.dispatchEvent(new window.Event('desktop-authority-drafts-changed')); await flush(); });
    assert.equal(calls.at(-1), 'online', 'saving an online draft wakes silent submission immediately');
    assert.equal(modal.open, false);
    items.push({ ...draft('confirmed-online', false), status: 'confirmed' });
    window.desktopAuthority.submit = async () => { throw new Error('CLOUD_BUSINESS_UNAVAILABLE'); };
    await tick();
    assert.equal(modal.open, false, 'an online retry failure stays silent');
    await act(async () => { window.dispatchEvent(new window.Event('desktop-sync-open')); await flush(); });
    assert.equal(modal.open, true);
    assert(!modal.footer.some(x => x?.key === 'confirm'), 'already confirmed drafts never demand confirmation again');
    items.find(x => x.id === 'confirmed-online').status = 'completed';
    await act(async () => { modal.onCancel(); await flush(); });
    await act(async () => { window.dispatchEvent(new window.Event('desktop-sync-open')); await flush(); });
    assert.equal(modal.open, true); assert.equal(panel.state.items.length, 0);
    await act(async () => root.unmount()); assert.equal(intervals.size, 0);
    items.push(draft('old-account', false));
    window.dispatchEvent(new window.Event('desktop-authority-drafts-changed')); await flush();
    assert.equal(calls.includes('old-account'), false);
  } finally { dom.window.close(); }
  console.log('actual desktop sync dialog, event, aggregate confirmation and identity cleanup checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
