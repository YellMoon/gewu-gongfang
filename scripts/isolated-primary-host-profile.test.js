const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createIsolatedPrimaryHostProfile, PROFILE_MARKER } = require('./isolated-primary-host-profile');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-profile-test-'));
const profilePath = path.join(root, 'profile');
const result = createIsolatedPrimaryHostProfile({ root, profilePath, hostPort: 60462, cloudBaseUrl: 'http://127.0.0.1:41234' });
assert.equal(result.profilePath, profilePath);
assert.equal(fs.existsSync(path.join(profilePath, PROFILE_MARKER)), true);
const config = JSON.parse(fs.readFileSync(path.join(profilePath, 'gewugongfang.config.json'), 'utf8'));
assert.equal(config.nodeRole, 'primary-host');
assert.equal(config.desktopIdentityMode, 'full');
assert.equal(config.primaryHostGeneration, null);
assert.equal(config.hostBaseUrl, 'http://127.0.0.1:60462');
assert.equal(config.managedCloudBaseUrl, 'http://127.0.0.1:41234');
assert.throws(
  () => createIsolatedPrimaryHostProfile({ root, profilePath, hostPort: 60462, cloudBaseUrl: 'http://127.0.0.1:41234' }),
  /ISOLATED_PROFILE_ALREADY_EXISTS/
);
fs.rmSync(root, { recursive: true, force: true });
console.log('isolated primary host profile tests passed');
