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
    for (const width of [900, 1200, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.route('**/*', route => route.abort());
      await page.setContent('<div id="root"></div>');
      for (const css of ['src/index.css', 'src/components/DesktopIdentityGate.css']) {
        await page.addStyleTag({ content: fs.readFileSync(path.join(root, css), 'utf8').replace(/^@import[^;]+;/gm, '') });
      }
      for (const file of ['react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js',
        'dayjs/dayjs.min.js', 'antd/dist/antd.min.js', '@ant-design/icons/dist/index.umd.min.js']) {
        await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
      }
      const hasContext = fs.existsSync(path.join(root, 'src/components/DesktopAccountContext.tsx'));
      await page.evaluate(({ sources, hasContext }) => {
        const modules = {
          react: React, antd, '@ant-design/icons': icons,
          '../components/sync/SyncQuickPanel': { __esModule: true, default: () => React.createElement(antd.Button, { id: 'sync-action' }, '云同步') },
          '../services/runtimeConfigClient': { getRuntimeConfig: async () => ({}) },
          '../services/desktopAuthorizationSession.mjs': { readDesktopAuthorizationSession: () => ({ authContext: { activeRole: 'super_admin' } }) },
          '../services/pairingApiBase.mjs': { resolvePairingApiBase: () => '' },
          '../services/identityDeviceCenterPolicy.mjs': { loadIdentityDevicePendingCount: async () => 0 },
        };
        for (const [name, code] of sources) {
          const exported = {};
          new Function('require', 'exports', code)(key => {
            if (!(key in modules)) throw new Error('UNEXPECTED_COMPONENT_IMPORT: ' + key);
            return modules[key];
          }, exported);
          modules[name] = exported;
        }
        const e = React.createElement;
        const controls = e(modules.DesktopAccountMenu.default, { name: '姓名较长的超级管理员账号', role: '超级管理员', busy: false, canElevate: false, canReturnTeacher: true, onSwitchRole: role => { window.switchedRole = role; }, onLock: () => { window.locked = true; } });
        window.addEventListener('navigate-page', event => { window.navigateTarget = event.detail; });
        const app = e(modules.AppShell.default, {
          currentPage: 'today', onNavigate: () => {}, onRefresh: () => { window.refreshed = true; },
        }, e('button', { id: 'module-action', style: { float: 'right' } }, '新增记录'));
        ReactDOM.createRoot(document.getElementById('root')).render(e('div', { className: 'desktop-identity-runtime' },
          hasContext ? e(modules['../components/DesktopAccountContext'].DesktopAccountContext.Provider,
            { value: { controls, activeRole: 'super_admin' } }, app) : e(React.Fragment, null, controls, app)));
      }, { hasContext, sources: [
        ['DesktopAccountMenu', compile('src/components/DesktopAccountMenu.tsx')],
        ...(hasContext ? [['../components/DesktopAccountContext', compile('src/components/DesktopAccountContext.tsx')]] : []),
        ['./PageHeaderBar', compile('src/layout/PageHeaderBar.tsx')],
        ['../navigation/appNavigation', compile('src/navigation/appNavigation.tsx')],
        ['AppShell', compile('src/layout/AppShell.tsx')],
      ] });
      const refresh = page.locator('.page-header-bar button').filter({ hasText: '刷新' });
      await refresh.waitFor();
      const boxes = await Promise.all([refresh, page.locator('.desktop-account-trigger'), page.locator('#sync-action'), page.locator('#module-action')].map(locator => locator.boundingBox()));
      const intersects = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
        && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
      assert(!intersects(boxes[0], boxes[1]), `account control overlaps refresh at ${width}px`);
      for (let i = 0; i < boxes.length; i++) {
        assert(boxes[i].x >= 0 && boxes[i].x + boxes[i].width <= width, `control ${i} outside viewport at ${width}px`);
        for (let j = i + 1; j < boxes.length; j++) assert(!intersects(boxes[i], boxes[j]), `controls ${i}/${j} overlap at ${width}px`);
      }
      await refresh.click({ timeout: 3000 });
      assert.equal(await page.evaluate(() => window.refreshed), true);
      await page.locator('.desktop-account-trigger').click({ timeout: 3000 });
      await page.getByRole('menuitem').filter({ hasText: '我的' }).click();
      assert.equal(await page.evaluate(() => window.navigateTarget), 'my-account');
      await page.locator('.desktop-account-trigger').click();
      await page.getByRole('menuitem').filter({ hasText: '切换为教师' }).click();
      assert.equal(await page.evaluate(() => window.switchedRole), 'teacher');
      await page.locator('.desktop-account-trigger').click();
      await page.getByRole('menuitem').filter({ hasText: '锁定' }).click();
      assert.equal(await page.evaluate(() => window.locked), true);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('.page-header-bar__description').count(), 0);
      assert.equal(await page.locator('.desktop-identity-runtime-bar').evaluate(element => getComputedStyle(element).position), 'static');
      const content = await page.locator('.app-shell__content').boundingBox();
      assert(content.y + content.height <= 801, 'content height must use actual remaining viewport');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('account controls, refresh and module actions remain visible and clickable');
})().catch(error => { console.error(error); process.exitCode = 1; });
