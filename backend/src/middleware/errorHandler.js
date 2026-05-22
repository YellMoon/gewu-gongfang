/**
 * Unified API error helpers.
 */
function buildErrorPayload(req, status, message, options = {}) {
  const code = options.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const payload = {
    success: false,
    error: message,
    code,
    message,
    traceId: req.traceId,
  };

  if (options.details !== undefined) payload.details = options.details;
  return payload;
}

function sendError(res, status, message, options = {}) {
  const req = res.req || {};
  return res.status(status).json(buildErrorPayload(req, status, message, options));
}

function createHttpError(status, message, options = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = options.code;
  err.details = options.details;
  return err;
}

function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (res.headersSent) return;

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(buildErrorPayload(req, 400, '请求体格式错误', {
      code: 'INVALID_JSON',
    }));
  }

  const status = err.status || 500;
  const message = status >= 500 && process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : err.message;

  return res.status(status).json(buildErrorPayload(req, status, message, {
    code: err.code,
    details: err.details,
  }));
}

module.exports = {
  buildErrorPayload,
  createHttpError,
  errorHandler,
  sendError,
};
