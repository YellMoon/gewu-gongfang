'use strict';

const assert = require('assert');
const { selectDesktopBusinessAccount, desktopSessionRoles } = require('./desktopBusinessAccountResolver');

const visitorDirect = { accountId: 'canonical-id', roles: [] };
const phoneMerged = { accountId: 'legacy-id', roles: ['super_admin'] };
assert.strictEqual(selectDesktopBusinessAccount({ directAccount: visitorDirect, phoneAccount: phoneMerged }), phoneMerged);
assert.strictEqual(selectDesktopBusinessAccount({ directAccount: visitorDirect, phoneAccount: null }), visitorDirect);
assert.strictEqual(selectDesktopBusinessAccount({ directAccount: null, phoneAccount: null }), null);
assert.deepStrictEqual(desktopSessionRoles(['admin', 'super_admin']), ['super_admin']);
assert.deepStrictEqual(desktopSessionRoles(['admin']), ['visitor']);
assert.deepStrictEqual(desktopSessionRoles(['student']), ['visitor'], 'the teacher desktop must not open a student-only account');
assert.deepStrictEqual(desktopSessionRoles(), ['visitor']);
console.log('desktop business account resolver checks passed');
