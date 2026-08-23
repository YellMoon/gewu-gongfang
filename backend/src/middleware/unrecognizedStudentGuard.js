'use strict';

const ALLOWED_UNRECOGNIZED_ROUTES = [
  ['GET', /^\/api\/auth\/me$/],
  ['POST', /^\/api\/auth\/refresh$/],
  ['GET', /^\/api\/miniapp\/applications\/me$/],
  ['POST', /^\/api\/miniapp\/applications$/],
  ['POST', /^\/api\/miniapp\/applications\/[^/]+\/withdraw$/],
  ['GET', /^\/api\/experience\/questions$/],
  ['POST', /^\/api\/experience\/tasks$/],
  ['GET', /^\/api\/experience\/tasks\/[^/]+\/result$/],
  ['POST', /^\/api\/experience\/tasks\/[^/]+\/cancel$/],
];

function normalizePath(pathname) {
  if (typeof pathname !== 'string') return '';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function isAllowedUnrecognizedRequest(method, pathname) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = normalizePath(pathname);
  return ALLOWED_UNRECOGNIZED_ROUTES.some(([allowedMethod, routePattern]) => (
    allowedMethod === normalizedMethod && routePattern.test(normalizedPath)
  ));
}

function unrecognizedStudentGuard(req, res, next) {
  if (req.authz?.tokenUse !== 'unrecognized-student') return next();
  const requestPath = String(req.originalUrl || req.path || '').split('?', 1)[0];
  if (isAllowedUnrecognizedRequest(req.method, requestPath)) return next();

  return res.status(403).json({
    success: false,
    code: 'UNRECOGNIZED_SCOPE_FORBIDDEN',
    error: 'Unrecognized student scope does not allow this route',
  });
}

module.exports = {
  isAllowedUnrecognizedRequest,
  unrecognizedStudentGuard,
};
