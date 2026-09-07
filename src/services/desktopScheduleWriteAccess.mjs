// UI affordance only: the cloud rechecks ownership in the write transaction.
export function hasDesktopScheduleWriteAccess(context) {
  if (!context || !Array.isArray(context.eligibleRoles)
    || !context.eligibleRoles.includes(context.activeRole)) return false;
  if (context.activeRole === 'super_admin') return true;
  return context.activeRole === 'teacher' && typeof context.teacherId === 'string'
    && context.teacherId.length > 0 && context.teacherId === context.teacherId.trim();
}
