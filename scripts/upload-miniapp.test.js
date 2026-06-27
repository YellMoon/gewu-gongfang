const assert = require('assert');
const path = require('path');

const {
  buildUploadArgs,
  resolveUploadVersion,
  resolveWechatCliPath,
} = require('./upload-miniapp');

const rootDir = path.resolve(__dirname, '..');

assert.strictEqual(
  resolveUploadVersion({ packageJson: { version: '5.0.34' } }),
  '5.0.34',
  'miniapp upload should default to the root package version'
);

assert.strictEqual(
  resolveUploadVersion({ argv: ['--version=6.1.0'], packageJson: { version: '5.0.34' } }),
  '6.1.0',
  'miniapp upload should preserve an explicit version override'
);

const args = buildUploadArgs({
  rootDir,
  version: '5.0.34',
  desc: '联调发布',
  infoOutput: 'C:/tmp/upload-info.json',
});

assert.deepStrictEqual(args.slice(0, 2), ['upload', '--project']);
assert.ok(args.includes(path.join(rootDir, 'miniapp')), 'upload should target the miniapp project directory');
assert.ok(args.includes('--version'), 'upload should pass a version');
assert.ok(args.includes('5.0.34'), 'upload should use the resolved version');
assert.ok(args.includes('--desc'), 'upload should pass a description');
assert.ok(args.includes('联调发布'), 'upload should use the provided description');
assert.ok(args.includes('--info-output'), 'upload should request machine-readable output');

assert.ok(
  /微信web开发者工具[\\/]+cli\.bat$/.test(resolveWechatCliPath({ platform: 'win32' })),
  'Windows default CLI path should point to WeChat DevTools cli.bat'
);

console.log('upload-miniapp checks passed');
