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
assert.ok(!panel.includes('authorityMessage:'),
  'the outbox must not show users an implementation-level cloud authority slogan');
assert.ok(!panel.includes('authorityDescription:'),
  'the outbox must not show users architecture internals as persistent guidance');
assert.ok(panel.includes('\\u5f85\\u63d0\\u4ea4\\u7684\\u66f4\\u6539'),
  'the outbox title must describe the user action rather than the implementation');
assert.ok(!panel.includes('\\u4e91\\u7aef\\u6743\\u5a01\\u6570\\u636e\\u540c\\u6b65'),
  'the outbox must not expose cloud-authority implementation wording');
assert.ok(!panel.includes('wsTitle:'),
  'the outbox must not show users retired LAN-host architecture messaging');
assert.match(panel, /student\|course\|schedule\|teacher\|room\|institution\|school\|payment\|consumption\|grade\|personal-asset-record\|personal-asset-category/,
  'the one-time cloud session boundary must include every known business draft family');
assert.ok(!panel.includes('cloudQuestionSubmissionInput'),
  'the renderer must not keep a question-only token path that omits business drafts');
assert.match(panel, /relayQuestionAssetsAfterReceipt\(item, result\.receipt\)/,
  'question rich media must be relayed only after the cloud question receipt exists');
assert.match(panel, /client\.readAssetRelay\(state\.taskId\)/,
  'a locally queued relay must be checked against the NAS verification receipt before it is treated as complete');
assert.match(panel, /assetVerificationPending/,
  'the UI must clearly state that related attachments are still being checked');
assert.match(panel, /hasPendingQuestionAssetVerification\(item\)/,
  'completed question commands with unverified media must remain visibly pending');
assert.match(panel, /item\.status === 'completed' && !hasPendingQuestionAssetVerification\(item\)/,
  'a question command must not enter the completed count before every media receipt is verified');
assert.match(panel, /questionTextCommitted/,
  'the command receipt must distinguish question completion from pending attachment checks');
assert.ok(panel.includes("actionConfirm: '\\u67e5\\u770b\\u5e76\\u786e\\u8ba4'"),
  'an unconfirmed change must offer a clear review-and-confirm action instead of a content label');
for (const implementationCopy of [
  '\\u4e91\\u7aef\\u63d0\\u4ea4',
  ' NAS ',
  '\\u5bcc\\u5a92\\u4f53',
]) assert.ok(!panel.includes(implementationCopy),
  `the outbox must not expose storage implementation wording: ${implementationCopy}`);
assert.match(preload, /confirmAndSubmit:\s*\(id, input\)\s*=>\s*ipcRenderer\.invoke\('desktop-authority:confirm-and-submit', id, input\)/,
  'the preload bridge must forward an explicit one-time submission input');
assert.match(preload, /submit:\s*\(id, input\)\s*=>\s*ipcRenderer\.invoke\('desktop-authority:submit', id, input\)/,
  'a retry must use the same guarded one-time submission input path');
assert.match(electron, /ipcMain\.handle\('desktop-authority:confirm-and-submit', \(_event, id, input\)/,
  'Electron main must receive the token only for this IPC invocation');
assert.match(electron, /getDesktopAuthorityRuntime\(\)\.confirmAndSubmit\(id, input\)/,
  'Electron main must delegate question drafts to cloud-aware runtime submission');

console.log('cloud question outbox panel boundary checks passed');
