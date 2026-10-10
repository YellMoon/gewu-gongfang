'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    page.on('pageerror', error => console.error('Browser component error:', error));
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }) : route.abort());
    await page.goto('http://desktop-account.test');
    for (const file of ['react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js',
      'dayjs/dayjs.min.js', 'antd/dist/antd.min.js', '@ant-design/icons/dist/index.umd.min.js']) {
      await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
    }
    await page.evaluate(({ sources }) => {
      window.online = true;
      Object.defineProperty(navigator, 'onLine', { get: () => window.online, configurable: true });
      window.updateEvents = {};
      window.updateMode = 'failed';
      window.api = {
        on: (event, callback) => { window.updateEvents[event] = callback; return () => { delete window.updateEvents[event]; }; },
        invoke: async () => ({ success: false, error: 'network connection unavailable' }),
      };
      const profile = { accountName: 'alice', name: '教师甲', phone: '13800000000', subject: '物理', wechat: null,
        activeRole: 'teacher', eligibleRoles: ['teacher'] };
      window.fetch = async url => {
        if (url !== 'https://physicsedu.xyz/cloud-business/api/desktop-identity/profile') throw Error('profile proxy prefix was discarded');
        return { ok: true, json: async () => ({ success: true, data: profile }) };
      };
      const modules = {
        react: React, antd, '@ant-design/icons': icons,
        '../services/desktopAuthorizationSession.mjs': { readDesktopAuthorizationSession: () => ({ authorization: 'Bearer fixture', authContext: { userId: 'a', activeRole: 'teacher' } }) },
        '../services/runtimeConfigClient': { getRuntimeConfig: async () => ({}) },
        '../services/managedSyncConfig.mjs': { resolveDesktopIdentityBaseUrl: () => 'https://physicsedu.xyz/cloud-business' },
        './IdentityDeviceCenter': { __esModule: true, default: () => null },
        '../../package.json': { version: '1.0.0' },
        './MyAccount.css': {},
      };
      for (const [name, source] of sources) {
        const exported = {};
        new Function('require', 'exports', source)(key => {
          if (!(key in modules)) throw new Error('UNEXPECTED_IMPORT: ' + key);
          return modules[key];
        }, exported);
        modules[name] = exported;
      }
      const reactRoot = ReactDOM.createRoot(document.getElementById('root'));
      window.renderAccount = (userId = 'a', activeRole = 'teacher', key = 'first') => reactRoot.render(React.createElement(
        modules['../components/DesktopAccountContext'].DesktopAccountContext.Provider,
        { value: { userId, activeRole, name: '教师甲', controls: null } },
        React.createElement(modules.MyAccount.default, { key })));
      window.unmountAccount = () => reactRoot.render(null);
      window.renderUpdates = () => reactRoot.render(React.createElement(modules['./SystemSettings'].default));
      window.renderAccount();
    }, { sources: [
      ['../components/DesktopAccountContext', compile('src/components/DesktopAccountContext.tsx')],
      ['../services/desktopAccountProfile.mjs', compile('src/services/desktopAccountProfile.mjs')],
      ['../services/desktopUpdateClient.mjs', compile('src/services/desktopUpdateClient.mjs')],
      ['./SystemSettings', compile('src/pages/SystemSettings.tsx')],
      ['MyAccount', compile('src/pages/MyAccount.tsx')],
    ] });
    await page.getByText('alice', { exact: true }).waitFor();
    assert.equal(await page.getByText('未登记', { exact: true }).count(), 0, 'UTF-8: absent personal fields stay blank');
    assert.equal(await page.getByText('暂不可用', { exact: true }).count(), 0);
    assert.equal(await page.locator('.ant-descriptions-item').filter({ hasText: '微信号' }).locator('.ant-descriptions-item-content').innerText(), '');
    await page.evaluate(() => { window.online = false; window.dispatchEvent(new Event('offline')); window.unmountAccount(); });
    await page.locator('.my-account').waitFor({ state: 'detached' });
    await page.evaluate(() => window.renderAccount('a', 'teacher', 'offline-remount'));
    await page.getByText('alice', { exact: true }).waitFor();
    await page.getByText('当前离线，显示上次读取的个人资料。', { exact: true }).waitFor();
    await page.evaluate(() => window.renderAccount('b', 'teacher', 'different-account'));
    await page.getByText('当前离线，联网后可读取个人资料。', { exact: true }).waitFor();
    assert.equal(await page.getByText('alice', { exact: true }).count(), 0, 'another account cannot see verified cached fields');
    assert.equal(await page.getByText('暂不可用', { exact: true }).count(), 0);
    await page.evaluate(() => window.renderAccount('a', 'super_admin', 'different-role'));
    assert.equal(await page.getByText('alice', { exact: true }).count(), 0, 'role partitions cannot reuse cached fields');

    await page.evaluate(() => window.renderUpdates());
    await page.getByRole('button').filter({ hasText: '检查更新' }).click();
    await page.locator('.ant-alert-message').filter({ hasText: '更新检查失败' }).waitFor();
    await page.evaluate(() => window.updateEvents['update-available']({ version: '2.0.0' }));
    await page.getByRole('button').filter({ hasText: '下载更新' }).click();
    await page.locator('.ant-alert-message').filter({ hasText: '更新下载失败' }).waitFor({ timeout: 3000 });
    await page.evaluate(() => window.updateEvents['update-downloaded']());
    await page.getByRole('button').filter({ hasText: '重启并安装' }).click();
    await page.locator('.ant-alert-message').filter({ hasText: '更新安装失败' }).waitFor({ timeout: 3000 });
    assert.equal(await page.locator('.ant-alert-message').filter({ hasText: '更新已下载完成' }).count(), 0);

    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/components/DesktopIdentityGate.css'), 'utf8') });
    await page.evaluate(() => {
      const test = document.createElement('div');
      test.innerHTML = '<div class="desktop-identity-runtime desktop-identity-runtime--offline"><div class="desktop-identity-offline-banner">离线</div><div class="desktop-identity-runtime-error">错误</div><div class="app-shell">标题和内容</div></div>';
      document.body.append(test);
    });
    const boxes = await Promise.all(['.desktop-identity-runtime-error', '.app-shell'].map(selector => page.locator(selector).boundingBox()));
    assert(boxes[0].y + boxes[0].height <= boxes[1].y, 'offline errors must reserve their height above the app shell');
    const audit = fs.readFileSync(path.join(root, 'src/pages/AuditCenter.tsx'), 'utf8');
    assert(!audit.includes('title="审核中心"'), 'audit page must use the single global title');
    assert(!audit.includes('actionButtons'), 'publication status is automatic; no manual retirement actions');
  } finally { await browser.close(); }
  console.log('account offline remount, identity isolation, update failure feedback and offline error layout passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
