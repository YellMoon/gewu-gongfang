const assert = require('assert');
const { normalizeDesktopQuestionDeleteContext } = require('./desktopQuestionDeleteContext');
const { verifyNativeQuestionDraft, issueNativeQuestionDraft } = require('./desktopQuestionDeleteContext');
assert.deepStrictEqual(normalizeDesktopQuestionDeleteContext({ authContext: { deviceId: 'd', userId: 'u' } }, ['x']), { capabilities: ['x'], deviceId: 'd', userId: 'u' });
assert.deepStrictEqual(normalizeDesktopQuestionDeleteContext({ deviceId: 'd2', user: { id: 'u2' } }), { capabilities: [], deviceId: 'd2', userId: 'u2' });
console.log('desktop question delete context tests passed');
(async()=>{assert.strictEqual(await verifyNativeQuestionDraft('q',{authorization:'Bearer t'},null),false);assert.strictEqual(await verifyNativeQuestionDraft('q',{authorization:'Bearer t'},{verifyDraft:async()=>false}),false);assert.strictEqual(await verifyNativeQuestionDraft('q',{authorization:'Bearer t'},{verifyDraft:async()=>true}),true);assert.strictEqual(await issueNativeQuestionDraft({authorization:'Bearer t'},{issueDraft:async()=>({questionId:'issued'})}),'issued');})().catch(e=>{console.error(e);process.exit(1)});
