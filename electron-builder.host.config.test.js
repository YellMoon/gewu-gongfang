'use strict';

const assert = require('assert');
const path = require('path');
const packageJson = require('./package.json');

const configPath = path.join(__dirname, 'electron-builder.host.config.cjs');
const previousOutput = process.env.ELECTRON_BUILDER_OUTPUT_DIR;

try {
  process.env.ELECTRON_BUILDER_OUTPUT_DIR = 'release-host-isolated-test';
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  assert.strictEqual(
    config.directories.output,
    'release-host-isolated-test',
    'the host builder must support an isolated output directory without replacing its host configuration',
  );
} finally {
  if (previousOutput === undefined) delete process.env.ELECTRON_BUILDER_OUTPUT_DIR;
  else process.env.ELECTRON_BUILDER_OUTPUT_DIR = previousOutput;
  delete require.cache[require.resolve(configPath)];
}

assert.match(
  packageJson.scripts['dist:win:host'],
  /node scripts[\\/]wait-for-renderer-build\.js/,
  'the host release command must wait for the full renderer build before packaging',
);

console.log('primary-host builder output override checks passed');
