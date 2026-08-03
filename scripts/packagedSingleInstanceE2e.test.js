'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'packaged-single-instance-e2e.js'), 'utf8');
assert.doesNotThrow(() => new Function(source));
assert.ok(source.includes('tmp-packaged-single-instance-'));
assert.ok(source.includes('--user-data-dir='));
assert.ok(source.includes('SECOND_INSTANCE_EXIT_REQUIRED'));
assert.ok(source.includes('SECOND_INSTANCE_PROCESS_LEAK'));
assert.ok(source.includes('FIRST_INSTANCE_BACKEND_LOST'));
assert.match(source, /const health = await waitFor\(async \(\) => \{\s*const response = await fetch\(`http:\/\/127\.0\.0\.1:\$\{port\}\/api\/health`\);\s*return response\.ok \? response : null;\s*\}, 'FIRST_INSTANCE_BACKEND_LOST'\);/,
  'the final first-instance health proof must tolerate a bounded cross-install handoff race');
assert.ok(source.includes('GEWU_PACKAGED_SECOND_EXE'),
  'packaged acceptance must allow a caller-supplied second executable root');
assert.ok(source.includes('SECOND_PACKAGED_EXE_REQUIRED'),
  'the optional second executable must be validated independently');
assert.ok(source.includes('SECOND_EXECUTABLE_ROOT_MUST_DIFFER'),
  'an explicit second executable must prove a cross-install root');
assert.ok(source.includes('PACKAGED_FLAVOR_MISMATCH'),
  'ordinary and primary-host package flavors must never be cross-tested');
assert.ok(source.includes('childProcess.spawn(secondExecutable, args'),
  'the second launch must use the caller-supplied executable while reusing the isolated profile args');
assert.ok(source.includes('cwd: path.dirname(secondExecutable), env'),
  'the second launch cwd must follow its own executable root while reusing the isolated environment');
assert.strictEqual(source.includes('copyFileSync'), false,
  'the acceptance script must not copy installation trees on behalf of the caller');
assert.ok(source.includes('function prepareRuntimeConfig('),
  'packaged single-instance E2E must prepare an explicit disposable runtime config');
assert.ok(source.includes("flavor === 'primary-host' ? 'primary-host' : 'desktop-client'"),
  'the disposable runtime role must follow the packaged build flavor');
assert.ok(source.includes('hostBaseUrl: `http://127.0.0.1:${backendPort}`'),
  'primary-host acceptance must probe the same isolated port selected through hostBaseUrl');
assert.ok(source.includes('taskkill') && source.includes("['/PID', String(pid), '/F']"));
assert.ok(source.includes('$_.ProcessId -ne $PID'),
  'the PowerShell inventory must not classify its own query process as a disposable Electron process');
assert.strictEqual(source.includes("'/T'"), false,
  'single-instance cleanup must stop only exact profile PIDs rather than broad process trees');

console.log('packaged single-instance E2E contract checks passed');
