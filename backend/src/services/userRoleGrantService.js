const { roleForUser } = require('./authorizationPolicy');

const GRANT_ROLES = Object.freeze(['super_admin', 'teacher', 'student']);
const ROLE_DISPLAY_ORDER = Object.freeze(['super_admin', 'teacher', 'student']);
const DEFAULT_ACTIVE_ROLE_ORDER = Object.freeze(['teacher', 'student', 'super_admin']);

function roleGrantError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function activeUser(user) {
  return Boolean(user)
    && !String(user.id || '').startsWith('review-demo:')
    && user.deleted !== 1
    && user.deleted !== true
    && user.status !== 0
    && user.status !== false
    && user.login_enabled !== 0
    && user.login_enabled !== false
    && user.review_status === 'approved';
}

function subjectForRole(db, user, role) {
  if (role === 'teacher') {
    const teacherId = String(user.teacher_id || '').trim();
    const teacher = teacherId && tableExists(db, 'teachers')
      ? db.prepare('SELECT id FROM teachers WHERE id=? AND deleted=0').get(teacherId)
      : null;
    if (!teacher) throw roleGrantError('TEACHER_ROLE_SUBJECT_INVALID');
    return { subjectType: 'teacher', subjectId: teacher.id };
  }
  if (role === 'student') {
    const studentId = String(user.student_id || '').trim();
    const student = studentId && tableExists(db, 'students')
      ? db.prepare('SELECT id FROM students WHERE id=? AND deleted=0').get(studentId)
      : null;
    if (!student) throw roleGrantError('STUDENT_ROLE_SUBJECT_INVALID');
    return { subjectType: 'student', subjectId: student.id };
  }
  return { subjectType: null, subjectId: null };
}

function desiredRolesForUser(db, user) {
  if (!activeUser(user)) return [];
  const primaryRole = roleForUser(user);
  if (!GRANT_ROLES.includes(primaryRole)) return [];
  const roles = [primaryRole];
  if (primaryRole === 'super_admin' && user.teacher_id) roles.push('teacher');
  return [...new Set(roles)].map(function (role) {
    return { role, ...subjectForRole(db, user, role) };
  });
}

function storeGrant(db, user, desired, now) {
  const existing = db.prepare(
    'SELECT * FROM user_role_grants WHERE user_id=? AND role=?'
  ).get(user.id, desired.role);
  if (existing && existing.status !== 'active') return 'unchanged';
  if (existing && existing.status === 'active') {
    if ((existing.subject_type || null) !== desired.subjectType
      || (existing.subject_id || null) !== desired.subjectId) {
      throw roleGrantError('ROLE_GRANT_SUBJECT_MISMATCH');
    }
    return 'unchanged';
  }
  try {
    db.prepare(`INSERT INTO user_role_grants
      (user_id, role, subject_type, subject_id, status, source, granted_by,
       created_at, updated_at, revoked_at)
      VALUES (?, ?, ?, ?, 'active', 'compatibility-migration', NULL, ?, ?, NULL)`)
      .run(user.id, desired.role, desired.subjectType, desired.subjectId, now, now);
    return 'inserted';
  } catch (error) {
    if (desired.role === 'teacher' && String(error.code || '').includes('SQLITE_CONSTRAINT')) {
      throw roleGrantError('TEACHER_ROLE_SUBJECT_CONFLICT');
    }
    throw error;
  }
}

function ensureCompatibilityRoleGrants(db, options = {}) {
  if (!db || !tableExists(db, 'user_role_grants')) throw roleGrantError('USER_ROLE_GRANTS_TABLE_REQUIRED');
  const now = options.now || new Date().toISOString();
  const counts = { inserted: 0, reactivated: 0, unchanged: 0, retired: 0 };
  const migrate = db.transaction(function () {
    // `admin` was a legacy transport role, never a product role. Preserve its
    // audit row but remove any live authority before deriving current grants.
    counts.retired += db.prepare(`UPDATE user_role_grants
      SET status='revoked', revoked_at=COALESCE(revoked_at, ?), updated_at=?
      WHERE role='admin' AND status='active'`).run(now, now).changes;
    const users = db.prepare('SELECT * FROM users WHERE deleted=0 ORDER BY id').all();
    for (const user of users) {
      for (const desired of desiredRolesForUser(db, user)) {
        counts[storeGrant(db, user, desired, now)] += 1;
      }
    }
  });
  migrate();
  return counts;
}

function listUserRoleGrants(db, userId, options = {}) {
  const where = options.includeInactive ? '' : " AND status='active'";
  const rows = db.prepare(`SELECT * FROM user_role_grants WHERE user_id=?${where}`).all(userId);
  return rows.sort(function (left, right) {
    return ROLE_DISPLAY_ORDER.indexOf(left.role) - ROLE_DISPLAY_ORDER.indexOf(right.role);
  });
}

function assertActiveRole(db, user, requestedRole) {
  if (!activeUser(user)) throw roleGrantError('ROLE_IDENTITY_NOT_ACTIVE');
  const grants = listUserRoleGrants(db, user.id);
  const eligibleRoles = grants.map(function (grant) { return grant.role; });
  const activeRole = requestedRole || DEFAULT_ACTIVE_ROLE_ORDER.find(function (role) {
    return eligibleRoles.includes(role);
  });
  const grant = grants.find(function (candidate) { return candidate.role === activeRole; });
  if (!grant) throw roleGrantError('ACTIVE_ROLE_NOT_GRANTED');
  return Object.freeze({
    activeRole,
    eligibleRoles: Object.freeze(eligibleRoles.slice()),
    teacherId: activeRole === 'teacher' ? grant.subject_id : null,
    studentId: activeRole === 'student' ? grant.subject_id : null,
  });
}

function roleContextForUser(db, userId, requestedRole) {
  const user = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0').get(userId);
  const roleContext = assertActiveRole(db, user, requestedRole);
  return Object.freeze({ userId: user.id, ...roleContext });
}

function resolveUserRoleContext(db, userId, requestedRole) {
  return roleContextForUser(db, userId, requestedRole);
}

module.exports = {
  GRANT_ROLES,
  assertActiveRole,
  ensureCompatibilityRoleGrants,
  listUserRoleGrants,
  roleContextForUser,
  resolveUserRoleContext,
};
