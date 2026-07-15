const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(process.cwd(), 'scripts/check_miniapp_release.js');

assert.ok(fs.existsSync(scriptPath), 'miniapp release smoke script should exist');

const source = fs.readFileSync(scriptPath, 'utf-8');
const { parseProdApiBases } = require('./check_miniapp_release');
const prodSource = fs.readFileSync('miniapp/config/prod.ts', 'utf-8');

assert.ok(source.includes('miniapp/dist/app.json'), 'script should verify miniapp dist app.json exists');
assert.ok(source.includes('project.config.json'), 'script should verify project config');
assert.ok(source.includes('urlCheck'), 'script should verify urlCheck release setting');
assert.ok(source.includes('uploadWithSourceMap'), 'script should verify source map upload setting');
assert.ok(source.includes('https://'), 'script should require HTTPS API endpoint');
assert.ok(source.includes('DEFAULT_REVIEW_API_BASE_URL'), 'script should verify the independent review Gateway endpoint');
assert.ok(source.includes('wx3d570539bbe6ba1b'), 'script should pin expected miniapp appid');
assert.deepStrictEqual(parseProdApiBases(prodSource), {
  apiBaseUrl: 'https://physicsedu.xyz/scheduling',
  reviewApiBaseUrl: 'https://physicsedu.xyz',
}, 'release check should parse the two independently configured production fallbacks');
assert.throws(
  () => parseProdApiBases(prodSource.replace("'https://physicsedu.xyz'", "'http://wrong.example.test'")),
  /review API must use https/,
  'an HTTP review override must not pass because the normal API source contains an HTTPS substring',
);
assert.throws(
  () => parseProdApiBases(prodSource.replace("'https://physicsedu.xyz'", "'https://wrong.example.test'")),
  /review API should be https:\/\/physicsedu\.xyz/,
  'a wrong review domain must not pass because the normal API source contains the expected domain substring',
);

console.log('miniapp release smoke script checks passed');
