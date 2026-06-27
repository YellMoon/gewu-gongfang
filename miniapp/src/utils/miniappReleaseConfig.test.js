const assert = require('assert');
const fs = require('fs');

const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const offlineStorage = fs.readFileSync('miniapp/src/utils/storage.ts', 'utf-8');
const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf-8');
const appEntry = fs.readFileSync('miniapp/src/app.tsx', 'utf-8');
const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const projectConfig = fs.readFileSync('miniapp/project.config.json', 'utf-8');
const indexConfig = fs.readFileSync('miniapp/config/index.ts', 'utf-8');
const prodConfig = fs.readFileSync('miniapp/config/prod.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(api.includes('__API_BASE_URL__'), 'miniapp API should use build-time API base URL');
assert.ok(!api.includes("DEFAULT_BASE_URL = 'http://39.106.172.132'"), 'miniapp default API should not be bare HTTP IP');
assert.ok(api.includes('https://physicsedu.xyz/scheduling'), 'miniapp default API should use HTTPS legal domain');
assert.ok(indexConfig.includes('https://physicsedu.xyz/scheduling'), 'default Taro build config should use HTTPS legal domain unless overridden');
assert.ok(!indexConfig.includes('http://localhost:3001/api'), 'default Taro build config should not produce localhost API in dist');
assert.ok(prodConfig.includes('https://physicsedu.xyz/scheduling'), 'miniapp prod config should use HTTPS legal domain');
assert.ok(!api.includes("api.get<any[]>('/scheduling/"), 'miniapp API paths should not duplicate the /scheduling reverse-proxy prefix');
assert.ok(api.includes("api.get<any[]>('/api/students')"), 'miniapp business API should call backend /api routes under the /scheduling base URL');
assert.ok(loginPage.includes("'/api/auth/wechat-login'"), 'miniapp WeChat login should call the backend wechat-login route');
assert.ok(loginPage.includes('user_type: loginUser.role'), 'miniapp login should persist backend role as user_type for role-based UI');
assert.ok(loginPage.includes("Taro.reLaunch({ url: '/pages/index/index' })"), 'login page should enter the tabBar home with reLaunch to avoid switchTab timeout from a non-tab launch page');
assert.ok(!loginPage.includes("Taro.switchTab({ url: '/pages/index/index' })"), 'login page should not use switchTab to enter home from the non-tab login page');
assert.ok(!loginPage.includes('Taro.getNetworkType'), 'login page should not call Taro.getNetworkType before login because DevTools can throw WAServiceMainContext timeout');
assert.ok(!api.includes('Taro.getNetworkType'), 'API client should rely on request failures instead of Taro.getNetworkType because DevTools can throw WAServiceMainContext timeout');
assert.ok(!appEntry.includes('Taro.getNetworkType'), 'app startup should not call Taro.getNetworkType because DevTools can throw WAServiceMainContext timeout');
assert.ok(!offlineStorage.includes('Taro.getNetworkType'), 'offline storage should queue after request failures instead of probing Taro.getNetworkType');
assert.ok(appConfig.indexOf("'pages/login/index'") < appConfig.indexOf("'pages/index/index'"), 'miniapp should launch login first to avoid startup redirect blank screens');
assert.ok(!appEntry.includes("redirectTo({ url: '/pages/login/index' })"), 'app launch should not redirect to login before the first page is ready');
assert.ok(projectConfig.includes('"urlCheck": true'), 'miniapp project config should enable URL checks for release');
assert.ok(projectConfig.includes('"uploadWithSourceMap": false'), 'miniapp project config should not upload source maps for release');
assert.ok(projectConfig.includes('"useApiHook": false') && projectConfig.includes('"useApiHostProcess": false'), 'miniapp project config should avoid DevTools API hook host-process timeout noise');
assert.ok(packageJson.includes('miniapp/src/utils/miniappReleaseConfig.test.js'), 'miniapp release config test should run in npm test');

console.log('miniapp release config checks passed');
