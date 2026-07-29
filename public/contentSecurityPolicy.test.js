const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const packageJson = fs.readFileSync('package.json', 'utf8');

assert.ok(html.includes('http://localhost:*'), 'desktop CSP must allow the configured loopback backend port');
assert.ok(html.includes('http://127.0.0.1:*'), 'desktop CSP must allow the configured loopback IP backend port');
assert.ok(html.includes("connect-src 'self' https: http: http://localhost:*"),
  'desktop CSP must allow a configured private-LAN data host instead of blocking ordinary desktop pairing and sync');
assert.ok(!html.includes("connect-src *"), 'desktop CSP must not allow arbitrary network origins');
assert.ok(packageJson.includes('public/contentSecurityPolicy.test.js'), 'desktop CSP regression test must run in the desktop build gate');

console.log('desktop content security policy checks passed');
