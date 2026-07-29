const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'SystemSettings.tsx'), 'utf8');
assert.ok(source.includes("import HostAuthorityExecutionMonitor from '../components/HostAuthorityExecutionMonitor';"),
  'the primary-host settings page must use a host execution monitor rather than the client outbox');
assert.ok(source.includes('<HostAuthorityExecutionMonitor />'),
  'the primary-host settings page must render the host execution monitor');
assert.ok(!source.includes("children: <SyncSettings variant=\"advanced\" />"),
  'the primary-host advanced-sync section must not render the client outbound confirmation panel');
console.log('system settings authority surface checks passed');
