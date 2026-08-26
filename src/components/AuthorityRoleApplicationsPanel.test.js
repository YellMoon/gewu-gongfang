const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/components/AuthorityRoleApplicationsPanel.tsx', 'utf8');
const page = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');

assert.ok(source.includes('readProjection()'), 'role review must retain the verified desktop identity gate');
assert.ok(source.includes("projection.role !== 'super_admin'"), 'ordinary administrators must not see role review');
assert.ok(source.includes('readDesktopAuthorizationSession'), 'desktop review must use its ephemeral cloud session');
assert.ok(source.includes('listRoleApplications(cloudSessionInput())'), 'review rows must come from the cloud desktop endpoint');
assert.ok(source.includes('reviewRoleApplication(application.applicationId'), 'review must submit through the cloud desktop endpoint');
assert.ok(source.includes('Modal.confirm'), 'approval requires an explicit confirmation');
assert.ok(!source.includes('buildAdminGrantDraft'), 'retired ordinary-admin grants must not be offered');
assert.ok(!source.includes('existingUserId'), 'retired ordinary-admin grant inputs must not be rendered');
assert.ok(!source.includes('buildRoleReviewDraft'), 'role approval must not create a legacy relay draft');
assert.ok(!source.includes('appendDraft('), 'role approval must not enter the offline command outbox');
assert.ok(!source.includes('AuthorityOutboxPanel'), 'role approval must not be coupled to the legacy relay queue');
assert.ok(
  page.includes('snapshot?.access?.canReview && <Card'),
  'role review must mount only for a cloud-approved reviewer'
);

console.log('authority role applications panel checks passed');
