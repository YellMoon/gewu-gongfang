const assert = require('assert');

const { buildLanHostUrls } = require('./lanDiscovery');

const urls = buildLanHostUrls({
  port: 3001,
  networkInterfaces: () => ({
    Ethernet: [
      { family: 'IPv4', internal: false, address: '192.168.31.8' },
      { family: 'IPv6', internal: false, address: 'fe80::1' },
    ],
    Loopback: [
      { family: 'IPv4', internal: true, address: '127.0.0.1' },
    ],
    Virtual: [
      { family: 'IPv4', internal: false, address: '169.254.10.10' },
    ],
    'vEthernet (WSL)': [
      { family: 'IPv4', internal: false, address: '172.28.192.1' },
    ],
  }),
});

assert.deepStrictEqual(urls, ['http://192.168.31.8:3001']);

console.log('lan discovery checks passed');
