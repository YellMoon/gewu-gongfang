const assert = require('assert');
const fs = require('fs');

const api = fs.readFileSync('miniapp/src/utils/api.ts', 'utf-8');
const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf-8');
const loginPage = fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf-8');
const projectConfig = fs.readFileSync('miniapp/project.config.json', 'utf-8');
const prodConfig = fs.readFileSync('miniapp/config/prod.ts', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(api.includes('__API_BASE_URL__'), 'miniapp API should use build-time API base URL');
assert.ok(!api.includes("DEFAULT_BASE_URL = 'http://39.106.172.132'"), 'miniapp default API should not be bare HTTP IP');
assert.ok(api.includes('https://physicsedu.xyz/scheduling'), 'miniapp default API should use HTTPS legal domain');
assert.ok(prodConfig.includes('https://physicsedu.xyz/scheduling'), 'miniapp prod config should use HTTPS legal domain');
assert.ok(!api.includes("api.get<any[]>('/scheduling/"), 'miniapp API paths should not duplicate the /scheduling reverse-proxy prefix');
assert.ok(api.includes("api.get<any[]>('/api/students')"), 'miniapp business API should call backend /api routes under the /scheduling base URL');
assert.ok(loginPage.includes("'/api/auth/wechat-login'"), 'miniapp WeChat login should call the backend wechat-login route');
assert.ok(loginPage.includes('user_type: loginUser.role'), 'miniapp login should persist backend role as user_type for role-based UI');
assert.ok(appConfig.indexOf("'pages/login/index'") < appConfig.indexOf("'pages/index/index'"), 'miniapp should launch login first to avoid startup redirect blank screens');
assert.ok(!fs.readFileSync('miniapp/src/app.tsx', 'utf-8').includes("redirectTo({ url: '/pages/login/index' })"), 'app launch should not redirect to login before the first page is ready');
assert.ok(projectConfig.includes('"urlCheck": true'), 'miniapp project config should enable URL checks for release');
assert.ok(projectConfig.includes('"uploadWithSourceMap": false'), 'miniapp project config should not upload source maps for release');
assert.ok(packageJson.includes('miniapp/src/utils/miniappReleaseConfig.test.js'), 'miniapp release config test should run in npm test');

console.log('miniapp release config checks passed');
