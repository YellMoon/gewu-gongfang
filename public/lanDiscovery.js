const os = require('os');

function isUsableIpv4(address) {
  if (!address || address === '127.0.0.1') return false;
  if (address.startsWith('169.254.')) return false;
  if (address.startsWith('10.')) return true;
  if (address.startsWith('192.168.')) return true;
  const parts = address.split('.').map(Number);
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function isIgnoredInterfaceName(name) {
  return /vethernet|virtual|vmware|virtualbox|hyper-v|wsl|docker|loopback/i.test(String(name || ''));
}

function buildLanHostUrls(options = {}) {
  const port = Number(options.port || process.env.PORT || 3001);
  const networkInterfaces = options.networkInterfaces || os.networkInterfaces;
  const urls = [];
  const seen = new Set();
  const interfaces = networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces || {})) {
    if (isIgnoredInterfaceName(name)) continue;
    for (const entry of entries || []) {
      const family = entry.family === 4 ? 'IPv4' : entry.family;
      if (family !== 'IPv4' || entry.internal || !isUsableIpv4(entry.address)) continue;
      const url = `http://${entry.address}:${port}`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  return urls;
}

module.exports = {
  buildLanHostUrls,
  isIgnoredInterfaceName,
  isUsableIpv4,
};
