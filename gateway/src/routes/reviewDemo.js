'use strict';

const express = require('express');
const { effectiveCapabilities } = require('../services/authorizationPolicy');
const { createReviewDemoSandbox, sandboxError } = require('../services/reviewDemoSandbox');

const DEFAULT_BODY_BYTES = 64 * 1024;
const DEFAULT_RATE_LIMIT = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_CLIENT_RATE_LIMIT = 40;
const DEFAULT_CLIENT_RATE_WINDOW_MS = 30 * 60 * 1000;
const MAX_RATE_BUCKETS = 200;

function requireReviewDemoCapability(req, res, next) {
  const capabilities = effectiveCapabilities(req.authz || {});
  if (!req.authz?.isReviewDemo || !req.authz.reviewDemoSessionId || !capabilities.includes('review-demo:paper-export')) {
    return res.status(403).json({
      success: false,
      code: 'REVIEW_DEMO_CAPABILITY_REQUIRED',
      error: 'Review paper export capability is required',
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
  };
}

function sendError(res, error) {
  const status = Number(error.statusCode || error.status || 500);
  return res.status(status).json({
    success: false,
    code: error.code || 'REVIEW_DEMO_SANDBOX_ERROR',
    error: error.message || 'Review sandbox request failed',
  });
}

function createReviewDemoRouter(options = {}) {
  const router = express.Router();
  const sandbox = options.sandbox || createReviewDemoSandbox(options.sandboxOptions);
  const now = options.now || Date.now;
  const maxBodyBytes = Number(options.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  const maxCreatesPerWindow = Number(options.maxCreatesPerWindow ?? DEFAULT_RATE_LIMIT);
  const rateWindowMs = Number(options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS);
  const maxCreatesPerClientWindow = Number(options.maxCreatesPerClientWindow ?? DEFAULT_CLIENT_RATE_LIMIT);
  const clientRateWindowMs = Number(options.clientRateWindowMs ?? DEFAULT_CLIENT_RATE_WINDOW_MS);
  const rateBuckets = new Map();

  function readBoundedBody(req, res, next) {
    if (req.body !== undefined) {
      return sendError(res, sandboxError('REVIEW_DEMO_BODY_GATE_ORDER_INVALID', 500));
    }

    const declaredHeader = req.get('content-length');
    if (declaredHeader !== undefined) {
      if (!/^\d+$/.test(declaredHeader)) {
        return sendError(res, sandboxError('REVIEW_DEMO_BODY_INVALID', 400));
      }
      const declaredBytes = Number(declaredHeader);
      if (!Number.isSafeInteger(declaredBytes)) {
        return sendError(res, sandboxError('REVIEW_DEMO_BODY_INVALID', 400));
      }
      if (declaredBytes > maxBodyBytes) {
        res.set('Connection', 'close');
        return sendError(res, sandboxError('REVIEW_DEMO_BODY_TOO_LARGE', 413));
      }
    }

    if (!req.get('transfer-encoding') && Number(declaredHeader || 0) === 0) {
      req.reviewDemoRawBody = Buffer.alloc(0);
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
      if (settled) return;
      settled = true;
      cleanup();
      return sendError(res, error);
    };
    const rejectOversized = () => {
      req.pause();
      res.set('Connection', 'close');
      return fail(sandboxError('REVIEW_DEMO_BODY_TOO_LARGE', 413));
    };
    function onAborted() {
      fail(sandboxError('REVIEW_DEMO_BODY_INVALID', 400));
    }
    function onError() {
      fail(sandboxError('REVIEW_DEMO_BODY_INVALID', 400));
    }
    function onData(chunk) {
      received += chunk.length;
      if (received > maxBodyBytes) {
        rejectOversized();
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      if (settled) return;
      settled = true;
      cleanup();
      req.reviewDemoRawBody = Buffer.concat(chunks);
      return next();
    }

    req.on('aborted', onAborted);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    return undefined;
  }

  function parseCreateJson(req, res, next) {
    const contentType = String(req.get('content-type') || '');
    const [rawMediaType, ...parameters] = contentType.split(';');
    const mediaType = rawMediaType.trim().toLowerCase();
    const jsonMediaType = mediaType === 'application/json'
      || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
    const charsetSupported = parameters.every(parameter => {
      const [name, value] = parameter.split('=').map(part => part.trim().toLowerCase());
      return name !== 'charset' || value === 'utf-8' || value === 'utf8';
    });
    if (!jsonMediaType || !charsetSupported) {
      req.reviewDemoRawBody = null;
      return sendError(res, sandboxError('REVIEW_DEMO_CONTENT_TYPE_UNSUPPORTED', 415));
    }

    try {
      const text = (req.reviewDemoRawBody || Buffer.alloc(0)).toString('utf8');
      req.body = text ? JSON.parse(text) : {};
      req.reviewDemoRawBody = null;
      return next();
    } catch (_error) {
      req.reviewDemoRawBody = null;
      return sendError(res, sandboxError('REVIEW_DEMO_BODY_INVALID', 400));
    }
  }

  function enforceCreateRate(req, res, next) {
    const current = now();
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= current) rateBuckets.delete(key);
    }
    const sessionId = String(req.authz.reviewDemoSessionId);
    const clientId = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const limits = [
      { key: `session:${sessionId}`, max: maxCreatesPerWindow, windowMs: rateWindowMs },
      { key: `client:${clientId}`, max: maxCreatesPerClientWindow, windowMs: clientRateWindowMs },
    ];
    const missingBuckets = limits.filter(limit => !rateBuckets.has(limit.key));
    if (rateBuckets.size + missingBuckets.length > MAX_RATE_BUCKETS) {
      return sendError(res, sandboxError('REVIEW_DEMO_RATE_LIMITED', 429));
    }
    for (const limit of missingBuckets) {
      rateBuckets.set(limit.key, { count: 0, resetAt: current + limit.windowMs });
    }
    const exceeded = limits
      .map(limit => ({ ...limit, bucket: rateBuckets.get(limit.key) }))
      .filter(limit => limit.bucket.count >= limit.max);
    if (exceeded.length > 0) {
      const retryAt = Math.max(...exceeded.map(limit => limit.bucket.resetAt));
      res.set('Retry-After', String(Math.max(1, Math.ceil((retryAt - current) / 1000))));
      return sendError(res, sandboxError('REVIEW_DEMO_RATE_LIMITED', 429));
    }
    for (const limit of limits) rateBuckets.get(limit.key).count += 1;
    return next();
  }

  router.use(requireReviewDemoCapability);
  router.post('/tasks', enforceCreateRate);
  router.use(readBoundedBody);

  router.post('/tasks', parseCreateJson, async (req, res) => {
    try {
      const body = req.body || {};
      const request = { ...(body.payload || {}), taskType: body.taskType };
      const task = await sandbox.create(req.authz.reviewDemoSessionId, request);
      return res.json({ success: true, task: publicTask(task) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/tasks/:taskId/result', (req, res) => {
    try {
      const task = sandbox.getTask(req.authz.reviewDemoSessionId, req.params.taskId);
      return res.json({ success: true, task: publicTask(task) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/tasks/:taskId/cancel', (req, res) => {
    try {
      const task = sandbox.cancel(req.authz.reviewDemoSessionId, req.params.taskId);
      return res.json({ success: true, task: publicTask(task) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/artifacts/:artifactId', (req, res) => {
    try {
      const artifact = sandbox.getArtifact(req.authz.reviewDemoSessionId, req.params.artifactId);
      res.set({
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
        'Content-Length': String(artifact.buffer.length),
        'Content-Type': artifact.mimeType,
      });
      return res.send(artifact.buffer);
    } catch (error) {
      return sendError(res, error);
    }
  });

  function methodNotAllowed(allow) {
    return (_req, res) => {
      res.set('Allow', allow);
      return sendError(res, sandboxError('REVIEW_DEMO_METHOD_NOT_ALLOWED', 405));
    };
  }

  router.all('/tasks', methodNotAllowed('POST'));
  router.all('/tasks/:taskId/result', methodNotAllowed('GET'));
  router.all('/tasks/:taskId/cancel', methodNotAllowed('POST'));
  router.all('/artifacts/:artifactId', methodNotAllowed('GET'));
  router.use((_req, res) => sendError(res, sandboxError('REVIEW_DEMO_ROUTE_NOT_FOUND', 404)));

  return router;
}

module.exports = { createReviewDemoRouter, publicTask, requireReviewDemoCapability };
