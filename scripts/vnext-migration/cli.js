#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const path = require('path');
const { createInventoryManifest, validateLedgerEntry } = require('../../shared/migrationBundleProtocol');
const { version } = require('../../package.json');
const { verifyInventoryBundle, writeInventoryBundle } = require('./bundleWriter');
const { inventoryFiles } = require('./fileInventory');
const {
  assertDisjointPaths,
  assertSafeOutputRoot,
} = require('./pathSafety');
const { discoverSources } = require('./sourceDiscovery');
const { inventorySqlite } = require('./sqliteInventory');

function cliError(code) {
  return Object.assign(new Error(code), { code });
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  const allowed = command === 'inventory'
    ? new Set(['json', 'runtime-config', 'db', 'files', 'question-assets', 'desktop-export', 'offline-export', 'local-cache', 'nas-backup', 'output', 'max-files', 'max-bytes'])
    : command === 'verify' ? new Set(['json', 'bundle']) : new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (!token.startsWith('--')) throw cliError('MIGRATION_ARGUMENT_INVALID');
    const key = token.slice(2);
    if (!allowed.has(key)) throw cliError('MIGRATION_ARGUMENT_UNKNOWN');
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) throw cliError('MIGRATION_ARGUMENT_VALUE_REQUIRED');
    if (Object.prototype.hasOwnProperty.call(options, key)) throw cliError('MIGRATION_ARGUMENT_DUPLICATE');
    options[key] = value;
    index += 1;
  }
  return { command: String(command || ''), options };
}

function positiveInteger(value, fallback, code) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw cliError(code);
  return number;
}

function bundleId(now) {
  const time = now.toISOString().replace(/[^0-9]/g, '').slice(0, 17);
  return `inventory-${time}-${crypto.randomBytes(4).toString('hex')}`;
}

function publicSource(source) {
  return {
    sourceId: source.sourceId,
    kind: source.kind,
    pathHash: source.pathHash,
    label: source.label,
  };
}

async function inventoryCommand(options) {
  if (!options.output) throw cliError('MIGRATION_OUTPUT_REQUIRED');
  const discovery = discoverSources({
    runtimeConfigPath: options['runtime-config'],
    explicit: {
      db: options.db,
      files: options.files,
      questionAssets: options['question-assets'],
      desktopExport: options['desktop-export'],
      offlineExport: options['offline-export'],
      localCache: options['local-cache'],
      nasBackup: options['nas-backup'],
    },
  });
  if (!discovery.sources.length) throw cliError('MIGRATION_SOURCES_REQUIRED');

  const output = assertSafeOutputRoot(options.output);
  const comparisonSources = discovery.sources.flatMap(source => (
    source.kind === 'sqlite' ? [source.resolvedPath, path.dirname(source.resolvedPath)] : [source.resolvedPath]
  ));
  assertDisjointPaths({ sources: comparisonSources, output });

  const maxFiles = positiveInteger(options['max-files'], 100000, 'MIGRATION_FILE_COUNT_LIMIT_INVALID');
  const maxBytes = positiveInteger(options['max-bytes'], 1024 ** 4, 'MIGRATION_FILE_BYTES_LIMIT_INVALID');
  const reports = {};
  const unresolved = discovery.unavailable.map(source => ({
    sourceId: source.sourceId,
    code: source.code,
    pathHash: source.pathHash,
  }));
  const ledger = [];

  for (const source of discovery.sources) {
    const report = source.kind === 'sqlite'
      ? inventorySqlite({ dbPath: source.resolvedPath, includeRowHashes: true })
      : await inventoryFiles({ root: source.resolvedPath, maxFiles, maxBytes });
    reports[source.sourceId] = report;
    for (const item of report.unresolved || []) unresolved.push({ sourceId: source.sourceId, ...item });
    ledger.push(validateLedgerEntry({
      sourceId: source.sourceId,
      sourceType: source.kind,
      sourceRecordId: null,
      sourceHash: report.inventoryHash,
      status: 'discovered',
      targetType: null,
      targetRecordId: null,
      targetHash: null,
      conflictCode: null,
    }));
  }

  const now = new Date();
  const manifest = createInventoryManifest({
    bundleId: bundleId(now),
    createdAt: now.toISOString(),
    sourceVersion: `scheduling-system-${version}`,
    sources: discovery.sources.map(publicSource),
  });
  const result = writeInventoryBundle({
    bundlePath: output,
    manifest,
    inventory: { schemaVersion: 1, sources: reports },
    ledger,
    unresolved,
  });
  return {
    ok: true,
    command: 'inventory',
    bundleId: result.bundleId,
    bundleHash: result.bundleHash,
    sourceIds: discovery.sources.map(source => source.sourceId),
    unresolvedCount: unresolved.length,
  };
}

function verifyCommand(options) {
  if (!options.bundle) throw cliError('MIGRATION_BUNDLE_PATH_REQUIRED');
  const result = verifyInventoryBundle({ bundlePath: options.bundle });
  return { ok: true, command: 'verify', ...result };
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  if (command === 'inventory') return inventoryCommand(options);
  if (command === 'verify') return verifyCommand(options);
  throw cliError('MIGRATION_COMMAND_INVALID');
}

if (require.main === module) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    const code = String(error?.code || 'MIGRATION_UNEXPECTED_ERROR');
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
    if (process.env.GEWU_MIGRATION_DEBUG === '1' && process.env.NODE_ENV !== 'production') {
      process.stderr.write(`${error?.stack || code}\n`);
    }
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments };
