'use strict';

const assert = require('assert');
const { canOpenMiniappRoute, moduleForMiniappRoute } = require('./miniappRouteAccess');

const staff = { role: 'teacher', modules: ['scheduling', 'students', 'courses', 'teachers', 'payments', 'stats', 'assets'], capabilities: ['question-bank:view'] };
const student = { role: 'student', modules: ['scheduling', 'question-bank'], capabilities: ['question-bank:view'] };
const visitor = { role: 'visitor', modules: ['question-bank', 'settings'], capabilities: ['question-preview:read'] };

assert.strictEqual(moduleForMiniappRoute('/pages/assets/index?from=shortcut'), 'assets');
assert.strictEqual(canOpenMiniappRoute('/pages/assets/index', student), false, 'students must not deep-link into personal-asset imports');
assert.strictEqual(canOpenMiniappRoute('/pages/stats/index', visitor), false, 'visitors must not deep-link into staff analytics');
assert.strictEqual(canOpenMiniappRoute('/pages/student-detail/index?id=student-1', student), true, 'students may open their own scoped detail page');
assert.strictEqual(canOpenMiniappRoute('/pages/schedule/edit/index', student), true, 'the read-only schedule boundary remains available to students');
assert.strictEqual(canOpenMiniappRoute('/pages/question-bank/index', visitor), true, 'visitors retain the cloud question preview route');
assert.strictEqual(canOpenMiniappRoute('/pages/courses/index', staff), true);
assert.strictEqual(canOpenMiniappRoute('/pages/login/index', visitor), true, 'unmapped routes remain available to their owning page');

console.log('miniapp route access checks passed');
