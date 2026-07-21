'use strict';

const assert = require('assert');
const { selectApiBaseUrl } = require('./miniappApiRoutingRuntime');

const normalBaseUrl = 'https://physicsedu.xyz/scheduling/';

for (const path of [
  '/api/auth/wechat-login',
  '/api/auth/refresh',
  '/api/auth/me',
  '/api/miniapp/applications/me',
  '/api/miniapp/applications',
  '/api/experience/questions',
  '/api/experience/tasks',
  '/api/experience/artifacts/artifact-1',
  '/api/students',
]) {
  assert.strictEqual(
    selectApiBaseUrl({ path, normalBaseUrl }),
    'https://physicsedu.xyz/scheduling',
    `${path} must use the scheduling Backend`,
  );
}

assert.strictEqual(
  selectApiBaseUrl({
    path: '/api/experience/questions',
    normalBaseUrl,
    reviewBaseUrl: 'https://physicsedu.xyz',
    isReviewIdentity: true,
  }),
  'https://physicsedu.xyz/scheduling',
  'legacy review options must never redirect experience traffic to Gateway',
);

console.log('miniapp single Backend API routing checks passed');
