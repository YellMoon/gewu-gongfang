'use strict';
// UTF-8: verify original navigation interactions without a business session or writes.
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
  const results = [];
  try {
    for (const width of [1200, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/index.css'), 'utf8').replace(/^@import[^;]+;/gm, '') });
      for (const file of ['react/umd/react.production.min.js', 'react-dom/umd/react-dom.production.min.js',
        'dayjs/dayjs.min.js', 'antd/dist/antd.min.js', '@ant-design/icons/dist/index.umd.min.js']) {
        await page.addScriptTag({ path: path.join(root, 'node_modules', file) });
      }
      await page.evaluate(sources => {
        const modules = {
          react: window.React, antd: window.antd, '@ant-design/icons': window.icons,
          '../components/sync/SyncQuickPanel': { default: () => null, __esModule: true },
          '../services/runtimeConfigClient': { getRuntimeConfig: async () => ({}) },
          '../services/desktopAuthorizationSession.mjs': { readDesktopAuthorizationSession: () => null },
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
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(modules.AppShell.default,
          { currentPage: 'course-calendar', onNavigate: () => {}, onRefresh: () => {} },
          React.createElement('p', { id: 'workspace-anchor' }, '课程表核验')));
      }, [
        ['./PageHeaderBar', compile('src/layout/PageHeaderBar.tsx')],
        ['../navigation/appNavigation', compile('src/navigation/appNavigation.tsx')],
        ['AppShell', compile('src/layout/AppShell.tsx')],
      ]);
      await page.locator('#workspace-anchor').waitFor();
      const geometry = () => page.locator('.app-shell__main').boundingBox();
      const baseline = await geometry();
      assert.equal(baseline.x, 0);
      assert.equal(baseline.width, width);
      // Monitor every animation frame, not just a possibly premature post-click sample.
      await page.evaluate(() => {
        window.layoutSamples = [];
        window.recordLayout = true;
        const frame = () => {
          const r = document.querySelector('.app-shell__main').getBoundingClientRect();
          window.layoutSamples.push({ x: r.x, width: r.width });
          if (window.recordLayout) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const settled = async open => {
        await page.waitForFunction(expected => document.querySelector('.app-shell__sider').classList.contains('app-shell__sider--open') === expected, open);
        await page.locator('.app-shell__sider').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
        assert.deepEqual(await geometry(), baseline);
      };
      await page.locator('.app-shell__edge-trigger').hover();
      await settled(true);
      // The pointer must first enter the actual rail before testing its mouse-leave timer.
      await page.locator('.app-shell__sider').hover();
      await page.mouse.move(width - 30, 100);
      await settled(false);
      await page.locator('.app-shell__collapse-button').click();
      await settled(true);
      assert.equal(await page.locator('.app-shell--nav-pinned').count(), 1);
      await page.mouse.move(width - 30, 100);
      // Observe longer than the component's 280ms close timer after leaving a pinned rail.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
      assert.equal(await page.locator('.app-shell__sider--pinned').count(), 1);
      assert.equal(await page.locator('.app-shell__sider--open').count(), 1);
      await page.locator('.app-shell__sider-unpin').click();
      await page.mouse.move(width - 30, 100);
      await settled(false);
      const samples = await page.evaluate(() => { window.recordLayout = false; return window.layoutSamples; });
      assert(samples.length > 10, 'must observe the navigation transition, not one frame');
      assert(samples.every(r => r.x === 0 && r.width === width), 'navigation moved or squeezed the workspace during a transition');
      assert.deepEqual(errors, []);
      // Prove the regression detector rejects the exact removed squeezing rule.
      await page.addStyleTag({ content: '.app-shell--nav-pinned .app-shell__main { margin-left:236px; width:calc(100% - 236px); }' });
      await page.locator('.app-shell__collapse-button').click();
      assert.notDeepEqual(await geometry(), baseline, 'removed layout regression must be detectable');
      results.push({ width, hoverOpenClose: true, pinRelease: true, stableAnimationFrames: samples.length, regressionDetected: true });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('actual AppShell interaction checks passed', JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
