'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('miniapp/src/utils/unrecognizedExperience.ts', 'utf8');
const page = fs.readFileSync('miniapp/src/pages/unrecognized-experience/index.tsx', 'utf8');
const experienceContent = fs.readFileSync('miniapp/src/components/UnrecognizedExperienceContent/index.tsx', 'utf8');

assert.ok(source.includes("import { applicationApi, experienceApi } from './api'"));
assert.ok(source.includes('experienceApi.questions()'));
assert.ok(source.includes('experienceApi.createTask('));
assert.ok(source.includes('experienceApi.getTaskResult(taskId)'));
assert.ok(source.includes('experienceApi.cancelTask(taskId)'));
assert.ok(source.includes('experienceApi.downloadArtifact(artifactId)'));
assert.ok(source.includes('applicationApi.mine()'));
assert.ok(source.includes('applicationApi.submit('));
assert.ok(!source.includes('applicationApi.withdraw('));
for (const removedPath of [
  '/api/experience/tasks/${taskId}',
  '/api/experience/tasks/${taskId}/artifacts/${artifactId}',
  '/api/experience/apply',
  '/api/experience/application/status',
]) {
  assert.ok(!source.includes(removedPath), `removed route must stay absent: ${removedPath}`);
}

assert.ok(experienceContent.includes('isUnrecognizedIdentity'), 'experience page must verify the shared authoritative identity');
assert.ok(experienceContent.includes('openSessionBoundDocument'), 'downloaded artifacts must stay bound to the current auth session');
assert.ok(experienceContent.includes("'/pages/account-application/index'"), 'experience entry must open the single account application page');
assert.ok(!page.includes('/pages/unrecognized-apply/index'), 'removed split application route must stay absent');
assert.ok(!page.includes('loadApplicationStatus'), 'experience page must leave application state to the single application page');
assert.ok(!page.includes('unrecognized_session'), 'experience page must not read a parallel session store');

const appConfig = fs.readFileSync('miniapp/src/app.config.ts', 'utf8');
assert.ok(appConfig.includes("'pages/account-application/index'"));
assert.ok(!appConfig.includes('pages/unrecognized-apply/index'));
assert.ok(!appConfig.includes('pages/unrecognized-status/index'));

console.log('miniapp unrecognized experience API checks passed');
