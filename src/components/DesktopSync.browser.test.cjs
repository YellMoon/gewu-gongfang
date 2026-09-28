'use strict';
// Render the shipped dialog and Ant Design controls; only the native transport is controlled.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'output/desktop-sync-20260929');
fs.mkdirSync(out, { recursive: true });
const files = ['src/components/DesktopAutoSync.tsx', 'src/components/AuthorityOutboxPanel.tsx',
  'src/components/authorityDraftPresentation.js', 'src/services/desktopSyncController.mjs',
  'src/services/desktopSyncReview.mjs', 'src/services/desktopAutoSync.mjs', 'src/services/authorityDraftDependencies.mjs'];
const codes = Object.fromEntries(files.map(file => [file, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText]));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="zh-CN"><head><meta charset="UTF-8"></head><body><button id="sync">云同步</button><div id="root"></div></body></html>');
    for (const file of ['react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js', 'dayjs/dayjs.min.js', 'antd/dist/antd.min.js'])
      await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
    await page.addStyleTag({ path: path.join(root, 'src/components/sync/DesktopSync.css') });
    await page.evaluate(codes => {
      window.calls = []; window.rows = [];
      window.desktopAuthority = {
        list: async () => structuredClone(window.rows),
        confirmAndSubmit: async id => { window.calls.push(id); window.rows.find(x => x.id === id).status = 'completed'; return { receipt: { status: 'committed' } }; },
        removeDraft: async id => { window.rows = window.rows.filter(x => x.id !== id); },
      };
      window.dbService = { data: {}, refreshAuthorityProjection: async () => window.dispatchEvent(new Event('authority-projection-refreshed')) };
      const loaded = {};
      function resolve(from, name) {
        const segments = from.split('/'); segments.pop();
        for (const part of name.split('/')) { if (part === '..') segments.pop(); else if (part !== '.') segments.push(part); }
        let file = segments.join('/');
        if (codes[file]) return file;
        return ['.tsx', '.js', '.mjs'].map(ext => file + ext).find(candidate => codes[candidate]) || file;
      }
      function load(file) {
        if (loaded[file]) return loaded[file].exports;
        if (file.endsWith('.css')) return {};
        if (file.endsWith('desktopAuthorizationSession.mjs')) return { readDesktopAuthorizationSession: () => ({ authorization: 'Bearer fixture-session' }) };
        if (file.endsWith('desktopQuestionAssetRelay')) return { hasPendingQuestionAssetVerification: () => false, refreshQuestionAssetVerification: async () => {}, relayQuestionAssetsAfterReceipt: async () => {} };
        const module = { exports: {} }; loaded[file] = module;
        if (!codes[file]) throw Error('Unexpected module ' + file);
        new Function('require', 'module', 'exports', codes[file])(name => name === 'react' ? window.React : name === 'antd' ? window.antd : load(resolve(file, name)), module, module.exports);
        return module.exports;
      }
      const Component = load('src/components/DesktopAutoSync.tsx').default;
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(Component));
      document.getElementById('sync').onclick = () => window.dispatchEvent(new Event('desktop-sync-open'));
      window.addDraft = (id, offline) => {
        window.rows.push({ id, type: 'course.update.v1', createdOffline: offline, status: 'awaiting_confirmation',
          payload: { id, changes: { name: offline ? '物理提高课 · 蓝海国际' : '联网修改', room_name: '蓝海国际', active: true, default_duration_minutes: 90 } } });
        window.dispatchEvent(new Event('desktop-authority-drafts-changed'));
      };
    }, codes);
    await page.waitForTimeout(80);
    await page.evaluate(() => window.addDraft('online', false));
    await page.waitForFunction(() => window.calls.includes('online'));
    assert.equal(await page.getByRole('dialog').count(), 0, 'online edits submit without a dialog');
    await page.evaluate(() => { window.addDraft('offline-a', true); window.addDraft('offline-b', true); });
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await page.getByRole('listitem').count(), 2);
    assert.deepEqual(await page.evaluate(() => window.calls), ['online']);
    await page.getByText('查看更改内容', { exact: true }).first().click();
    await page.screenshot({ path: path.join(out, 'wide-pending.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.screenshot({ path: path.join(out, 'narrow-pending.png'), fullPage: true });
    const bounds = await page.getByRole('dialog').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'narrow modal must fit the viewport');
    const confirm = page.getByRole('button', { name: /确认并批量提交/ });
    await confirm.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.calls), ['online', 'offline-a', 'offline-b']);
    await page.locator('#sync').click();
    await page.getByText('当前没有待同步的更改', { exact: true }).waitFor();
    assert.equal(await page.getByRole('listitem').count(), 0);
    await page.screenshot({ path: path.join(out, 'empty-after-submit.png'), fullPage: true });
    await page.getByRole('button', { name: /^关\s*闭$/ }).last().focus();
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ verified: true, transport: 'controlled native bridge', actualComponents: files, screenshots: ['wide-pending.png', 'narrow-pending.png', 'empty-after-submit.png'], keyboard: ['Enter batch confirmation', 'Escape close'], pageErrors: errors }, null, 2));
    console.log('actual Ant Design sync window wide/narrow, keyboard, silent online and aggregate offline checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
