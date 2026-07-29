'use strict';

const http = require('http');
const https = require('https');

const MAX_RESPONSE_BYTES = 1024 * 1024;

function requestError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requestManagedControlPlane(url, {
  method = 'GET', headers = {}, body = null, timeoutMs = 15000,
} = {}) {
  let target;
  try {
    target = new URL(url);
  } catch (_error) {
    return Promise.reject(requestError('MANAGED_CONTROL_PLANE_URL_INVALID'));
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return Promise.reject(requestError('MANAGED_CONTROL_PLANE_PROTOCOL_INVALID'));
  }
  const requestBody = body == null ? '' : String(body);
  if (Buffer.byteLength(requestBody) > 64 * 1024) {
    return Promise.reject(requestError('MANAGED_CONTROL_PLANE_BODY_TOO_LARGE'));
  }
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        ...headers,
        ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
      },
    }, response => {
      let total = 0;
      const chunks = [];
      response.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          request.destroy(requestError('MANAGED_CONTROL_PLANE_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (_error) {
          reject(requestError('MANAGED_CONTROL_PLANE_RESPONSE_INVALID'));
          return;
        }
        resolve(Object.freeze({
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
          status: Number(response.statusCode) || 0,
          json: async () => payload,
        }));
      });
    });
    request.once('error', reject);
    request.setTimeout(Number(timeoutMs) || 15000, () => request.destroy(requestError('MANAGED_CONTROL_PLANE_TIMEOUT')));
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

module.exports = { requestManagedControlPlane };
