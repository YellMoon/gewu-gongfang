'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { canOpenMiniappRoute } = require('./miniappRouteAccess');

function load(sourcePath, customRequire) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(customRequire, module, module.exports);
  return module.exports;
}

(async () => {
  let role = 'visitor';
  let verified = false;
  let refreshes = 0;
  let failRefresh = false;
  let replaceDuringRefresh = false;
  const policy = () => ({ role, modules: ['teacher', 'super_admin'].includes(role) ? ['payments', 'stats', 'assets'] : [] });
  const access = () => verified ? policy() : { role, modules: [] };
  const permission = {
    getCurrentUser: () => ({ id: role, user_type: role }),
    getMiniappRolePolicy: policy,
    getEffectiveMiniappAccess: access,
    fetchPermissions: async () => { refreshes++; if (failRefresh) throw Error('OFFLINE'); if (replaceDuringRefresh) role = 'visitor'; verified = true; },
  };
  const boundary = load(path.join(__dirname, 'miniappPageAccess.ts'), name => {
    if (name === './permission') return permission;
    if (name === './miniappRouteAccess') return { canOpenMiniappRoute };
    throw Error(name);
  });
  for (const restrictedRole of ['visitor', 'student', 'family_member']) {
    role = restrictedRole;
    for (const page of ['payments', 'stats', 'assets']) {
      assert.equal(await boundary.refreshMiniappPageAccess(`/pages/${page}/index`), false);
    }
  }
  assert.equal(refreshes, 0, 'known restricted roles must not request broader permission');
  role = 'teacher';
  assert.equal(await boundary.refreshMiniappPageAccess('/pages/payments/index'), true);
  assert.equal(refreshes, 1, 'cold page entry must wait for real permission refresh');
  assert.equal(await boundary.refreshMiniappPageAccess('/pages/assets/index'), true);
  assert.equal(refreshes, 1, 'verified permission must not add a request on every navigation');
  verified = false; failRefresh = true;
  assert.equal(await boundary.refreshMiniappPageAccess('/pages/payments/index'), false);
  failRefresh = false; replaceDuringRefresh = true;
  assert.equal(await boundary.refreshMiniappPageAccess('/pages/payments/index'), false, 'recheck current identity after async permission response');

  // Execute the actual three page components and their lifecycle callbacks.
  for (const scenario of ['denied', 'allowed', 'changed-during-load']) for (const page of ['payments', 'stats', 'assets']) {
    const permitted = scenario !== 'denied';
    let currentAccess = permitted;
    const callbacks = [];
    const reads = [];
    const jsx = (type, props) => ({ type, props });
    const Forbidden = function Forbidden() {};
    const exports = load(path.join(__dirname, '../pages', page, 'index.tsx'), name => {
      if (name === 'react') return {
        useState: initial => [initial, () => {}], useMemo: fn => fn(), useEffect: fn => callbacks.push(fn),
      };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@tarojs/components') return { View: 'View', Text: 'Text', ScrollView: 'ScrollView' };
      if (name === '@tarojs/taro') return { useDidShow: fn => callbacks.push(fn) };
      if (name.endsWith('/miniappPageAccess')) return {
        canAccessMiniappPage: () => currentAccess,
        refreshMiniappPageAccess: async () => { if (page === 'assets' && scenario === 'changed-during-load') currentAccess = false; return permitted; },
      };
      if (name === '../forbidden') return { default: Forbidden };
      if (name.endsWith('/sync')) return { getLocalData: key => { reads.push(key); return []; }, pullFromCloudBusinessProjection: async () => {
        reads.push('cloud');
        if (scenario === 'changed-during-load') currentAccess = false;
      } };
      if (name === './paymentsRuntime') return require('../pages/payments/paymentsRuntime');
      if (name.endsWith('.scss') || name.endsWith('/permission') || name.endsWith('/api') || name.endsWith('/authSession') || name.endsWith('/personalAssetCsv') || name.endsWith('/shared') || name.endsWith('/types')) return {};
      throw Error(`${page}: ${name}`);
    });
    const tree = exports.default();
    assert.equal(tree.type, permitted ? 'View' : Forbidden, `${page}: render only the verified page or access explanation`);
    for (const callback of callbacks) await callback();
    await new Promise(resolve => setImmediate(resolve));
    if (scenario === 'changed-during-load') assert.deepEqual(reads, page === 'assets' ? [] : ['cloud'], `${page}: no cache read after access changes while loading`);
    else if (permitted) assert.ok(reads.length > 0, `${page}: authorized page must retain its original loading behavior`);
    else assert.deepEqual(reads, [], `${page}: restricted entry must not read cache or request business projection`);
  }
  console.log('miniapp financial page entry and pre-read access checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
