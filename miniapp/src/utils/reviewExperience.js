const REVIEW_ROLES = new Set(['admin', 'student']);
const REVIEW_TASK_CACHE_PREFIX = 'review_demo_question_paper_tasks_v1';

function roleOf(identity) {
  return String(identity && (identity.user_type || identity.role) || '');
}

function isReviewExperienceIdentity(identity) {
  if (!identity) return false;
  const role = roleOf(identity);
  const sessionId = typeof identity.review_demo_session_id === 'string'
    ? identity.review_demo_session_id.trim() : '';
  return Boolean(identity.is_review_demo === true
    && identity.read_only === true
    && REVIEW_ROLES.has(role)
    && (!identity.role || identity.role === role)
    && (!identity.user_type || identity.user_type === role)
    && sessionId
    && identity.id === `review-demo:${role}:${sessionId}`
    && identity.review_status === 'approved'
    && (identity.status === 1 || identity.status === true)
    && (identity.login_enabled === 1 || identity.login_enabled === true));
}

function safeKeyPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function reviewSessionIdentityKey(identity) {
  if (!isReviewExperienceIdentity(identity)) return '';
  return `review-demo:${roleOf(identity)}:${safeKeyPart(identity.review_demo_session_id)}`;
}

function reviewTaskCacheKey(identity) {
  const sessionIdentity = reviewSessionIdentityKey(identity);
  if (!sessionIdentity) return '';
  return `${REVIEW_TASK_CACHE_PREFIX}_${sessionIdentity.replace(/:/g, '_')}`;
}

function requireResourceId(operation, resourceId) {
  if (!resourceId) throw new Error(`${operation} requires a resource id`);
  return encodeURIComponent(String(resourceId));
}

function experienceApiPath(identity, operation, resourceId) {
  const review = isReviewExperienceIdentity(identity);
  if (operation === 'snapshot') return '/api/cloud/snapshots/read?snapshotType=full';
  if (operation === 'questionPreview') return '/api/cloud/snapshots/questions';
  if (operation === 'createTask') return review ? '/api/review-demo/tasks' : '/api/cloud/tasks';
  if (operation === 'taskResult') {
    const taskId = requireResourceId(operation, resourceId);
    return review ? `/api/review-demo/tasks/${taskId}/result` : `/api/cloud/tasks/${taskId}/result`;
  }
  if (operation === 'cancelTask') {
    const taskId = requireResourceId(operation, resourceId);
    return review ? `/api/review-demo/tasks/${taskId}/cancel` : `/api/cloud/tasks/${taskId}/cancel`;
  }
  if (operation === 'artifact') {
    if (!review) throw new Error('review artifacts require a review identity');
    return `/api/review-demo/artifacts/${requireResourceId(operation, resourceId)}`;
  }
  throw new Error(`unsupported experience API operation: ${operation}`);
}

function reviewCleanupStorageKeys(identity) {
  const keys = ['auth_token', 'user_info', 'user_permissions'];
  const taskKey = reviewTaskCacheKey(identity);
  if (taskKey) keys.push(`sch_${taskKey}`);
  return keys;
}

function reviewLoginErrorMessage(code, detail = '') {
  const messages = {
    REVIEW_DEMO_CODE_INVALID: '\u5ba1\u6838\u4f53\u9a8c\u7801\u65e0\u6548\uff0c\u8bf7\u6838\u5bf9\u63d0\u5ba1\u8bf4\u660e',
    REVIEW_DEMO_ROLE_INVALID: '\u8bf7\u9009\u62e9\u7ba1\u7406\u5458\u6216\u5b66\u751f\u5ba1\u6838\u4f53\u9a8c',
    REVIEW_DEMO_DISABLED: '\u5ba1\u6838\u4f53\u9a8c\u6682\u672a\u542f\u7528\uff0c\u8bf7\u8054\u7cfb\u5f00\u53d1\u8005',
    REVIEW_DEMO_RATE_LIMITED: '\u5ba1\u6838\u4f53\u9a8c\u5c1d\u8bd5\u6b21\u6570\u8fc7\u591a\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5',
    REVIEW_DEMO_TOKEN_INVALID: '\u5ba1\u6838\u4f53\u9a8c\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u8fdb\u5165',
  };
  if (messages[code]) return messages[code];
  if (/\u7f51\u7edc|\u8fde\u63a5\u5931\u8d25|timeout|\u8d85\u65f6|request:fail/i.test(String(detail || ''))) {
    return '\u7f51\u7edc\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5';
  }
  return '\u5ba1\u6838\u4f53\u9a8c\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5';
}

module.exports = {
  REVIEW_TASK_CACHE_PREFIX,
  experienceApiPath,
  isReviewExperienceIdentity,
  reviewCleanupStorageKeys,
  reviewLoginErrorMessage,
  reviewSessionIdentityKey,
  reviewTaskCacheKey,
};
