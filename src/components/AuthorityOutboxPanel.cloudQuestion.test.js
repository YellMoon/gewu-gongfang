const assert = require('assert');
const fs = require('fs');

const panel = fs.readFileSync('src/components/AuthorityOutboxPanel.tsx', 'utf8');
const preload = fs.readFileSync('public/preload.js', 'utf8');
const electron = fs.readFileSync('public/electron.js', 'utf8');

assert.match(panel, /readDesktopAuthorizationSession/,
  'question draft confirmation must obtain the process-memory desktop session only when the user confirms');
assert.match(panel, /sessionToken/,
  'the panel must pass only a one-time token to the Electron bridge');
assert.match(panel, /relayQuestionAssetsAfterReceipt\(item, result\.receipt\)/,
  'question rich media must be relayed only after the cloud question receipt exists');
assert.match(preload, /confirmAndSubmit:\s*\(id, input\)\s*=>\s*ipcRenderer\.invoke\('desktop-authority:confirm-and-submit', id, input\)/,
  'the preload bridge must forward an explicit one-time submission input');
assert.match(preload, /submit:\s*\(id, input\)\s*=>\s*ipcRenderer\.invoke\('desktop-authority:submit', id, input\)/,
  'a retry must use the same guarded one-time submission input path');
assert.match(electron, /ipcMain\.handle\('desktop-authority:confirm-and-submit', \(_event, id, input\)/,
  'Electron main must receive the token only for this IPC invocation');
assert.match(electron, /getDesktopAuthorityRuntime\(\)\.confirmAndSubmit\(id, input\)/,
  'Electron main must delegate question drafts to cloud-aware runtime submission');

console.log('cloud question outbox panel boundary checks passed');
