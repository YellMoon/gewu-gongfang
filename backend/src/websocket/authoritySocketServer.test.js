const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const {
  AuthoritySocketServer,
} = require('./authoritySocketServer');

(async function main() {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const frames = [];
  const authorityServer = new AuthoritySocketServer(server, {
    handler: {
      async handle(frame) {
        frames.push(frame);
        return {
          protocol: 'gewu.authority-socket.v1',
          type: 'command.receipt',
          requestId: frame.requestId,
          receipt: { commandId: frame.envelope.commandId },
        };
      },
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/authority`);
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(messages[0].type, 'ready');
  ws.send(JSON.stringify({
    protocol: 'gewu.authority-socket.v1',
    type: 'command.submit',
    requestId: 'request-server-1',
    envelope: { commandId: 'command-server-1' },
    auth: {},
  }));
  for (let attempt = 0; attempt < 20 && messages.length < 2; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(messages[1].type, 'command.receipt');
  assert.strictEqual(messages[1].receipt.commandId, 'command-server-1');
  ws.close();
  authorityServer.close();
  await new Promise(resolve => server.close(resolve));

  console.log('authority socket server tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
