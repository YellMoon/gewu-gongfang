const WebSocket = require('ws');
const { SOCKET_PROTOCOL } = require('../services/authoritySocketCommandHandler');

class AuthoritySocketServer {
  constructor(server, { handler } = {}) {
    if (!server || typeof server.on !== 'function' || typeof handler?.handle !== 'function') {
      throw Object.assign(new Error('AUTHORITY_SOCKET_SERVER_CONFIG_INVALID'), {
        code: 'AUTHORITY_SOCKET_SERVER_CONFIG_INVALID',
      });
    }
    this.handler = handler;
    this.wss = new WebSocket.Server({ noServer: true });
    this.onUpgrade = (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws/authority') return;
      this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
    };
    server.on('upgrade', this.onUpgrade);
    this.wss.on('connection', socket => {
      socket.send(JSON.stringify({ protocol: SOCKET_PROTOCOL, type: 'ready' }));
      socket.on('message', async raw => {
        let response;
        try {
          const frame = JSON.parse(raw.toString('utf8'));
          response = await this.handler.handle(frame);
        } catch (_error) {
          response = {
            protocol: SOCKET_PROTOCOL,
            type: 'command.error',
            requestId: '',
            error: { code: 'AUTHORITY_SOCKET_FRAME_INVALID', retryable: false },
          };
        }
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
      });
    });
  }

  close() {
    this.wss.close();
  }
}

module.exports = { AuthoritySocketServer };
