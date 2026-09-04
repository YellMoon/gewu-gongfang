const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/components/AuthorityRoleApplicationsPanel.tsx', 'utf8');
const page = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');

assert.ok(!source.includes('readProjection()'), 'role review must not read the retired authority projection');
assert.ok(source.includes("authContext.activeRole !== 'super_admin'"), 'ordinary users must fail closed against the online cloud session role');
assert.ok(source.includes("authContext.eligibleRoles.includes('super_admin')"), 'the active cloud role must remain eligible before review data is requested');
assert.ok(source.includes('readDesktopAuthorizationSession'), 'desktop review must use its ephemeral cloud session');
assert.ok(source.includes('listRoleApplications(sessionInput)'), 'review rows must come from the cloud desktop endpoint after session-role validation');
assert.ok(source.includes('reviewRoleApplication(application.applicationId'), 'review must submit through the cloud desktop endpoint');
assert.ok(source.includes('Modal.confirm'), 'approval requires an explicit confirmation');
assert.ok(source.includes('profileName') && source.includes('profilePhone'), 'review rows must show the applicant name and verified phone');
assert.ok(source.includes('const profileId = null'), 'all approvals must let the cloud resolve or create the profile from verified applicant data');
assert.ok(!source.includes('profileIds') && !source.includes('<Input'), 'reviewers must never type an internal profile id');
assert.ok(!source.includes('\u5148\u65b0\u5efa\u6863\u6848\uff0c\u518d\u586b\u5165\u7f16\u53f7'), 'reviewers must not manually create a profile before approving a new-profile application');
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
