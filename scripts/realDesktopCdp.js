'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

function cdpError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function waitForSocketClose(socket, timeoutMs = 1_000) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener?.('close', finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, Number(timeoutMs) || 0));
    socket.once('close', finish);
    if (socket.readyState === WebSocket.CLOSED) {
      finish();
    }
  });
}

function readReplacementCdpPort(profileRoot, requestedPort) {
  if (!profileRoot) return null;
  try {
    const port = Number(String(fs.readFileSync(path.join(profileRoot, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
    if (!Number.isInteger(port) || port < 1 || port === Number(requestedPort)) return null;
    return port;
  } catch (_error) {
    return null;
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw cdpError('REAL_DESKTOP_CDP_HTTP_FAILED');
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function connectRealDesktopPage({ cdpPort, profileRoot = '', timeoutMs = 15_000 } = {}) {
  if (!Number.isInteger(cdpPort) || cdpPort < 1) throw cdpError('REAL_DESKTOP_CDP_PORT_REQUIRED');
  let effectivePort = cdpPort;
  let pages;
  try {
    pages = await fetchJson(`http://127.0.0.1:${effectivePort}/json/list`, timeoutMs);
  } catch (firstError) {
    const replacementPort = readReplacementCdpPort(profileRoot, cdpPort);
    if (!replacementPort) throw firstError;
    effectivePort = replacementPort;
    pages = await fetchJson(`http://127.0.0.1:${effectivePort}/json/list`, timeoutMs);
  }
  const pageTargets = Array.isArray(pages)
    ? pages.filter(item => item?.type === 'page' && item.webSocketDebuggerUrl)
    : [];
  const target = pageTargets.find(item => /^file:/i.test(String(item.url || '')))
    || pageTargets.find(item => !/^devtools:/i.test(String(item.url || '')))
    || pageTargets[0];
  if (!target) throw cdpError('REAL_DESKTOP_CDP_PAGE_MISSING');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(cdpError('REAL_DESKTOP_CDP_CONNECT_TIMEOUT')), timeoutMs);
    socket.once('open', () => { clearTimeout(timer); resolve(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  socket.on('message', payload => {
    let message;
    try { message = JSON.parse(String(payload)); } catch (_error) { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(cdpError(`REAL_DESKTOP_CDP_${message.error.code || 'COMMAND_FAILED'}`));
    else request.resolve(message.result);
  });
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(cdpError('REAL_DESKTOP_CDP_COMMAND_TIMEOUT'));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return Object.freeze({
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) throw cdpError('REAL_DESKTOP_CDP_EVALUATION_FAILED');
      return result.result?.value;
    },
    async close() {
      for (const request of pending.values()) request.reject(cdpError('REAL_DESKTOP_CDP_CLOSED'));
      if (socket.readyState === WebSocket.CLOSED) return;
      socket.close();
      await waitForSocketClose(socket);
    },
    send,
  });
}

async function evaluateRealDesktopPage({ cdpPort, expression, timeoutMs = 15_000 } = {}) {
  const page = await connectRealDesktopPage({ cdpPort, timeoutMs });
  try {
    return await page.evaluate(expression);
  } finally {
    await page.close().catch(() => {});
  }
}

function freshRealDesktopPage(cdpPort, timeoutMs = 15_000) {
  return Object.freeze({
    evaluate: expression => evaluateRealDesktopPage({ cdpPort, expression, timeoutMs }),
    close: async () => {},
  });
}

module.exports = { connectRealDesktopPage, evaluateRealDesktopPage, freshRealDesktopPage, cdpError, waitForSocketClose, readReplacementCdpPort };
