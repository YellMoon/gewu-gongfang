const assert = require('assert');
const fs = require('fs');

const scriptPath = 'scripts/check_deploy_readiness.js';

assert.ok(fs.existsSync(scriptPath), 'deploy readiness script should exist');

const source = fs.readFileSync(scriptPath, 'utf-8');

for (const name of ['DEPLOY_HOST', 'DEPLOY_PASSWORD', 'DEPLOY_KEY_PATH', 'BACKEND_JWT_SECRET']) {
  assert.ok(source.includes(name), `deploy readiness should check ${name}`);
}
assert.ok(
  source.includes('DEPLOY_PASSWORD or DEPLOY_KEY_PATH'),
  'deploy readiness should accept either password or SSH key authentication'
);

assert.ok(source.includes('miniapp/project.config.json'), 'deploy readiness should check miniapp project config');
assert.ok(source.includes('https://physicsedu.xyz/scheduling'), 'deploy readiness should check production miniapp API');
assert.ok(source.includes('npm run miniapp:release-check'), 'deploy readiness should mention miniapp release check command');

console.log('deploy readiness checks passed');
