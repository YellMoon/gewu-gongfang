const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');
const style = fs.readFileSync('src/pages/IdentityDeviceCenter.css', 'utf8');
const decoded = source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

assert.ok(decoded.includes('待审设备申请') && decoded.includes('我的设备') && decoded.includes('全部设备') && decoded.includes('本地数据主机'));
assert.ok(decoded.includes('申请人与审批人相同，但审批来自另一台可信设备'));
assert.ok(source.includes('loading') && source.includes('empty') && source.includes('offline'));
assert.ok(source.includes('expired') && source.includes('conflict') && source.includes('concurrent') && source.includes('revoked'));
assert.ok(source.includes('operationRef') && source.includes('Modal.confirm'), 'all mutations need a synchronous operation lock and confirmation');
assert.ok(source.includes('approveDesktopChallenge') && source.includes('rejectDesktopChallenge') && source.includes('revokeDesktopDevice'));
assert.ok(source.includes('startPrimaryHostOperation') && source.includes('bootstrapPrimaryHost'));
assert.ok(source.includes('beginPrimaryHostTransfer') && source.includes('activatePrimaryHostTransfer'));
assert.ok(source.includes('recoverPrimaryHost'));
assert.ok(source.includes('startHostTransfer') && source.includes('completeHostTransfer'));
assert.ok(source.includes('startHostRecovery') && source.includes('completeHostRecovery'));
assert.ok(source.includes('primaryHostRuntime.prepareOperation') && source.includes('primaryHostRuntime.adopt'));
assert.ok(source.includes('primaryHostRuntime.prepareOperation'));
assert.ok(source.includes('primaryHostRuntime.status'));
assert.ok(source.includes('resumeHostRuntimeAdoption'));
assert.ok(source.includes('demoteStaleHostRuntime'));
assert.ok(source.includes('primaryHostRuntime.demote'));
assert.ok(source.includes('operationManifest: prepared.operationManifest'));
assert.ok(source.includes('credentialStageId: prepared.credentialStage.id'));
assert.strictEqual(
  (source.match(/recoveryDeliveryKey: prepared\.recoveryDeliveryKey/g) || []).length,
  3,
  'bootstrap, transfer, and recovery must each send the staged public delivery key'
);
assert.strictEqual(
  (source.match(/recoveryDelivery: result\.recoveryDelivery/g) || []).length,
  3,
  'bootstrap, transfer, and recovery must each adopt the encrypted delivery returned by the server'
);
assert.strictEqual(source.includes('hostCredential'), false,
  'renderer host migration flows must never receive or forward plaintext host credentials');
assert.strictEqual(source.includes('result.recoveryPackage'), false,
  'renderer must never consume a raw recovery package from an HTTP activation response');
assert.ok(source.includes('transferId: transfer.id') && source.includes('sourceEpochId: transfer.sourceEpochId'));
assert.ok(source.includes('factorId') && source.includes('recoveryCode'));
assert.ok(source.includes('<QRCode') && source.includes('<Input.Password'));
assert.ok(source.includes('hostOperation.challenge.qrImageDataUrl') && source.includes('<img'),
  'primary-host verification must render an official mini-program code image fallback');
assert.ok(source.includes('primaryHostRuntime.revealRecoveryPackage'));
assert.ok(source.includes('primaryHostRuntime.acknowledgeRecoveryPackage'));
assert.ok(source.includes('expectedRowVersion: pendingRecoveryDelivery.rowVersion'));
assert.ok(source.includes('hostRuntimeStatus?.credential?.recoveryDelivery'));
assert.ok(source.includes('snapshot.host.blocksHighRiskOperations'));
assert.ok(source.includes('closable={false}') && source.includes('keyboard={false}'));
assert.ok(decoded.includes('显示一次性恢复包'));
assert.ok(decoded.includes('我已离线保存，确认交付并重启'));
assert.ok(decoded.includes('恢复包尚未确认交付'));
assert.ok(source.includes('primaryHostRuntime.restart'));
assert.ok(source.includes('replacementDeviceId'), 'replacement revocation must preserve an explicit device relationship');
assert.strictEqual(source.includes('<Select'), false);
assert.strictEqual(source.includes('selectedUsers'), false);
assert.strictEqual(decoded.includes('选择设备绑定账号'), false);
assert.strictEqual(source.includes('userId:'), false, 'review page must not submit or select a claimant user id');
assert.ok(style.includes(':focus-visible') && style.includes('@media (max-width: 900px)'));
assert.ok(style.includes('.recovery-delivery-secret') && style.includes('user-select: all'));
assert.ok(decoded.includes('普通桌面端一次性配对'));
assert.ok(decoded.includes('生成一次性配对码') && decoded.includes('撤销当前配对码'));
assert.ok(source.includes('singleUserRuntime.issuePairingCode'));
assert.ok(source.includes('singleUserRuntime.revokePairingCode'));
assert.ok(source.includes("desktopIdentityMode === 'single-user'"));
assert.ok(
  source.includes('resolveDesktopIdentityBaseUrl(runtimeConfig)'),
  'single-user primary host device management must use the protected local identity control plane'
);
assert.strictEqual(
  source.includes('resolvePairingApiBase(runtimeConfig, window.location)'),
  false,
  'device management must not send single-user host requests to the managed /scheduling cloud base'
);

console.log('identity device center page source checks passed');
