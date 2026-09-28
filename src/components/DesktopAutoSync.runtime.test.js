'use strict';
// UTF-8: execute the shipped React effect with controlled time and real sync helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

async function main() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const helpers = await import('../services/desktopAutoSync.mjs');
  const intervals = new Set();
  window.setInterval = callback => { intervals.add(callback); return callback; };
  window.clearInterval = callback => intervals.delete(callback);
  const modals = [], calls = [];
  let current = ['one', 'two'].map(id => ({ id, type: 'student.update.v1', createdOffline: true,
    status: 'awaiting_confirmation', payload: { id, changes: { name: id } } }));
  window.desktopAuthority = {
    list: async () => structuredClone(current),
    confirmAndSubmit: async id => {
      calls.push(id);
      current.find(item => item.id === id).status = 'completed';
      return { receipt: { status: 'committed' } };
    },
  };
  window.dbService = { refreshAuthorityProjection: async () => {} };
  const loaded = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, 'DesktopAutoSync.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react') return React;
    if (name === 'antd') return { Modal: { confirm(config) {
      const modal = { ...config, destroyed: false, destroy() { this.destroyed = true; } };
      modals.push(modal); return modal;
    } }, message: { error() {}, success() {} } };
    if (name === '../services/desktopAutoSync.mjs') return { ...helpers, sessionTokenFromStore: () => 'test-session' };
    throw Error('Unexpected dependency: ' + name);
  }, loaded, loaded.exports);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const tick = async () => act(async () => { for (const callback of intervals) callback(); await flush(); });
  const root = createRoot(document.getElementById('root'));
  let activeRoot = root;
  try {
    await act(async () => { root.render(React.createElement(loaded.exports.default)); await flush(); });
    assert.equal(modals.length, 1);
    assert.equal(calls.length, 0, 'reconnection must not submit offline drafts');
    await tick(); await tick();
    assert.equal(modals.length, 1, 'waiting for one decision must not stack a new modal every four seconds');
    const originalSubmit = window.desktopAuthority.confirmAndSubmit;
    let releaseFirst;
    window.desktopAuthority.confirmAndSubmit = async id => {
      if (id === 'one') await new Promise(resolve => { releaseFirst = resolve; });
      return originalSubmit(id);
    };
    let submission;
    await act(async () => { submission = modals[0].onOk(); await flush(); });
    await tick(); await tick();
    assert.equal(modals.length, 1, 'an in-flight batch cannot open another confirmation');
    await act(async () => { await modals[0].onOk(); await flush(); });
    await act(async () => { releaseFirst(); await submission; await flush(); });
    assert.deepEqual(calls, ['one', 'two'], 'one aggregate confirmation submits both drafts exactly once');
    await tick();
    assert.equal(modals.length, 1);
    current = [{ id: 'three', type: 'student.update.v1', createdOffline: true,
      status: 'awaiting_confirmation', payload: { id: 'three', changes: { name: 'three' } } }];
    await tick();
    assert.equal(modals.length, 2);
    await act(async () => { modals[1].onCancel(); await flush(); });
    await tick(); await tick();
    assert.equal(modals.length, 2, 'postponed unchanged batch stays local without repeated prompts');
    assert.deepEqual(calls, ['one', 'two']);
    current.push({ id: 'four', type: 'student.update.v1', createdOffline: true,
      status: 'awaiting_confirmation', payload: { id: 'four', changes: { name: 'four' } } });
    await tick();
    assert.equal(modals.length, 3);
    await act(async () => { root.unmount(); await flush(); });
    assert.equal(modals[2].destroyed, true, 'leaving the account must close its pending decision');
    await act(async () => { await modals[2].onOk(); await flush(); });
    assert.deepEqual(calls, ['one', 'two'], 'a stale modal cannot submit after account unmount');
    let releaseRead;
    window.desktopAuthority.list = () => new Promise(resolve => { releaseRead = resolve; });
    const secondRoot = createRoot(document.getElementById('root'));
    activeRoot = secondRoot;
    await act(async () => { secondRoot.render(React.createElement(loaded.exports.default)); await flush(); });
    await act(async () => { secondRoot.unmount(); await flush(); });
    await act(async () => { releaseRead(structuredClone(current)); await flush(); });
    assert.equal(modals.length, 3, 'a late outbox read cannot open a dialog for an unmounted account');
    current = ['retry-one', 'retry-two'].map(id => ({ id, type: 'student.update.v1',
      status: 'submitted', payload: { id, changes: { name: id } } }));
    const retries = [];
    window.desktopAuthority.list = async () => structuredClone(current);
    window.desktopAuthority.submit = async id => {
      retries.push(id);
      current.find(item => item.id === id).status = 'conflict';
      return { receipt: { status: 'rejected' } };
    };
    activeRoot = createRoot(document.getElementById('root'));
    await act(async () => { activeRoot.render(React.createElement(loaded.exports.default)); await flush(); });
    assert.deepEqual(retries, ['retry-one'], 'a rejected retry pauses before submitting later confirmed drafts');
    await tick();
    assert.deepEqual(retries, ['retry-one']);
  } finally {
    if (intervals.size) await act(async () => activeRoot.unmount());
    dom.window.close();
  }
  console.log('desktop auto sync actual-component confirmation lifecycle checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
