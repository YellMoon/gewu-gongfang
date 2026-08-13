'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverSources } = require('./sourceDiscovery');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-source-discovery-'));

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

try {
  const configuredDb = path.join(workspace, 'configured.db');
  const overrideDb = path.join(workspace, 'override.db');
  const filesRoot = path.join(workspace, 'question-files');
  fs.writeFileSync(configuredDb, 'configured', 'utf8');
  fs.writeFileSync(overrideDb, 'override', 'utf8');
  fs.mkdirSync(filesRoot);

  const runtimeConfigPath = path.join(workspace, 'runtime.json');
  writeJson(runtimeConfigPath, {
    mainDbPath: configuredDb,
    questionBankPath: filesRoot,
    questionAssetPath: '',
    desktopExportPath: '',
    offlineExportPath: '',
    secretToken: 'must-not-escape',
  });

  const result = discoverSources({
    runtimeConfigPath,
    explicit: { db: overrideDb, desktopExport: filesRoot },
  });

  assert.strictEqual(result.sources.length, 2, 'duplicate real directories should be merged');
  assert.deepStrictEqual(result.sources.map(source => source.sourceId), ['authority-db', 'question-files']);
  assert.strictEqual(result.sources[0].resolvedPath, fs.realpathSync(overrideDb));
  assert.strictEqual(result.sources[1].resolvedPath, fs.realpathSync(filesRoot));
  assert.deepStrictEqual(result.sources[1].aliases, ['desktop-export']);
  assert.ok(result.sources.every(source => /^[a-f0-9]{64}$/.test(source.pathHash)));

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(workspace));
  assert.ok(!serialized.includes('override.db'));
  assert.ok(!serialized.includes('must-not-escape'));
  assert.ok(!serialized.includes('resolvedPath'));
  assert.ok(!serialized.includes('aliases'));

  const emptyConfig = path.join(workspace, 'empty.json');
  writeJson(emptyConfig, {
    mainDbPath: '',
    questionBankPath: '',
    desktopExportPath: '',
    offlineExportPath: '',
  });
  const empty = discoverSources({ runtimeConfigPath: emptyConfig });
  assert.deepStrictEqual(empty.sources, []);
  assert.ok(!empty.sources.some(source => source.resolvedPath === process.cwd()));

  assert.throws(
    () => discoverSources({ runtimeConfigPath, explicit: { db: path.join(workspace, 'missing.db') } }),
    error => error && error.code === 'MIGRATION_SOURCE_FILE_MISSING',
  );
  assert.throws(
    () => discoverSources({ runtimeConfigPath: path.join(workspace, 'missing-config.json') }),
    error => error && error.code === 'MIGRATION_RUNTIME_CONFIG_MISSING',
  );
  assert.throws(
    () => discoverSources({}),
    error => error && error.code === 'MIGRATION_EXPLICIT_SOURCE_REQUIRED',
  );

  console.log('explicit migration source discovery checks passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
