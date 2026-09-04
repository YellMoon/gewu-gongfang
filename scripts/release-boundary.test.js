const assert = require('assert');
const fs = require('fs');

const packageJson = require('../package.json');
const uploadMiniapp = fs.readFileSync('scripts/upload-miniapp.js', 'utf8');
const publishDesktop = fs.readFileSync('scripts/publish-oss-feed.js', 'utf8');
const deployBackend = fs.readFileSync('scripts/deploy.py', 'utf8');
const deployGateway = fs.readFileSync('scripts/deploy_gateway.py', 'utf8');
const deployCloudBusiness = fs.readFileSync('scripts/deploy_cloud_business_api.py', 'utf8');

assert.ok(packageJson.scripts['release:prepare'], 'formal releases must create one manifest before build or publish');
assert.ok(packageJson.scripts['release:status'], 'operators must be able to inspect a partial release');
assert.ok(packageJson.scripts['release:complete'], 'operators must have an exact-receipt completion gate');
assert.match(packageJson.scripts['dist:win'], /release-matrix\.js assert --target desktop/, 'desktop packaging must require the unified release manifest');
assert.doesNotMatch(packageJson.scripts['dist:win'], /update-version\.js --bump/, 'desktop packaging must never create a second version');
assert.ok(!packageJson.scripts['dist:win:host'], 'the unified desktop release must not produce a separate primary-host installer');
assert.ok(uploadMiniapp.includes('assertReleaseTarget({') && uploadMiniapp.includes("target: 'miniapp'"), 'miniapp upload must require the unified release manifest');
assert.ok(uploadMiniapp.includes("recordReceipt"), 'a successful miniapp upload must write a version receipt');
assert.ok(
  publishDesktop.includes('assertReleaseTarget({') && publishDesktop.includes('target: releaseTarget'),
  'OSS publication must require the unified release manifest for its declared artifact target'
);
assert.ok(publishDesktop.includes("recordReceipt"), 'a successful OSS publication must write a version receipt');
assert.ok(deployBackend.includes('LEGACY_BACKEND_DEPLOY_RETIRED'), 'the retired local backend deploy mode must fail closed');
assert.ok(!deployBackend.includes("require_release_manifest('backend'"), 'the retired backend must not impersonate a unified release target');
assert.ok(!deployBackend.includes("record_release_receipt('backend'"), 'the retired backend must not create a false release receipt');
assert.ok(deployGateway.includes('require_release_manifest("cloud_business")'), 'the retirement gateway must use the cloud-business release gate');
assert.ok(deployGateway.includes('verify_retired_gateway'), 'gateway deployment must verify its health and every authority tombstone');
assert.ok(!deployGateway.includes("record_release_receipt('gateway'") && !deployGateway.includes('record_release_receipt("gateway"'), 'the gateway is a cloud subcomponent and must not create a fifth receipt');
assert.ok(deployCloudBusiness.includes('require_release_manifest("cloud_business")'), 'cloud business deployment must require the unified release manifest');
assert.ok(deployCloudBusiness.includes('record_release_receipt("cloud_business"'), 'cloud business health success must write an exact-version receipt');
assert.ok(deployCloudBusiness.includes('payload.get("version") != expected_version'), 'cloud business public health must match the exact release version');
assert.ok(
  /backup = create_verified_backup\(\)[\s\S]*deploy_retirement_gateway\(\)[\s\S]*run_cloud_migrations\(\)/.test(deployCloudBusiness),
  'cloud deployment must install and verify the retirement gateway before migrations or promotion',
);
assert.ok(
  /def verify_public_health\(expected_version\):[\s\S]*verify_public_gateway_retirement\(expected_version\)[\s\S]*return payload/.test(deployCloudBusiness),
  'cloud public health must include the gateway tombstone and websocket rejection contract before a receipt can be written',
);
assert.ok(deployCloudBusiness.includes('validated_release_tag(args.tag)'), 'cloud business candidates must match the checked-out source revision');
assert.ok(deployCloudBusiness.includes('rollback_promoted_release(tag, operation_id)'), 'cloud business promotion failures must automatically restore the previous container under the same owner fence');
assert.ok(deployCloudBusiness.includes('reconcile_uncertain_switch(tag, operation_id)'), 'cloud business switch transport failures must reconcile remote container state under the same owner fence');
assert.ok(deployCloudBusiness.includes('flock -x 9'), 'cloud business switch and reconciliation must serialize on the remote host');
assert.ok(deployCloudBusiness.includes('acquire_promotion_lock(operation_id, tag)'), 'cloud business promotion must acquire a transaction-wide owner lock');
assert.ok(deployCloudBusiness.includes('recover_promotion_lock(tag, mode)'), 'cloud business promotion must provide controlled stale-lock recovery');
assert.ok(deployCloudBusiness.includes('promotion_lock_recovery_claim_command'), 'stale-lock recovery must atomically replace the abandoned owner with a recovery owner');
assert.ok(deployCloudBusiness.includes('heartbeat_promotion_lock(operation_id, tag)'), 'promotion must revalidate and refresh its owner fence around public verification and receipt recording');
assert.ok(deployBackend.includes('manifest.get("commit") != current_source_commit()'), 'deployment manifests must match the checked-out source commit');
assert.ok(deployBackend.includes('release_matrix_id(read_component_versions())'), 'Python deployment gates must select the same component-version manifest as the Node release workflow');
assert.ok(deployBackend.includes('manifest.get("compatibility") != read_release_compatibility()'), 'Python deployment gates must verify the reviewed protocol/data declaration');

console.log('release boundary checks passed');
