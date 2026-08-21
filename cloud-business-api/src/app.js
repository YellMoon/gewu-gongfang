'use strict';

const express = require('express');

function createCloudBusinessApp({ query }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', async (_request, response) => {
    try {
      await query('SELECT 1 AS ok');
      response.json({ ok: true, database: 'postgresql', businessAuthority: 'cloud' });
    } catch (_) {
      response.status(503).json({ ok: false, database: 'unavailable' });
    }
  });
  return app;
}

module.exports = Object.freeze({ createCloudBusinessApp });
