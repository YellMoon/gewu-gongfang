function roleForUser(user = {}) { return user.role || user.user_type || 'pending'; }
function tenantForUser(user = {}) { return String(user.tenantId || user.tenant_id || 'default'); }
function cleanPreview(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, 240);
}
function statusOf(question = {}) { return String(question.storage_state || question.status || 'host_committed'); }
function safeHostBaseUrl(value) { try { const url = new URL(String(value || '')); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null; return url.toString().replace(/\/$/, ''); } catch { return null; } }
function hasBoundSubject(user = {}, role = roleForUser(user)) {
  if (role === 'student') return Boolean(user.student_id || user.studentId || user.linked_student_id || user.linkedStudentId || (Array.isArray(user.linked_student_ids) && user.linked_student_ids.length) || (Array.isArray(user.linkedStudentIds) && user.linkedStudentIds.length));
  if (role === 'teacher') return Boolean(user.teacher_id || user.teacherId);
  return role === 'super_admin';
}
function buildQuestionPreviewIndex(snapshot, user = {}) {
  const payload = snapshot?.payload || {};
  const published = Array.isArray(payload.question_previews) ? payload.question_previews : null;
  const contents = new Map((Array.isArray(payload.question_contents) ? payload.question_contents : []).map(row => [String(row.question_id || row.questionId || ''), row]));
  const tenantId = tenantForUser(user); const role = roleForUser(user);
  let questions = (published || (Array.isArray(payload.questions) ? payload.questions : []))
    .filter(question => String(question.tenant_id || question.tenantId || 'default') === tenantId)
    .filter(question => role === 'super_admin' || statusOf(question) === 'host_committed')
    .map(question => {
      const content = contents.get(String(question.id)) || {};
      return { id: String(question.id), type: String(question.type || 'unknown'), stemPreview: cleanPreview(question.stemPreview || question.stem || question.content || content.stem || content.content || ''), status: statusOf(question) };
    })
    .filter(question => question.id && question.stemPreview);
  if (!hasBoundSubject(user, role)) questions = questions.slice(0, 10);
  return { snapshotId: snapshot?.id || null, version: snapshot?.version || null, createdAt: snapshot?.created_at || null, questions };
}
module.exports = { buildQuestionPreviewIndex, safeHostBaseUrl };
