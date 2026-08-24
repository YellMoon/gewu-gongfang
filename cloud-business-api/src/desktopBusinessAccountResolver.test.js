'use strict';

const assert = require('assert');
const { selectDesktopBusinessAccount } = require('./desktopBusinessAccountResolver');

const pendingDirect = { accountId: 'canonical-id', roles: [] };
const phoneMerged = { accountId: 'legacy-id', roles: ['super_admin'] };
assert.strictEqual(selectDesktopBusinessAccount({ directAccount: pendingDirect, phoneAccount: phoneMerged }), phoneMerged);
assert.strictEqual(selectDesktopBusinessAccount({ directAccount: pendingDirect, phoneAccount: null }), pendingDirect);
assert.strictEqual(selectDesktopBusinessAccount({ directAccount: null, phoneAccount: null }), null);
console.log('desktop business account resolver checks passed');
