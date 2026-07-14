'use strict';

const SAFE_READ_PATHS = new Set([
  '/api/permissions/my',
  '/api/modules',
  '/api/cloud/snapshots/read',
  '/api/cloud/snapshots/questions',
]);

function requestPath(req) {
  return String(req.originalUrl || req.path || '').split('?')[0];
}

function reviewDemoGuard(req, res, next) {
  if (!req.authz?.isReviewDemo) return next();
  const path = requestPath(req);
  if (path.startsWith('/api/review-demo/')) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase()) && SAFE_READ_PATHS.has(path)) return next();
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
  return res.status(403).json({
    success: false,
    code: read ? 'REVIEW_DEMO_ROUTE_FORBIDDEN' : 'REVIEW_DEMO_READ_ONLY',
    error: read ? 'This route is not available in review mode' : 'Review mode is read only',
  });
}

module.exports = { SAFE_READ_PATHS, reviewDemoGuard };
