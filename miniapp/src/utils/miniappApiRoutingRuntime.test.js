'use strict';

const assert = require('assert');
const { selectApiBaseUrl } = require('./miniappApiRoutingRuntime');

const normalBaseUrl = 'https://physicsedu.xyz/scheduling/';
const reviewBaseUrl = 'https://physicsedu.xyz/';

assert.strictEqual(
  selectApiBaseUrl({ path: '/api/auth/review-demo', normalBaseUrl, reviewBaseUrl, isReviewIdentity: false }),
  'https://physicsedu.xyz',
  'review login must reach Gateway before a review identity exists',
);
assert.strictEqual(
  selectApiBaseUrl({ path: '/api/permissions/my', normalBaseUrl, reviewBaseUrl, isReviewIdentity: true }),
  'https://physicsedu.xyz',
  'strict review sessions must keep permission refreshes on Gateway',
);
assert.strictEqual(
  selectApiBaseUrl({ path: '/api/cloud/snapshots/read?snapshotType=full', normalBaseUrl, reviewBaseUrl, isReviewIdentity: true }),
  'https://physicsedu.xyz',
  'strict review sessions must keep sandbox snapshot reads on Gateway',
);
assert.strictEqual(
  selectApiBaseUrl({ path: '/api/students', normalBaseUrl, reviewBaseUrl, isReviewIdentity: false }),
  'https://physicsedu.xyz/scheduling',
  'normal miniapp business requests must remain on Backend',
);
assert.strictEqual(
  selectApiBaseUrl({ path: '/api/auth/wechat-login', normalBaseUrl, reviewBaseUrl, isReviewIdentity: false }),
  'https://physicsedu.xyz/scheduling',
  'normal WeChat login must remain on Backend',
);
assert.strictEqual(
  selectApiBaseUrl({ path: '/api/auth/refresh', normalBaseUrl, reviewBaseUrl, isReviewIdentity: false }),
  'https://physicsedu.xyz/scheduling',
  'normal token refresh must remain on Backend',
);
assert.strictEqual(
  selectApiBaseUrl({ path: '/api/review-demo/artifacts/artifact-1', normalBaseUrl, reviewBaseUrl, isReviewIdentity: true }),
  'https://physicsedu.xyz',
  'review artifact downloads must remain on Gateway',
);

console.log('miniapp API routing runtime checks passed');
