const assert = require('assert');
const { normalizeDesktopQuestionDeleteContext } = require('./desktopQuestionDeleteContext');
assert.deepStrictEqual(normalizeDesktopQuestionDeleteContext({ authContext: { deviceId: 'd', userId: 'u' } }, ['x']), { capabilities: ['x'], deviceId: 'd', userId: 'u' });
assert.deepStrictEqual(normalizeDesktopQuestionDeleteContext({ deviceId: 'd2', user: { id: 'u2' } }), { capabilities: [], deviceId: 'd2', userId: 'u2' });
console.log('desktop question delete context tests passed');
