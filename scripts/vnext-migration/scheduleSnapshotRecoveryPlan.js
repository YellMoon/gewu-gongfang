'use strict';

// This module makes a read-only proposal. It has no database, network or apply path.
// Historical snapshots are evidence, not values to reconstruct from today's course.
const { createHash } = require('node:crypto');
const SNAPSHOT_FIELDS = Object.freeze(['billing_unit', 'teacher_fee_mode', 'teacher_id', 'teacher_name']);
const hash = value => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const nonBlank = value => typeof value === 'string' && value.trim() === value && value.length > 0;
function invalid() { throw new Error('INVALID_BASELINE'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function instant(value, requireZone = false) {
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || (requireZone && !match[8])) invalid();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part || 0));
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) invalid();
  // Legacy SQLite and desktop wall times are Asia/Shanghai, independent of this machine's TZ.
  const zone = match[8] || '+08:00';
  const zh = zone === 'Z' ? 0 : Number(zone.slice(1, 3)), zm = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (zh > 14 || zm > 59 || (zh === 14 && zm !== 0)) invalid();
  const offset = (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm);
  return BigInt(wall.valueOf() - offset * 60000) * 1000000n + BigInt((match[7] || '').padEnd(9, '0'));
}
function decimal(value) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(text)) invalid();
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const a = whole.replace(/^0+(?=\d)/, ''), b = fraction.replace(/0+$/, '');
  return `${text[0] === '-' && (a !== '0' || b) ? '-' : ''}${a}${b ? '.' + b : ''}`;
}
function array(value) {
  if (typeof value === 'string') value = JSON.parse(value);
  if (!Array.isArray(value)) invalid();
  return value;
}
function baseline(row) {
  if (!nonBlank(row.course_id) || !Number.isSafeInteger(row.status)) invalid();
  const start = instant(row.start_time), end = instant(row.end_time);
  if (end <= start) invalid();
  const ids = array(row.student_ids).slice().sort();
  if (ids.some(id => !nonBlank(id)) || new Set(ids).size !== ids.length) invalid();
  const roster = array(row.student_pricings).map(pricing => {
    if (!pricing || !nonBlank(pricing.student_id)) invalid();
    if (pricing.status === null || pricing.attendance_status === null) invalid();
    if (pricing.status !== undefined && pricing.attendance_status !== undefined && pricing.status !== pricing.attendance_status) invalid();
    const status = pricing.status ?? pricing.attendance_status ?? 1;
    if (![1, 2, 3, 4].includes(status)) invalid();
    return { id: pricing.student_id, tuition: decimal(pricing.tuition), teacherFee: decimal(pricing.teacher_fee), status };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (new Set(roster.map(item => item.id)).size !== roster.length) invalid();
  if (ids.length && JSON.stringify(ids) !== JSON.stringify(roster.map(item => item.id).sort())) invalid();
  return { courseId: row.course_id, start: String(start), end: String(end), status: row.status,
    roster, tuition: decimal(row.calculated_tuition), teacherFee: decimal(row.calculated_teacher_fee) };
}
function index(rows) {
  if (!Array.isArray(rows)) throw new Error('ROWS_REQUIRED');
  const result = new Map();
  for (const row of rows) {
    if (!row || !nonBlank(row.id)) throw new Error('ROW_ID_REQUIRED');
    result.set(row.id, result.has(row.id) ? null : row);
  }
  return result;
}
function sourceBaseline(row, courses, tenantId) {
  // Match coreSchedulingSourceContract: NULL/empty override means original course roster.
  const explicit = row.student_pricings === null || row.student_pricings === '' ? [] : array(row.student_pricings);
  let roster = explicit;
  if (!explicit.length) {
    const course = courses.get(row.course_id);
    if (!course || course.tenant_id !== tenantId || (course.deleted !== 0 && course.deleted !== false)) invalid();
    roster = course.student_pricings === null || course.student_pricings === '' ? [] : array(course.student_pricings);
    // Course pricing has no attendance column; the original migration assigns normal (1).
    roster = roster.map(item => ({ student_id: item.student_id, tuition: item.tuition, teacher_fee: item.teacher_fee, status: 1 }));
  }
  return baseline({ ...row, student_pricings: roster, student_ids: row.student_ids === null || row.student_ids === '' ? [] : row.student_ids });
}

function buildScheduleSnapshotRecoveryPlan(input) {
  if (!input || !nonBlank(input.tenantId) || !Array.isArray(input.cloudTeacherIds)) throw new Error('SCOPE_REQUIRED');
  for (const key of ['cacheSha256', 'sourceSha256', 'cloudSha256']) {
    if (!/^[a-f0-9]{64}$/.test(input.evidence?.[key])) throw new Error('EVIDENCE_REQUIRED');
  }
  if (input.sourceCourses !== undefined && !/^[a-f0-9]{64}$/.test(input.evidence.sourceCoursesSha256)) throw new Error('COURSE_EVIDENCE_REQUIRED');
  const cache = index(input.cacheSchedules), source = index(input.sourceSchedules), cloud = index(input.cloudSchedules);
  const sourceCourses = index(input.sourceCourses || []);
  const teachers = new Set(input.cloudTeacherIds), candidates = [], decisions = [];
  for (const id of [...cache.keys()].sort()) {
    const cached = cache.get(id), original = source.get(id), current = cloud.get(id);
    const record = (reason, fields) => decisions.push({ id, reason, ...(fields ? { fields } : {}) });
    if (!cached) { record('DUPLICATE_CACHE_ID'); continue; }
    const present = SNAPSHOT_FIELDS.filter(key => cached[key] !== undefined && cached[key] !== null);
    if (!present.length) { record('NO_EXPLICIT_CACHE_SNAPSHOT'); continue; }
    if (present.length !== SNAPSHOT_FIELDS.length) { record('CACHE_SNAPSHOT_INCOMPLETE'); continue; }
    if (![1, 2].includes(cached.billing_unit) || ![1, 2].includes(cached.teacher_fee_mode) || !nonBlank(cached.teacher_id) || !nonBlank(cached.teacher_name) || cached.teacher_name.length > 4096) { record('CACHE_SNAPSHOT_INVALID'); continue; }
    if (!source.has(id)) { record('SOURCE_RECORD_MISSING'); continue; }
    if (!original) { record('DUPLICATE_SOURCE_ID'); continue; }
    if (original.tenant_id !== input.tenantId || (cached.tenant_id !== undefined && cached.tenant_id !== input.tenantId)) { record('SOURCE_TENANT_MISMATCH'); continue; }
    if (original.deleted !== 0 && original.deleted !== false) { record('SOURCE_DELETED'); continue; }
    if (cached.deleted !== undefined && cached.deleted !== false && cached.deleted !== 0) { record('CACHE_DELETED'); continue; }
    if (!cloud.has(id)) { record('CLOUD_RECORD_MISSING'); continue; }
    if (!current) { record('DUPLICATE_CLOUD_ID'); continue; }
    if (current.tenant_id !== undefined && current.tenant_id !== input.tenantId) { record('CLOUD_TENANT_MISMATCH'); continue; }
    if (current.deleted !== false && current.deleted !== 0) { record('CLOUD_DELETED'); continue; }
    let a, b, c;
    try { a = baseline(cached); } catch { record('CACHE_BASELINE_INVALID'); continue; }
    try { b = sourceBaseline(original, sourceCourses, input.tenantId); } catch { record('SOURCE_BASELINE_INVALID'); continue; }
    try { c = baseline(current); } catch { record('CLOUD_BASELINE_INVALID'); continue; }
    const differences = (left, right) => Object.keys(left).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
    const cacheDiff = differences(a, b), cloudDiff = differences(b, c);
    if (cacheDiff.length) { record('CACHE_SOURCE_DIFFERENCE', cacheDiff); continue; }
    if (cloudDiff.length) { record('SOURCE_CLOUD_DIFFERENCE', cloudDiff); continue; }
    try { instant(current.updated_at, true); } catch { record('CLOUD_VERSION_MISSING_OR_INVALID'); continue; }
    const patch = Object.fromEntries(SNAPSHOT_FIELDS.map(key => [key, cached[key]]));
    const existing = SNAPSHOT_FIELDS.some(key => current[key] !== undefined && current[key] !== null);
    if (existing) {
      record(SNAPSHOT_FIELDS.every(key => current[key] === patch[key]) ? 'ALREADY_RESTORED' : 'CLOUD_SNAPSHOT_CONFLICT');
      continue;
    }
    try {
      if (instant(original.updated_at, true) !== instant(current.updated_at, true)) { record('CLOUD_VERSION_DIVERGED'); continue; }
    } catch { record('SOURCE_VERSION_INVALID'); continue; }
    if (!teachers.has(patch.teacher_id)) { record('SNAPSHOT_TEACHER_NOT_IN_CLOUD'); continue; }
    candidates.push({ id, tenantId: input.tenantId, patch, expectedUpdatedAt: current.updated_at,
      baselineSha256: hash(canonical(current)), sourceBaselineSha256: hash(canonical({ row: original, effectiveBaseline: b })), cacheRecordSha256: hash(canonical(cached)) });
    record('CANDIDATE');
  }
  const counts = {};
  for (const item of decisions) counts[item.reason] = (counts[item.reason] || 0) + 1;
  return { version: 1, mode: 'read_only_proposal', tenantId: input.tenantId,
    evidence: Object.fromEntries(['cacheSha256', 'sourceSha256', 'cloudSha256', ...(input.sourceCourses ? ['sourceCoursesSha256'] : [])].map(key => [key, input.evidence[key]])),
    cloudSnapshotFieldsProjected: input.cloudSchedules.length > 0 && input.cloudSchedules.every(row => SNAPSHOT_FIELDS.every(key => Object.hasOwn(row, key))),
    counts, candidates, decisions };
}

module.exports = { buildScheduleSnapshotRecoveryPlan };
