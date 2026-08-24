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
assert.ok(deployBackend.includes('require_release_manifest'), 'backend deployment must require the unified release manifest');
assert.ok(deployBackend.includes("record_release_receipt('backend'"), 'backend health success must write an exact-version receipt');
assert.ok(deployGateway.includes('require_release_manifest'), 'gateway deployment must require the unified release manifest');
assert.ok(deployGateway.includes("record_release_receipt('gateway'"), 'gateway health success must write an exact-version receipt');
assert.ok(deployCloudBusiness.includes('require_release_manifest("cloud_business")'), 'cloud business deployment must require the unified release manifest');
assert.ok(deployCloudBusiness.includes('record_release_receipt("cloud_business"'), 'cloud business health success must write an exact-version receipt');
assert.ok(deployCloudBusiness.includes('payload.get("version") != expected_version'), 'cloud business public health must match the exact release version');
assert.ok(deployCloudBusiness.includes('validated_release_tag(args.tag)'), 'cloud business candidates must match the checked-out source revision');
assert.ok(deployCloudBusiness.includes('rollback_promoted_release(tag)'), 'cloud business promotion failures must automatically restore the previous container');
assert.ok(deployCloudBusiness.includes('reconcile_uncertain_switch(tag)'), 'cloud business switch transport failures must reconcile remote container state');
assert.ok(deployCloudBusiness.includes('flock -x 9'), 'cloud business switch and reconciliation must serialize on the remote host');
assert.ok(deployCloudBusiness.includes('lease = acquire_promotion_lock()'), 'cloud business promotion must acquire a transaction-wide remote lease');
assert.ok(deployCloudBusiness.includes('lease.close()'), 'cloud business promotion must release its live remote lease');
assert.ok(deployBackend.includes('manifest.get("commit") != current_source_commit()'), 'deployment manifests must match the checked-out source commit');

console.log('release boundary checks passed');
