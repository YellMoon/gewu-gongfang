'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const workflow = require('yaml').parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
const steps = Object.values(workflow.jobs).flatMap(job => job.steps || []);
const commands = steps.filter(step => step.run).map(step => step.run).join('\n');
assert.ok(steps.some(step => step.uses === 'actions/checkout@v4' && step.with?.lfs === true), 'CI must materialize the committed export font');
assert.match(commands, /npm run dist:win/);
assert.doesNotMatch(commands, /npx electron-builder|docker_deploy_gray|ci\.upload/);
assert.ok(steps.some(step => step.run === 'npm run rebuild:node' && step.if.includes('always()')));
assert.ok(steps.some(step => step.run === 'python scripts/miniapp_fixed_egress.py'));
assert.ok(steps.some(step => step.run === 'python scripts/deploy_cloud_business_api.py deploy'));
assert.match(commands, /GEWU_RUBY_RUNTIME_SHA256/);
for (const step of steps) {
  for (const match of String(step.run || '').matchAll(/(?:node|python) (scripts\/[A-Za-z0-9_./-]+)/g)) assert.ok(fs.existsSync(match[1]), `missing workflow script ${match[1]}`);
  if (step.with?.['cache-dependency-path']) for (const file of step.with['cache-dependency-path'].trim().split(/\s+/)) {
    require('node:child_process').execFileSync('git', ['ls-files', '--error-unmatch', file], { stdio: 'ignore' });
  }
}
assert.ok(steps.findIndex(step => step.run === 'npm run release:prepare') < steps.findIndex(step => step.run === 'npm run dist:win'));
console.log('controlled release workflow, tracked caches, native cleanup and pinned runtime checks passed');
