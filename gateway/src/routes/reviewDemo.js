'use strict';

const express = require('express');
const { effectiveCapabilities } = require('../services/authorizationPolicy');
const { createReviewDemoSandbox, sandboxError } = require('../services/reviewDemoSandbox');

const DEFAULT_BODY_BYTES = 64 * 1024;
const DEFAULT_RATE_LIMIT = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const MAX_RATE_BUCKETS = 100;

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
  const rateBuckets = new Map();

  function parseBoundedCreateBody(req, res, next) {
    const declaredBytes = Number(req.get('content-length') || 0);
    if (declaredBytes > maxBodyBytes) {
      res.set('Connection', 'close');
      return sendError(res, sandboxError('REVIEW_DEMO_BODY_TOO_LARGE', 413));
    }

    if (req.body !== undefined) {
      const parsedBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
      if (parsedBytes > maxBodyBytes) return sendError(res, sandboxError('REVIEW_DEMO_BODY_TOO_LARGE', 413));
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
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        req.body = text ? JSON.parse(text) : {};
        return next();
      } catch (_error) {
        return sendError(res, sandboxError('REVIEW_DEMO_BODY_INVALID', 400));
      }
    }

    req.on('aborted', onAborted);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    return undefined;
  }

  function enforceCreateRate(req, res, next) {
    const current = now();
    for (const [sessionId, bucket] of rateBuckets) {
      if (bucket.resetAt <= current) rateBuckets.delete(sessionId);
    }
    const sessionId = String(req.authz.reviewDemoSessionId);
    let bucket = rateBuckets.get(sessionId);
    if (!bucket) {
      if (rateBuckets.size >= MAX_RATE_BUCKETS) {
        return sendError(res, sandboxError('REVIEW_DEMO_RATE_LIMITED', 429));
      }
      bucket = { count: 0, resetAt: current + rateWindowMs };
      rateBuckets.set(sessionId, bucket);
    }
    if (bucket.count >= maxCreatesPerWindow) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))));
      return sendError(res, sandboxError('REVIEW_DEMO_RATE_LIMITED', 429));
    }
    bucket.count += 1;
    return next();
  }

  router.use(requireReviewDemoCapability);

  router.post('/tasks', enforceCreateRate, parseBoundedCreateBody, async (req, res) => {
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

  return router;
}

module.exports = { createReviewDemoRouter, publicTask, requireReviewDemoCapability };
