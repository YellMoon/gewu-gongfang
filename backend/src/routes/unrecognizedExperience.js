'use strict';

const fs = require('fs');
const express = require('express');
const contentTypeParser = require('content-type');
const { UNRECOGNIZED_TOKEN_USE } = require('../services/miniappIdentityService');
const { listUnrecognizedExperienceQuestions } = require('../services/unrecognizedExperienceData');
const {
  createUnrecognizedExperienceSandbox,
  experienceError,
} = require('../services/unrecognizedExperienceSandbox');

const DEFAULT_BODY_BYTES = 64 * 1024;
const DEFAULT_RATE_LIMIT = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_CLIENT_RATE_LIMIT = 40;
const DEFAULT_CLIENT_RATE_WINDOW_MS = 30 * 60 * 1000;
const MAX_RATE_BUCKETS = 200;

function requireUnrecognizedExperienceIdentity(req, res, next) {
  const authz = req.authz || {};
  if (authz.tokenUse !== UNRECOGNIZED_TOKEN_USE
    || authz.accountState !== 'unrecognized'
    || authz.clientType !== 'miniapp'
    || !authz.sessionId) {
    return res.status(403).json({
      success: false,
      code: 'UNRECOGNIZED_EXPERIENCE_SCOPE_REQUIRED',
      error: 'A verified unrecognized-student session is required',
    });
  }
  return next();
}

function publicTask(task) {
  return {
    id: task.id,
    status: task.status,
    phase: task.phase,
    progress: task.progress,
    createdAt: task.createdAt,
    created_at: task.createdAt,
    expiresAt: task.expiresAt,
    result_expires_at: task.expiresAt,
    request: task.request,
    result: task.result,
    result_payload: task.result,
    error: task.error || null,
  };
}

function sendError(res, error) {
  const status = Number(error?.statusCode || error?.status || 500);
  return res.status(status).json({
    success: false,
    code: error?.code || 'UNRECOGNIZED_EXPERIENCE_ERROR',
    error: error?.message || 'Experience request failed',
  });
}

function contentTypeParameterNames(value) {
  const segments = [];
  let segment = '';
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      escaped = false;
      segment += character;
    } else if (quoted && character === '\\') {
      escaped = true;
      segment += character;
    } else if (character === '"') {
      quoted = !quoted;
      segment += character;
    } else if (character === ';' && !quoted) {
      segments.push(segment);
      segment = '';
    } else {
      segment += character;
    }
  }
  segments.push(segment);
  return segments.slice(1).map(parameter => {
    const equalsAt = parameter.indexOf('=');
    return equalsAt < 0 ? '' : parameter.slice(0, equalsAt).trim().toLowerCase();
  });
}

function createUnrecognizedExperienceRouter(options = {}) {
  const router = express.Router();
  const sandbox = options.sandbox || createUnrecognizedExperienceSandbox(options.sandboxOptions);
  const now = options.now || Date.now;
  const maxBodyBytes = Number(options.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  const maxCreatesPerWindow = Number(options.maxCreatesPerWindow ?? DEFAULT_RATE_LIMIT);
  const rateWindowMs = Number(options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS);
  const maxCreatesPerClientWindow = Number(options.maxCreatesPerClientWindow ?? DEFAULT_CLIENT_RATE_LIMIT);
  const clientRateWindowMs = Number(options.clientRateWindowMs ?? DEFAULT_CLIENT_RATE_WINDOW_MS);
  const rateBuckets = new Map();

  function readBoundedBody(req, res, next) {
    if (req.body !== undefined) {
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_BODY_GATE_ORDER_INVALID', 500));
    }
    const declaredHeader = req.get('content-length');
    if (declaredHeader !== undefined) {
      if (!/^\d+$/.test(declaredHeader)) {
        return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_BODY_INVALID', 400));
      }
      const declaredBytes = Number(declaredHeader);
      if (!Number.isSafeInteger(declaredBytes)) {
        return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_BODY_INVALID', 400));
      }
      if (declaredBytes > maxBodyBytes) {
        res.set('Connection', 'close');
        return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_BODY_TOO_LARGE', 413));
      }
    }
    if (!req.get('transfer-encoding') && Number(declaredHeader || 0) === 0) {
      req.unrecognizedExperienceRawBody = Buffer.alloc(0);
      return next();
    }

    let received = 0;
    let settled = false;
    const chunks = [];
    const cleanup = () => {
      req.removeListener('aborted', onAborted);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };
    const fail = error => {
      if (settled) return undefined;
      settled = true;
      cleanup();
      return sendError(res, error);
    };
    const rejectOversized = () => {
      req.pause();
      res.set('Connection', 'close');
      return fail(experienceError('UNRECOGNIZED_EXPERIENCE_BODY_TOO_LARGE', 413));
    };
    function onAborted() { fail(experienceError('UNRECOGNIZED_EXPERIENCE_BODY_INVALID', 400)); }
    function onError() { fail(experienceError('UNRECOGNIZED_EXPERIENCE_BODY_INVALID', 400)); }
    function onData(chunk) {
      received += chunk.length;
      if (received > maxBodyBytes) { rejectOversized(); return; }
      chunks.push(chunk);
    }
    function onEnd() {
      if (settled) return;
      settled = true;
      cleanup();
      req.unrecognizedExperienceRawBody = Buffer.concat(chunks);
      next();
    }
    req.on('aborted', onAborted);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    return undefined;
  }

  function parseCreateJson(req, res, next) {
    const contentType = String(req.get('content-type') || '');
    let parsedContentType;
    try {
      parsedContentType = contentTypeParser.parse(contentType);
    } catch (_error) {
      req.unrecognizedExperienceRawBody = null;
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_CONTENT_TYPE_UNSUPPORTED', 415));
    }
    const mediaType = parsedContentType.type.toLowerCase();
    const jsonMediaType = mediaType === 'application/json'
      || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
    const charsetParameters = contentTypeParameterNames(contentType).filter(name => name === 'charset');
    const charset = parsedContentType.parameters.charset;
    if (!jsonMediaType || charsetParameters.length > 1
      || (charset !== undefined && charset.toLowerCase() !== 'utf-8')) {
      req.unrecognizedExperienceRawBody = null;
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_CONTENT_TYPE_UNSUPPORTED', 415));
    }
    try {
      const source = (req.unrecognizedExperienceRawBody || Buffer.alloc(0)).toString('utf8');
      req.body = source ? JSON.parse(source) : {};
      req.unrecognizedExperienceRawBody = null;
      return next();
    } catch (_error) {
      req.unrecognizedExperienceRawBody = null;
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_BODY_INVALID', 400));
    }
  }

  function enforceCreateRate(req, res, next) {
    const current = now();
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= current) rateBuckets.delete(key);
    }
    const sessionId = String(req.authz.sessionId);
    const clientId = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const limits = [
      { key: `session:${sessionId}`, max: maxCreatesPerWindow, windowMs: rateWindowMs },
      { key: `client:${clientId}`, max: maxCreatesPerClientWindow, windowMs: clientRateWindowMs },
    ];
    const missing = limits.filter(limit => !rateBuckets.has(limit.key));
    if (rateBuckets.size + missing.length > MAX_RATE_BUCKETS) {
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_RATE_LIMITED', 429));
    }
    for (const limit of missing) {
      rateBuckets.set(limit.key, { count: 0, resetAt: current + limit.windowMs });
    }
    const exceeded = limits
      .map(limit => ({ ...limit, bucket: rateBuckets.get(limit.key) }))
      .filter(limit => limit.bucket.count >= limit.max);
    if (exceeded.length) {
      const retryAt = Math.max(...exceeded.map(limit => limit.bucket.resetAt));
      res.set('Retry-After', String(Math.max(1, Math.ceil((retryAt - current) / 1000))));
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_RATE_LIMITED', 429));
    }
    for (const limit of limits) rateBuckets.get(limit.key).count += 1;
    return next();
  }

  router.use(requireUnrecognizedExperienceIdentity);
  router.use(readBoundedBody);

  router.get('/questions', (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ success: true, questions: listUnrecognizedExperienceQuestions() });
  });

  router.post('/tasks', parseCreateJson, enforceCreateRate, (req, res) => {
    try {
      const body = req.body || {};
      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : {};
      const task = sandbox.create(req.authz.sessionId, { ...payload, taskType: body.taskType });
      return res.status(202).json({ success: true, task: publicTask(task) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/tasks/:taskId/result', (req, res) => {
    try {
      const task = sandbox.getTask(req.authz.sessionId, req.params.taskId);
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, task: publicTask(task) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/tasks/:taskId/cancel', (req, res) => {
    try {
      const task = sandbox.cancel(req.authz.sessionId, req.params.taskId);
      return res.json({ success: true, task: publicTask(task) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/artifacts/:artifactId', (req, res) => {
    try {
      const artifact = sandbox.getArtifact(req.authz.sessionId, req.params.artifactId);
      const bytes = fs.readFileSync(artifact.filePath);
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
        'Content-Length': String(bytes.length),
        'Content-Type': artifact.mimeType,
      });
      return res.send(bytes);
    } catch (error) {
      return sendError(res, error);
    }
  });

  function methodNotAllowed(allow) {
    return (_req, res) => {
      res.set('Allow', allow);
      return sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_METHOD_NOT_ALLOWED', 405));
    };
  }

  router.all('/questions', methodNotAllowed('GET'));
  router.all('/tasks', methodNotAllowed('POST'));
  router.all('/tasks/:taskId/result', methodNotAllowed('GET'));
  router.all('/tasks/:taskId/cancel', methodNotAllowed('POST'));
  router.all('/artifacts/:artifactId', methodNotAllowed('GET'));
  router.use((_req, res) => sendError(res, experienceError('UNRECOGNIZED_EXPERIENCE_ROUTE_NOT_FOUND', 404)));

  return router;
}

module.exports = {
  createUnrecognizedExperienceRouter,
  publicTask,
  requireUnrecognizedExperienceIdentity,
};
