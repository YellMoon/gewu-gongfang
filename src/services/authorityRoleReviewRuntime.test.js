const assert = require('assert');

(async () => {
  const {
    buildAdminGrantDraft,
    buildRoleReviewDraft,
    roleReviewApplications,
  } = await import('./authorityRoleReviewRuntime.mjs');

  const projection = {
    authorityId: 'authority-1',
    role: 'super_admin',
    payload: {
      roleApplications: [
        {
          applicationId: 'application-1',
          authorityId: 'authority-1',
          userId: 'visitor-1',
          requestedRole: 'teacher',
          bindingHint: 'teacher-optional',
          status: 'pending',
        },
        {
          applicationId: 'application-2',
          authorityId: 'authority-1',
          userId: 'visitor-2',
          requestedRole: 'student',
          status: 'approved',
        },
      ],
    },
  };
  assert.deepStrictEqual(
    roleReviewApplications(projection).map(item => item.applicationId),
    ['application-1'],
  );
  assert.deepStrictEqual(
    buildRoleReviewDraft(projection.payload.roleApplications[0], 'approve'),
    {
      type: 'role-application.review.v1',
      payload: { applicationId: 'application-1', decision: 'approve' },
      preview: {
        title: '\u6279\u51c6\u8001\u5e08\u89d2\u8272\u7533\u8bf7',
        summary: 'visitor-1 \u00b7 teacher-optional',
      },
    },
  );
  assert.deepStrictEqual(
    buildRoleReviewDraft(projection.payload.roleApplications[0], 'reject').payload,
    { applicationId: 'application-1', decision: 'reject' },
  );
  assert.deepStrictEqual(
    buildAdminGrantDraft('existing-user-1'),
    {
      type: 'role-admin.grant.v1',
      payload: { userId: 'existing-user-1' },
      preview: {
        title: '\u6388\u4e88\u7ba1\u7406\u5458\u89d2\u8272',
        summary: 'existing-user-1',
      },
    },
    'direct administrator grants must be explicit host commands for an existing immutable user id',
  );
  assert.deepStrictEqual(
    roleReviewApplications({ ...projection, role: 'admin' }),
    [],
    'ordinary admins must never receive the host role-review workbench',
  );
  assert.throws(
    () => roleReviewApplications({
      ...projection,
      payload: {
        roleApplications: [{
          ...projection.payload.roleApplications[0],
          authorityId: 'authority-other',
        }],
      },
    }),
    error => error.code === 'AUTHORITY_ROLE_APPLICATION_SCOPE_MISMATCH',
  );
  assert.throws(
    () => buildRoleReviewDraft(projection.payload.roleApplications[1], 'approve'),
    error => error.code === 'AUTHORITY_ROLE_APPLICATION_NOT_PENDING',
  );
  assert.throws(
    () => buildAdminGrantDraft(''),
    error => error.code === 'AUTHORITY_ROLE_APPLICATION_USER_INVALID',
  );

  console.log('authority role review runtime tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
