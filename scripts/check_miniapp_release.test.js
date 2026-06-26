const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(process.cwd(), 'scripts/check_miniapp_release.js');

assert.ok(fs.existsSync(scriptPath), 'miniapp release smoke script should exist');

const source = fs.readFileSync(scriptPath, 'utf-8');

assert.ok(source.includes('miniapp/dist/app.json'), 'script should verify miniapp dist app.json exists');
assert.ok(source.includes('project.config.json'), 'script should verify project config');
assert.ok(source.includes('urlCheck'), 'script should verify urlCheck release setting');
assert.ok(source.includes('uploadWithSourceMap'), 'script should verify source map upload setting');
assert.ok(source.includes('https://'), 'script should require HTTPS API endpoint');
assert.ok(source.includes('wx3d570539bbe6ba1b'), 'script should pin expected miniapp appid');

console.log('miniapp release smoke script checks passed');
