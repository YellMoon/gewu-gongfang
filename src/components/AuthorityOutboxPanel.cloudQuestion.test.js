const assert = require('assert');
const fs = require('fs');

const panel = fs.readFileSync('src/components/AuthorityOutboxPanel.tsx', 'utf8');
const preload = fs.readFileSync('public/preload.js', 'utf8');
const electron = fs.readFileSync('public/electron.js', 'utf8');

assert.match(panel, /readDesktopAuthorizationSession/,
  'question draft confirmation must obtain the process-memory desktop session only when the user confirms');
assert.match(panel, /sessionToken/,
  'the panel must pass only a one-time token to the Electron bridge');
assert.match(panel, /function cloudDraftSubmissionInput/,
  'question and business drafts must share the one-time cloud session input boundary');
assert.match(panel, /student\|course\|schedule\|teacher\|room\|institution\|school\|payment\|consumption\|grade\|personal-asset-record\|personal-asset-category/,
  'the one-time cloud session boundary must include every known business draft family');
assert.ok(!panel.includes('cloudQuestionSubmissionInput'),
  'the renderer must not keep a question-only token path that omits business drafts');
assert.match(panel, /relayQuestionAssetsAfterReceipt\(item, result\.receipt\)/,
  'question rich media must be relayed only after the cloud question receipt exists');
assert.match(panel, /client\.readAssetRelay\(state\.taskId\)/,
  'a locally queued relay must be checked against the NAS verification receipt before it is treated as complete');
assert.match(panel, /assetVerificationPending/,
  'the UI must clearly state that a cloud relay is still pending NAS verification');
assert.match(panel, /hasPendingQuestionAssetVerification\(item\)/,
  'completed question commands with unverified media must remain visibly pending');
assert.match(panel, /item\.status === 'completed' && !hasPendingQuestionAssetVerification\(item\)/,
  'a question command must not enter the completed count before every media receipt is verified');
assert.match(panel, /questionTextCommitted/,
  'the command receipt must distinguish cloud text completion from NAS media verification');
assert.match(preload, /confirmAndSubmit:\s*\(id, input\)\s*=>\s*ipcRenderer\.invoke\('desktop-authority:confirm-and-submit', id, input\)/,
  'the preload bridge must forward an explicit one-time submission input');
assert.match(preload, /submit:\s*\(id, input\)\s*=>\s*ipcRenderer\.invoke\('desktop-authority:submit', id, input\)/,
  'a retry must use the same guarded one-time submission input path');
assert.match(electron, /ipcMain\.handle\('desktop-authority:confirm-and-submit', \(_event, id, input\)/,
  'Electron main must receive the token only for this IPC invocation');
assert.match(electron, /getDesktopAuthorityRuntime\(\)\.confirmAndSubmit\(id, input\)/,
  'Electron main must delegate question drafts to cloud-aware runtime submission');

console.log('cloud question outbox panel boundary checks passed');
