'use strict';

const assert = require('assert');
const fs = require('fs');
const { containsRemovedReviewClientFlow, parseProdApiBase } = require('./check_miniapp_release');

const source = fs.readFileSync('scripts/check_miniapp_release.js', 'utf8');
const prodSource = fs.readFileSync('miniapp/config/prod.ts', 'utf8');
assert.ok(source.includes('miniapp/dist/app.json'));
assert.ok(source.includes('project.config.json'));
assert.ok(source.includes('urlCheck') && source.includes('uploadWithSourceMap'));
assert.ok(source.includes('wx3d570539bbe6ba1b'));
assert.ok(!source.includes('DEFAULT_REVIEW_API_BASE_URL'));
assert.strictEqual(containsRemovedReviewClientFlow("identity.token_use === 'review-demo'"), false,
  'legacy-identity rejection markers are security cleanup, not a client login flow');
assert.strictEqual(containsRemovedReviewClientFlow("reviewDemoApi.login('/api/auth/review-demo')"), true);
assert.deepStrictEqual(parseProdApiBase(prodSource), { apiBaseUrl: 'https://physicsedu.xyz/scheduling' });
assert.throws(
  () => parseProdApiBase(prodSource.replaceAll("'https://physicsedu.xyz/scheduling'", "'http://wrong.example.test'")),
  /production miniapp API must use https/,
);
assert.throws(
  () => parseProdApiBase(prodSource.replaceAll("'https://physicsedu.xyz/scheduling'", "'https://wrong.example.test'")),
  /production miniapp API should be https:\/\/physicsedu\.xyz\/scheduling/,
);
assert.throws(
  () => parseProdApiBase(`${prodSource}\n__REVIEW_API_BASE_URL__: JSON.stringify(process.env.REVIEW || 'https://physicsedu.xyz')`),
  /removed review Gateway base/,
);
console.log('miniapp release smoke script checks passed');
