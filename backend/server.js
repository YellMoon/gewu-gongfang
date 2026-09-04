require('dotenv').config();

const http = require('http');
const { createApp } = require('./src/app');
const { resolveBackendPort } = require('./src/runtimePort');

const PORT = resolveBackendPort();
const app = createApp();
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
