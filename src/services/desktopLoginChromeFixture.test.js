const assert = require('assert');
const fs = require('fs');

async function main() {
  const {
    shouldInstallDesktopLoginChromeFixture,
    installDesktopLoginChromeFixture,
  } = await import('./desktopLoginChromeFixture.mjs');

  assert.strictEqual(shouldInstallDesktopLoginChromeFixture({
    nodeEnv: 'development',
    location: { hostname: 'localhost', search: '?__desktopLoginFixture=1' },
  }), true);
  for (const input of [
    { nodeEnv: 'production', location: { hostname: 'localhost', search: '?__desktopLoginFixture=1' } },
    { nodeEnv: 'development', location: { hostname: 'example.com', search: '?__desktopLoginFixture=1' } },
    { nodeEnv: 'development', location: { hostname: 'localhost', search: '' } },
  ]) assert.strictEqual(shouldInstallDesktopLoginChromeFixture(input), false);

  const mockWindow = {};
  installDesktopLoginChromeFixture(mockWindow);
  assert.strictEqual((await mockWindow.desktopIdentity.status()).state, 'empty');
  assert.strictEqual((await mockWindow.desktopIdentity.beginUnifiedOnlineRegistration()).deviceId, 'chrome-ui-device');
  const started = await mockWindow.fetch('http://127.0.0.1:3001/api/desktop/pairing/start');
  assert.strictEqual(started.ok, true);
  assert.strictEqual((await started.json()).data.pairingId, 'chrome-ui-pairing');
  await assert.rejects(
    mockWindow.fetch('http://127.0.0.1:3001/api/unexpected'),
    /CHROME_UI_FIXTURE_UNEXPECTED_REQUEST/,
  );

  const indexSource = fs.readFileSync('src/index.tsx', 'utf8');
  const fixtureSource = fs.readFileSync('src/services/desktopLoginChromeFixture.mjs', 'utf8');
  assert.ok(indexSource.includes('shouldInstallDesktopLoginChromeFixture'));
  assert.ok(indexSource.includes('nodeEnv: process.env.NODE_ENV'));
  assert.ok(fixtureSource.includes("nodeEnv === 'development'"));
  assert.ok(fixtureSource.includes("hostname === 'localhost'"));
  assert.ok(fixtureSource.includes("__desktopLoginFixture"));
  console.log('desktop login Chrome fixture checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
