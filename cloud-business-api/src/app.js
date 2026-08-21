'use strict';

const express = require('express');

function createCloudBusinessApp({ query, desktopRegistration = null }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  if (desktopRegistration && (typeof desktopRegistration.begin !== 'function' || typeof desktopRegistration.register !== 'function')) throw new TypeError('desktopRegistration is invalid');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', async (_request, response) => {
    try {
      await query('SELECT 1 AS ok');
      response.json({ ok: true, database: 'postgresql', businessAuthority: 'cloud' });
    } catch (_) {
      response.status(503).json({ ok: false, database: 'unavailable' });
    }
  });
  function desktopUnavailable(response) {
    response.status(503).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE' });
  }
  function identityFailure(response, error) {
    if (error && error.code === 'CLOUD_ONLINE_IDENTITY_INVALID') {
      response.status(400).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_INPUT_INVALID' });
      return;
    }
    if (error && error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED') {
      response.status(403).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
      return;
    }
    desktopUnavailable(response);
  }
  app.post('/api/desktop/online-verification', async (request, response) => {
    if (!desktopRegistration) return desktopUnavailable(response);
    try {
      const result = await desktopRegistration.begin(request.body);
      response.json({ ok: true, verificationToken: result.verificationToken });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/desktop/online-registration', async (request, response) => {
    if (!desktopRegistration) return desktopUnavailable(response);
    try {
      const result = await desktopRegistration.register(request.body);
      response.json({ ok: true, receiptId: result.receiptId, sessionId: result.sessionId, replayed: result.replayed, sessionToken: result.sessionToken });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  return app;
}

module.exports = Object.freeze({ createCloudBusinessApp });
