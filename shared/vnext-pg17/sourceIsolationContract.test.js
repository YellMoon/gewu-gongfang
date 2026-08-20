'use strict';

const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT_ERROR = 'VNEXT_PG17_LEGACY_SOURCE_ISOLATION_VIOLATION';
const COPY_ONLY_FILE = 'controlPlaneCopyOnlyRehearsal.js';
const FORBIDDEN_IMPORTS = [
  /scripts\/vnext-migration\b/i,
  /migrationBundleProtocol\b/i,
  /\bbackend\//i,
  /\bminiapp\//i,
  /\b(?:sourceDiscovery|sqliteSnapshot|sqliteInventory|fileInventory|bundleWriter|sealedMigrationBundle|sourceRecoveryPackage)\b/i,
];
const FORBIDDEN_BUILTINS = new Set(['fs', 'path', 'os', 'net', 'http', 'https', 'tls', 'dgram']);
const SQLITE_ESCAPE = /\b(?:ATTACH|loadExtension|backup|VACUUM\s+INTO)\b/i;

function isolationError() {
  return Object.assign(new Error(CONTRACT_ERROR), { code: CONTRACT_ERROR });
}

function literalModuleImports(source) {
  const imports = [];
  const remainder = source.replace(/(^|[^\w$.])require\s*\(\s*(['"])([^'"]+)\2\s*\)/gm, (match, prefix, quote, moduleId) => {
    imports.push(Object.freeze({ kind: 'commonjs', moduleId }));
    return prefix;
  }).replace(/\brequire\.main\b/g, '');
  if (/\brequire\b/.test(remainder)) throw isolationError();
  return Object.freeze(imports);
}

function isForbiddenBuiltin(moduleId) {
  return FORBIDDEN_BUILTINS.has(moduleId.replace(/^node:/, '').split('/')[0]);
}

function assertRuntimeSourceIsolation(sources) {
  const entries = Object.entries(sources);
  if (entries.length === 0 || entries.some(([name, source]) => typeof name !== 'string' || typeof source !== 'string')) throw isolationError();
  let sqliteImportCount = 0;
  let sqliteConstructorCount = 0;
  for (const [name, source] of entries) {
    if (/\bimport\b/.test(source)
      || FORBIDDEN_IMPORTS.some(pattern => pattern.test(source))) throw isolationError();
    const imports = literalModuleImports(source);
    if (imports.some(item => isForbiddenBuiltin(item.moduleId))) throw isolationError();
    const sqliteImports = imports.filter(item => item.moduleId === 'better-sqlite3');
    if (sqliteImports.length > 0 && (name !== COPY_ONLY_FILE || sqliteImports.some(item => item.kind !== 'commonjs'))) throw isolationError();
    sqliteImportCount += sqliteImports.length;
    if (name === COPY_ONLY_FILE) {
      if (SQLITE_ESCAPE.test(source)) throw isolationError();
      const constructors = source.match(/new\s+Database\s*\(/g) || [];
      sqliteConstructorCount += constructors.length;
      if ((source.match(/new\s+Database\s*\(\s*['"]:memory:['"]\s*\)/g) || []).length !== constructors.length) throw isolationError();
    }
  }
  if (sqliteImportCount !== 1 || sqliteConstructorCount !== 1) throw isolationError();
}

function currentRuntimeSources(root = __dirname) {
  const realRoot = fs.realpathSync(root);
  const sources = {};
  function collect(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw isolationError();
      if (entry.isDirectory()) {
        collect(candidate);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) continue;
      const realCandidate = fs.realpathSync(candidate);
      const relative = path.relative(realRoot, realCandidate);
      if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw isolationError();
      sources[relative.split(path.sep).join('/')] = fs.readFileSync(realCandidate, 'utf8');
    }
  }
  collect(realRoot);
  return Object.fromEntries(Object.entries(sources).sort(([left], [right]) => left.localeCompare(right)));
}

function withSyntheticRuntimeTree(files, callback) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gewu-vnext-pg17-isolation-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source, 'utf8');
    }
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runSourceIsolationContractCases() {
  const sources = currentRuntimeSources();
  assert.doesNotThrow(() => assertRuntimeSourceIsolation(sources));
  const control = sources[COPY_ONLY_FILE];
  assert.match(control, /require\(\s*['"]better-sqlite3['"]\s*\)/);
  assert.match(control, /new\s+Database\s*\(\s*['"]:memory:['"]\s*\)/);

  for (const source of [
    "const legacy = require('../../scripts/vnext-migration/sourceDiscovery');",
    "const legacy = require('../migrationBundleProtocol');",
    "const db = require('../../backend/src/database');",
    "const source = require(pathName);",
    "const source = require('./' + sourceName);",
    "const source = require(`better-sqlite3`);",
    "const source = import(pathName);",
    "const fs = require('node:fs');",
    "import fs from 'node:fs';",
    "import Database from 'better-sqlite3';",
    "import{readFile}from'node:fs';",
    "import*as Database from'better-sqlite3';",
  ]) {
    assert.throws(() => assertRuntimeSourceIsolation({ ...sources, 'fakeRuntime.js': source }), error => error?.code === CONTRACT_ERROR);
  }
  assert.throws(() => assertRuntimeSourceIsolation({ ...sources, 'anotherRuntime.js': "const Database = require('better-sqlite3');" }), error => error?.code === CONTRACT_ERROR);
  assert.throws(() => assertRuntimeSourceIsolation({ ...sources, [COPY_ONLY_FILE]: control.replace("':memory:'", "'C:/legacy.sqlite'") }), error => error?.code === CONTRACT_ERROR);
  assert.throws(() => assertRuntimeSourceIsolation({ ...sources, [COPY_ONLY_FILE]: control + "\nDatabase.prototype.loadExtension('unsafe');" }), error => error?.code === CONTRACT_ERROR);
  for (const [nestedFile, nestedSource] of [
    ['legacy/source.js', "const source = require('../../scripts/vnext-migration/sourceDiscovery');"],
    ['legacy/sqlite.js', "const Database = require('better-sqlite3');"],
    ['legacy/files.js', "const fs = require('node:fs');"],
  ]) {
    withSyntheticRuntimeTree({
      [COPY_ONLY_FILE]: control,
      'entry.js': "require('./legacy/source');",
      [nestedFile]: nestedSource,
    }, root => assert.throws(() => assertRuntimeSourceIsolation(currentRuntimeSources(root)), error => error?.code === CONTRACT_ERROR));
  }
  console.log('vNext PG17 legacy source isolation contract checks passed');
}

if (require.main === module) {
  try {
    runSourceIsolationContractCases();
  } catch (error) {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { runSourceIsolationContractCases };
