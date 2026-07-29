function reviewError(code) {
  return Object.assign(new Error(code), { code });
}

function requiredText(value, code, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw reviewError(code);
  return normalized;
}

export function roleReviewApplications(projection) {
  if (projection?.role !== 'super_admin') return [];
  const authorityId = requiredText(
    projection.authorityId,
    'AUTHORITY_ROLE_PROJECTION_AUTHORITY_REQUIRED',
  );
  const applications = projection.payload?.roleApplications;
  if (!Array.isArray(applications)) {
    throw reviewError('AUTHORITY_ROLE_APPLICATION_PROJECTION_INVALID');
  }
  return applications
    .map(application => {
      if (application?.authorityId !== authorityId) {
        throw reviewError('AUTHORITY_ROLE_APPLICATION_SCOPE_MISMATCH');
      }
      return Object.freeze({
        ...application,
        applicationId: requiredText(
          application.applicationId,
          'AUTHORITY_ROLE_APPLICATION_ID_INVALID',
        ),
        userId: requiredText(
          application.userId,
          'AUTHORITY_ROLE_APPLICATION_USER_INVALID',
        ),
      });
    })
    .filter(application => application.status === 'pending');
}

export function buildRoleReviewDraft(application, decision) {
  if (application?.status !== 'pending') {
    throw reviewError('AUTHORITY_ROLE_APPLICATION_NOT_PENDING');
  }
  const applicationId = requiredText(
    application.applicationId,
    'AUTHORITY_ROLE_APPLICATION_ID_INVALID',
  );
  const userId = requiredText(
    application.userId,
    'AUTHORITY_ROLE_APPLICATION_USER_INVALID',
  );
  const normalizedDecision = String(decision || '').trim();
  if (!['approve', 'reject'].includes(normalizedDecision)) {
    throw reviewError('AUTHORITY_ROLE_APPLICATION_DECISION_INVALID');
  }
  const role = String(application.requestedRole || '').trim();
  if (!['student', 'teacher'].includes(role)) {
    throw reviewError('AUTHORITY_ROLE_APPLICATION_ROLE_INVALID');
  }
  const roleLabel = role === 'teacher' ? '\u8001\u5e08' : '\u5b66\u751f';
  const bindingHint = String(application.bindingHint || '').trim();
  return Object.freeze({
    type: 'role-application.review.v1',
    payload: Object.freeze({ applicationId, decision: normalizedDecision }),
    preview: Object.freeze({
      title: `${normalizedDecision === 'approve' ? '\u6279\u51c6' : '\u62d2\u7edd'}${roleLabel}\u89d2\u8272\u7533\u8bf7`,
      summary: `${userId}${bindingHint ? ` \u00b7 ${bindingHint}` : ''}`,
    }),
  });
}

export { reviewError };
