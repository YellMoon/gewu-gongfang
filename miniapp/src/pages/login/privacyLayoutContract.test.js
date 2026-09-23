'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const styles = fs.readFileSync('miniapp/src/pages/login/privacy.scss', 'utf8');
const page = fs.readFileSync('miniapp/src/pages/login/privacy.tsx', 'utf8');
const configSource = fs.readFileSync('miniapp/src/pages/login/privacy.config.ts', 'utf8');
const config = vm.runInNewContext(configSource.replace('export default ', ''), { definePageConfig: value => value });

// UTF-8: Let WeChat reserve the status/capsule area and provide its native back target.
assert.strictEqual(config.navigationStyle, 'default', 'privacy must use the native safe-area-aware navigation bar');
assert.strictEqual(config.navigationBarTitleText, '隐私保护指引');
assert.doesNotMatch(page, /privacy-header|privacy-back|privacy-title/, 'do not duplicate the native title or back control');
assert.doesNotMatch(styles, /privacy-header|privacy-back|privacy-title|safe-area-inset-top/, 'remove obsolete custom-navigation spacing');
assert.match(page, /privacy-content/, 'keep the guidance body');
assert.match(fs.readFileSync('miniapp/src/pages/login/index.tsx', 'utf8'), /navigateTo\(\{ url: '\/pages\/login\/privacy' \}\)/, 'open on the page stack so native back returns to login');

const loginStyles = require('fs').readFileSync(__dirname + '/index.scss', 'utf8');
const linkRules = [...loginStyles.matchAll(/\.privacy-link\s*\{([^}]+)\}/g)].map(match => match[1]).join('\n');
assert.match(linkRules, /min-height:\s*44px/, 'privacy link needs a finger-sized target, not only the text line');
assert.match(linkRules, /display:\s*inline-flex/, 'text target must respect its minimum height');
assert.match(linkRules, /align-items:\s*center/, 'keep the link text aligned within its target');
console.log('miniapp privacy layout contract checks passed');
