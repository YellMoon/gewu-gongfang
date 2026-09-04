'use strict';

const assert = require('assert');
const { cloudSessionUser } = require('../pages/login/cloudSessionIdentityRuntime');
const { isFormalIdentity } = require('./accountExperience');
const { deriveAccess, roleOf, scopeDashboardCollections } = require('./miniappAuthorizationRuntime');
const { canOpenMiniappRoute } = require('./miniappRouteAccess');
const { getMiniappHomeRoleLabel } = require('./miniappHomePresentation');
const { resolveTabBarState } = require('../custom-tab-bar/roleTabBarRuntime');

const family = cloudSessionUser({
  accountId: 'family-account-1',
  status: 'active',
  roles: ['family_member'],
  profile: { type: 'student', id: 'student-1', relationship: 'guardian' },
});
assert.deepStrictEqual(family, {
  id: 'family-account-1', cloud_account_id: 'family-account-1',
  role: 'family_member', user_type: 'family_member', identity_kind: 'family_member',
  student_relationship: 'guardian', account_state: 'formal', token_use: 'miniapp-cloud',
  student_id: 'student-1', linked_student_ids: ['student-1'],
});
assert.strictEqual(isFormalIdentity(family), true);
assert.strictEqual(roleOf(family), 'family_member');
assert.strictEqual(getMiniappHomeRoleLabel(family), '家庭成员');

const identityKey = require('./miniappAuthorizationRuntime').permissionIdentityKey(family);
const access = deriveAccess(family, { status: 'loaded', identityKey, capabilities: ['question-bank:view'] });
assert.strictEqual(access.role, 'family_member');
assert.deepStrictEqual(access.modules, ['scheduling', 'question-bank']);
assert.strictEqual(canOpenMiniappRoute('/pages/student-detail/index?id=student-1', access), true);
assert.strictEqual(canOpenMiniappRoute('/pages/payments/index', access), false);
assert.deepStrictEqual(resolveTabBarState(access), { userType: 'family_member', navigationMode: 'formal' });

const scoped = scopeDashboardCollections(family, {
  students: [{ id: 'student-1' }, { id: 'student-2' }],
  courses: [{ id: 'course-1', student_pricings: [{ student_id: 'student-1' }] }, { id: 'course-2', student_pricings: [{ student_id: 'student-2' }] }],
  schedules: [{ id: 'schedule-1', course_id: 'course-1' }, { id: 'schedule-2', course_id: 'course-2' }],
});
assert.deepStrictEqual(scoped.students.map(item => item.id), ['student-1']);
assert.deepStrictEqual(scoped.courses.map(item => item.id), ['course-1']);
assert.deepStrictEqual(scoped.schedules.map(item => item.id), ['schedule-1']);

console.log('miniapp family-member canonical role checks passed');
