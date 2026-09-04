const assert = require('assert');
const { normalizeDesktopQuestionDeleteContext } = require('./desktopQuestionDeleteContext');
const { verifyNativeQuestionDraft, issueNativeQuestionDraft } = require('./desktopQuestionDeleteContext');
assert.deepStrictEqual(normalizeDesktopQuestionDeleteContext({ authContext: { deviceId: 'd', userId: 'u' } }, ['x']), { capabilities: ['x'], deviceId: 'd', userId: 'u' });
assert.deepStrictEqual(normalizeDesktopQuestionDeleteContext({ deviceId: 'd2', user: { id: 'u2' } }), { capabilities: [], deviceId: 'd2', userId: 'u2' });
assert.deepStrictEqual(
  normalizeDesktopQuestionDeleteContext({ authContext: { deviceId: 'd3', userId: 'u3', activeRole: 'teacher' } }),
  { capabilities: ['question-bank:view', 'question-bank:edit', 'question-bank:delete-committed'], deviceId: 'd3', userId: 'u3' },
  'a verified cloud teacher session must provide the desktop question permissions without the embedded permission endpoint',
);
assert.deepStrictEqual(
  normalizeDesktopQuestionDeleteContext({ authContext: { deviceId: 'd4', userId: 'u4', activeRole: 'super_admin' } }),
  { capabilities: ['question-bank:view', 'question-bank:edit', 'question-bank:delete-committed'], deviceId: 'd4', userId: 'u4' },
);
assert.deepStrictEqual(
  normalizeDesktopQuestionDeleteContext({ authContext: { deviceId: 'd5', userId: 'u5', activeRole: 'student' } }),
  { capabilities: [], deviceId: 'd5', userId: 'u5' },
  'non-teacher desktop roles must fail closed',
);
console.log('desktop question delete context tests passed');
(async()=>{assert.strictEqual(await verifyNativeQuestionDraft('q',{authorization:'Bearer t'},null),false);assert.strictEqual(await verifyNativeQuestionDraft('q',{authorization:'Bearer t'},{verifyDraft:async()=>false}),false);assert.strictEqual(await verifyNativeQuestionDraft('q',{authorization:'Bearer t'},{verifyDraft:async()=>true}),true);assert.strictEqual(await issueNativeQuestionDraft({authorization:'Bearer t'},{issueDraft:async()=>({questionId:'issued'})}),'issued');})().catch(e=>{console.error(e);process.exit(1)});
