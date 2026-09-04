'use strict';

const assert = require('assert');
const fs = require('fs');

const styles = fs.readFileSync('miniapp/src/pages/login/privacy.scss', 'utf8');
const backRule = styles.match(/\.privacy-back\s*\{([\s\S]*?)\}/)?.[1] || '';
const placeholderRule = styles.match(/\.privacy-title-placeholder\s*\{([\s\S]*?)\}/)?.[1] || '';

assert.match(backRule, /width:\s*88rpx;/, 'privacy back control must provide a 44px-wide touch target');
assert.match(backRule, /height:\s*88rpx;/, 'privacy back control must provide a 44px-high touch target');
assert.match(
  placeholderRule,
  /width:\s*88rpx;/,
  'privacy header placeholder must match the back target so the title remains centered',
);

console.log('miniapp privacy layout contract checks passed');
