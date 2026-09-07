'use strict';

// Derived from the authenticated desktop session, never from the REST body.
function scheduleActorParameters(scope) {
  if (scope?.role === 'super_admin' && scope.teacherId === null) return ['super_admin', null];
  if (scope?.role === 'teacher' && typeof scope.teacherId === 'string'
    && scope.teacherId && scope.teacherId === scope.teacherId.trim()) return ['teacher', scope.teacherId];
  throw Object.assign(new Error('Schedule actor scope is required'), { code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
}

module.exports = { scheduleActorParameters };
