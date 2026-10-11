'use strict';
// Render the shipped dialog and Ant Design controls; only the native transport is controlled.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript'), { chromium } = require('playwright');
const { code: calendarCode } = require('../pages/ScheduleCalendar.local-date.test.js');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'output/desktop-sync-recovery-20260929');
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' });
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
        confirmBatch: async snapshots => { for (const snapshot of snapshots) { const item = window.rows.find(row => row.id === snapshot.id); if (item) item.status = 'confirmed'; } }, confirmAndSubmit: async id => { window.calls.push(id); window.rows.find(x => x.id === id).status = 'completed'; return { receipt: { status: 'committed' } }; },
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
        if (file.endsWith('desktopIdentityClient.mjs')) return { desktopCloudTransportUnavailable: () => false };
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
    await page.evaluate(() => {
      window.failOnline = true;
      const original = window.desktopAuthority.confirmAndSubmit;
      window.desktopAuthority.confirmAndSubmit = async id => {
        if (window.failOnline && id === 'retry-online') {
          window.rows.find(x => x.id === id).status = 'confirmed';
          throw new Error('CLOUD_BUSINESS_UNAVAILABLE');
        }
        return original(id);
      };
      window.desktopAuthority.submit = id => window.desktopAuthority.confirmAndSubmit(id);
      window.addDraft('retry-online', false);
    });
    await page.waitForFunction(() => window.rows.some(x => x.id === 'retry-online' && x.status === 'confirmed'));
    await page.waitForTimeout(120);
    assert.equal(await page.getByRole('dialog').count(), 0, 'online failures remain silent');
    await page.locator('#sync').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('listitem').waitFor();
    await page.waitForTimeout(350); // Let Ant Design's opening animation finish before capturing pixels.
    assert.equal(await page.getByRole('button', { name: /\u786e\u8ba4\u5e76\u6279\u91cf\u63d0\u4ea4/ }).count(), 0);
    await page.screenshot({ path: path.join(out, 'confirmed-online-no-repeat-confirm.png'), fullPage: true });
    await page.evaluate(() => { window.failOnline = false; });
    await page.getByRole('button', { name: /^\u5237\s*\u65b0$/ }).click();
    await page.waitForFunction(() => window.rows.find(x => x.id === 'retry-online').status === 'completed');
    await page.getByRole('button', { name: /^\u5173\s*\u95ed$/ }).last().click();
    await page.evaluate(() => { window.calls = window.calls.filter(x => x !== 'retry-online'); });
    await page.evaluate(() => { window.addDraft('offline-a', true); window.addDraft('offline-b', true); });
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('[role=listitem]').length === 2);
    assert.equal(await page.getByRole('listitem').count(), 2);
    assert.deepEqual(await page.evaluate(() => window.calls), ['online']);
    await page.getByText('查看更改内容', { exact: true }).first().click();
    await page.screenshot({ path: path.join(out, 'wide-pending.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 760 });
    await page.waitForFunction(() => {
      const r = document.querySelector('[role=dialog]')?.getBoundingClientRect();
      return r && r.x >= 0 && r.right <= 391;
    });
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
    // A legacy failed submission has no corresponding course in the live table.
    await page.evaluate(() => {
      window.desktopAuthority.submit = async () => { throw new Error('CLOUD_BUSINESS_DRAFT_EXPECTED_VERSION_REQUIRED'); };
      window.rows.push({ id: 'old-failed', type: 'course.update.v1', status: 'submitted',
        payload: { id: 'absent-course', changes: { name: '已不在课程表的旧更改' } } });
    });
    await page.locator('#sync').click();
    const discard = page.getByRole('button', { name: '放弃这条更改', exact: true });
    await discard.waitFor({ timeout: 3000 });
    await discard.click();
    await page.getByRole('button', { name: '继续保留', exact: true }).click();
    await page.getByText('放弃这条本地更改？', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('listitem').count(), 1, 'cancel preserves the pending change');
    await page.screenshot({ path: path.join(out, 'legacy-failed-discard.png'), fullPage: true });
    await discard.click();
    await page.getByRole('button', { name: '放弃更改', exact: true }).click();
    await page.getByText('当前没有待同步的更改', { exact: true }).waitFor();
    assert(!await page.evaluate(() => window.rows.some(row => row.id === 'old-failed')));
    await page.getByRole('button', { name: /^关\s*闭$/ }).last().click();
    await page.locator('#sync').click();
    await page.getByText('当前没有待同步的更改', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'discarded-reopen-empty.png'), fullPage: true });
    await page.getByRole('button', { name: /^关\s*闭$/ }).last().click();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(code => {
      const env = { React: window.React, ...window.React, dayjs: window.dayjs, Dropdown: window.antd.Dropdown,
        holidays2026: [], ScheduleStatus: { PLANNED: 1, CANCELLED: 3, LEAVE: 4 },
        DEFAULT_COURSE_COLOR: '#1890ff', getTextColorForBackground: () => '#fff', resolveCalendarRoomDisplay: () => '华发天荟' };
      const Week = new Function(...Object.keys(env), code)(...Object.values(env));
      const container = document.createElement('div'); container.id = 'calendar'; document.body.appendChild(container);
      window.ReactDOM.createRoot(container).render(window.React.createElement(Week, {
        startMonday: window.dayjs('2026-09-28'), weekLabel: '本周', courses: [], rooms: [], schedules: [
          { id: 'monday-early', course_id: 'a', course_name: '周一早课', status: 1, start_time: '2026-09-27T23:00:00Z', end_time: '2026-09-28T01:00:00Z' },
          { id: 'tuesday-early', course_id: 'b', course_name: '周二早课', status: 1, start_time: '2026-09-28T23:30:00Z', end_time: '2026-09-29T01:30:00Z' }
        ]
      }));
    }, calendarCode);
    for (const [id, date, time] of [['monday-early', '2026-09-28', '07:00'], ['tuesday-early', '2026-09-29', '07:30']]) {
      const card = page.locator(`[data-date="${date}"] [data-schedule-id="${id}"]`);
      await card.waitFor(); assert((await card.textContent()).includes(time));
      const bounds = await card.boundingBox(), body = await page.locator(`[data-date="${date}"] [data-day-body]`).boundingBox();
      assert(bounds.y >= body.y, 'early card must remain below its own date heading');
    }
    await page.screenshot({ path: path.join(out, 'early-lessons-correct-days.png'), fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ verified: true, transport: 'controlled native bridge', actualComponents: [...files, 'src/pages/ScheduleCalendar.tsx'], screenshots: ['wide-pending.png', 'narrow-pending.png', 'empty-after-submit.png', 'legacy-failed-discard.png', 'discarded-reopen-empty.png', 'early-lessons-correct-days.png'], keyboard: ['Enter batch confirmation', 'Escape close'], pageErrors: errors }, null, 2));
    console.log('actual Ant Design sync window wide/narrow, keyboard, silent online and aggregate offline checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
