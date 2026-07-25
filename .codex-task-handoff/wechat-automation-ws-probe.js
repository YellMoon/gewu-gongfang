'use strict';

const WebSocket = require('../output/miniapp-automation/node_modules/ws');

const endpoint = process.argv[2] || 'ws://127.0.0.1:9430';
const method = process.argv[3] || 'Tool.getInfo';
const socket = new WebSocket(endpoint);
const timeout = setTimeout(() => {
  console.log(JSON.stringify({ endpoint, opened: socket.readyState === WebSocket.OPEN, response: false }));
  socket.terminate();
  process.exitCode = 2;
}, 8000);

socket.on('open', () => {
  socket.send(JSON.stringify({ id: 'gewu-probe', method, params: {} }));
});
socket.on('message', (data) => {
  clearTimeout(timeout);
  let parsed = null;
  try { parsed = JSON.parse(String(data)); } catch (_error) { /* report shape only */ }
  console.log(JSON.stringify({
    endpoint,
    method,
    opened: true,
    response: true,
    matchingId: parsed?.id === 'gewu-probe',
    hasResult: Boolean(parsed?.result),
    hasError: Boolean(parsed?.error),
    method: parsed?.method || null,
  }));
  socket.close();
});
socket.on('unexpected-response', (_request, response) => {
  clearTimeout(timeout);
  console.log(JSON.stringify({ endpoint, opened: false, response: false, httpStatus: response.statusCode }));
  process.exitCode = 3;
});
socket.on('error', (error) => {
  clearTimeout(timeout);
  console.log(JSON.stringify({ endpoint, opened: false, response: false, errorCode: error.code || 'WS_ERROR' }));
  process.exitCode = 1;
});
