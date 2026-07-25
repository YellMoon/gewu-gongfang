const { spawn } = require('child_process');
const path = require('path');

const PORT = 3003;
const HOST_TOKEN = '2c9b811a422c4ed080a9bec38f47e923f72a1d071b244313b152546e40aab1ec';
const JWT_SECRET = '9898bbc310e143a28071a41260d85d12a6a64e29d6a845f68a2400b9f91f0fe7';

const env = {
  ...process.env,
  GATEWAY_PORT: String(PORT),
  GEWU_CLOUD_RELAY_HOST_TOKEN: HOST_TOKEN,
  JWT_SECRET: JWT_SECRET,
};

const gatewayPath = path.join(__dirname, '..', 'gateway', 'src', 'app.js');

console.log(`Starting Gateway on port ${PORT}...`);
const child = spawn('node', [gatewayPath], {
  env,
  stdio: 'inherit',
  cwd: path.join(__dirname, '..', 'gateway'),
});

child.on('error', (err) => {
  console.error('Failed to start Gateway:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  console.log(`Gateway exited with code ${code}`);
  process.exit(code || 0);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  child.kill('SIGTERM');
  process.exit(0);
});
