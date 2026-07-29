const assert = require('assert');
const fs = require('fs');

const electron = fs.readFileSync('public/electron.js', 'utf8');
const preload = fs.readFileSync('public/preload.js', 'utf8');
const browserDatabase = fs.readFileSync('src/services/browserDatabase.ts', 'utf8');
const localDraftExecutor = fs.readFileSync('public/primaryHostLocalDraftExecutor.js', 'utf8');

assert.ok(electron.includes("primary-host:execute-local-draft"),
  'the primary host must expose a dedicated local authority-draft executor');
assert.ok(electron.includes("require('./primaryHostLocalDraftExecutor')")
  && electron.includes('authorityExecutor: authorityRuntime.executor')
  && electron.includes('hostAuthorityContext: () =>')
  && electron.includes('PRIMARY_HOST_LOCAL_OPERATOR_UNLOCK_REQUIRED')
  && electron.includes('projectionWorker: authorityProjectionWorker'),
  'the Electron main process must wire local drafts to the isolated authority executor');
assert.ok(localDraftExecutor.includes('hostAuthorityContext()')
  && localDraftExecutor.includes('validateEnvelope({')
  && localDraftExecutor.includes('authorityExecutor.execute(envelope)')
  && localDraftExecutor.includes("result?.receipt?.status === 'committed'")
  && localDraftExecutor.includes('projectionWorker?.wake?.()'),
  'a local host draft must use the active host grant and lease, execute through the authority executor, and wake projection publication');
assert.ok(preload.includes("executeLocalDraft: draft => ipcRenderer.invoke('primary-host:execute-local-draft', draft)"),
  'the renderer host bridge must expose only the dedicated local-draft operation');
assert.ok(browserDatabase.includes('window.primaryHostRuntime?.executeLocalDraft?.(draft)')
  && browserDatabase.includes('PRIMARY_HOST_LOCAL_DRAFT_EXECUTION_FAILED')
  && browserDatabase.includes('authority-local-draft-execution-failed'),
  'primary-host browser mutations must execute locally through the authority bridge instead of appending a client outbox item');
assert.ok(browserDatabase.includes('this.executePrimaryHostDraftBatch(drafts);')
  && browserDatabase.includes('for (const draft of drafts) {\n        const result = await window.primaryHostRuntime?.executeLocalDraft?.(draft);')
  && browserDatabase.includes('authority-local-drafts-executed'),
  'primary-host batch mutations must preserve command order and refresh once from the highest committed projection version');
require('child_process').execFileSync(process.execPath, ['public/primaryHostLocalDraftExecutor.runtime.test.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
console.log('primary host local authority draft execution checks passed');
