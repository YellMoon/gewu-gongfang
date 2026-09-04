'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDesktopAuthorityRuntime } = require('./desktopAuthorityRuntime');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-authority-retirement-'));

(async () => {
  try {
    const runtime = createDesktopAuthorityRuntime({
      filePath: path.join(workspace, 'outbox.bin'),
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(value, 'utf8'),
        decryptString: value => value.toString('utf8'),
      },
      vault: {
        status: () => ({
          state: 'unlocked',
          unlocked: true,
          user: { id: 'cloud-user-1' },
          deviceId: 'device-1',
          authorizationId: 'authorization-1',
          credentialVersion: 1,
          offlineLease: {
            userId: 'cloud-user-1',
            deviceId: 'device-1',
            authorizationId: 'authorization-1',
            credentialVersion: 1,
            issuedAt: '2026-08-31T00:00:00.000Z',
            expiresAt: '2026-09-02T00:00:00.000Z',
          },
        }),
      },
      cloudBusinessBaseUrl: 'https://business.example',
      now: () => '2026-09-01T00:00:00.000Z',
    });

    assert.strictEqual(runtime.readProjection, undefined, 'retired projection reads must not be exposed');
    await assert.rejects(
      runtime.appendDraft({
        type: 'authority.reconcile.v1',
        payload: { id: 'legacy-command-1' },
      }),
      error => error?.code === 'CLOUD_AUTHORITY_DRAFT_TYPE_UNSUPPORTED',
    );

    const runtimeSource = fs.readFileSync(path.join(__dirname, 'desktopAuthorityRuntime.js'), 'utf8');
    for (const retired of [
      '/api/authority/commands',
      '/api/authority/projections/current',
      'createAuthorityWebSocketTransport',
      'durableTransport',
      'createAuthorityCommand',
      'signAuthorityHttpRequest',
    ]) {
      assert.strictEqual(runtimeSource.includes(retired), false, `runtime must not retain ${retired}`);
    }

    const electronSource = fs.readFileSync(path.join(__dirname, 'electron.js'), 'utf8');
    const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
    assert.strictEqual(electronSource.includes('desktop-authority:read-projection'), false);
    assert.strictEqual(electronSource.includes('relayWebSocketBaseUrl'), false);
    assert.strictEqual(electronSource.includes("require('ws')"), false);
    assert.strictEqual(preloadSource.includes('desktop-authority:read-projection'), false);

    const browserSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'browserDatabase.ts'), 'utf8');
    assert.strictEqual(browserSource.includes('desktopAuthority.readProjection'), false);
    assert.ok(browserSource.includes('cloudProvider.listCloudBusinessProjection()'));

    const rolePanelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AuthorityRoleApplicationsPanel.tsx'), 'utf8');
    assert.strictEqual(rolePanelSource.includes('readProjection()'), false);
    assert.ok(rolePanelSource.includes("authContext.activeRole !== 'super_admin'"));

    const customTypes = fs.readFileSync(path.join(__dirname, '..', 'src', 'custom.d.ts'), 'utf8');
    assert.strictEqual(customTypes.includes('readProjection('), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  console.log('desktop authority retired relay and projection checks passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
