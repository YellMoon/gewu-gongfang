export function shouldInstallDesktopLoginChromeFixture({ nodeEnv, location } = {}) {
  const hostname = String(location?.hostname || '').toLowerCase();
  const params = new URLSearchParams(String(location?.search || ''));
  return nodeEnv === 'development'
    && hostname === 'localhost'
    && params.get('__desktopLoginFixture') === '1';
}

export function installDesktopLoginChromeFixture(globalObject = globalThis.window) {
  if (!globalObject) throw new Error('CHROME_UI_FIXTURE_WINDOW_REQUIRED');
  const deviceId = 'chrome-ui-device';
  const ResponseCtor = globalObject.Response || globalThis.Response;
  globalObject.api = {
    invoke: async channel => {
      if (channel === 'runtime-config:get') {
        return {
          buildFlavor: 'desktop-client',
          primaryHostCapable: false,
          nodeRole: 'desktop-client',
          desktopIdentityMode: 'full',
          deviceId,
          deviceName: 'Chrome UI test',
          primaryHostEpochId: '',
          primaryHostGeneration: null,
          hostBaseUrl: 'http://127.0.0.1:3001',
          cloudBaseUrl: 'http://127.0.0.1:3001',
          desktopSyncToken: '',
          mainDbPath: '',
          questionBankPath: '',
          questionAssetPath: '',
          questionBankCandidatePaths: [],
          questionBankStoreId: '',
          localCachePath: '',
          nasBackupPath: '',
        };
      }
      if (channel === 'get-app-version') return 'chrome-ui-test';
      return null;
    },
  };
  globalObject.desktopIdentity = {
    status: async () => ({ state: 'empty' }),
    beginUnifiedOnlineRegistration: async () => ({
      deviceId,
      publicKey: 'chrome-ui-public-key',
      keyFingerprint: 'chrome-ui-fingerprint',
    }),
    lock: async () => ({ state: 'empty', unlocked: false }),
  };
  globalObject.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/api/desktop/pairing/start')) {
      return new ResponseCtor(JSON.stringify({
        success: true,
        data: {
          pairingId: 'chrome-ui-pairing',
          pairingSecret: 'chrome-ui-secret',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/desktop/pairing/chrome-ui-pairing')) {
      return new ResponseCtor(JSON.stringify({
        success: true,
        data: { status: 'awaiting_online_verification' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('CHROME_UI_FIXTURE_UNEXPECTED_REQUEST');
  };
}
