const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/components/AuthorityRoleApplicationsPanel.tsx', 'utf8');
const page = fs.readFileSync('src/pages/IdentityDeviceCenter.tsx', 'utf8');

assert.ok(source.includes('readProjection()'), 'role review must read the verified desktop projection bridge');
assert.ok(source.includes("projection.role !== 'super_admin'"), 'ordinary administrators must not see role review');
assert.ok(source.includes('roleReviewApplications(projection)'), 'review rows must come from the scoped runtime boundary');
assert.ok(source.includes("type=\"primary\"") && source.includes('queueDecision'), 'review controls must create decisions');
assert.ok(source.includes('appendDraft(buildRoleReviewDraft'), 'review must first append an encrypted typed draft');
assert.ok(source.includes('buildAdminGrantDraft'), 'the host role-review workbench must expose a separate direct administrator grant draft');
assert.ok(source.includes('existingUserId'), 'a direct administrator grant must require an explicit existing immutable user id');
assert.ok(!source.includes('confirmAndSubmit('), 'a review button must not silently submit without the shared confirmation step');
assert.ok(source.includes('<AuthorityOutboxPanel compact focus=\"pending\" />'), 'the explicit confirmation queue must be visible beside review');
assert.ok(
  page.includes('snapshot?.host?.runtimeMatchesActiveEpoch && <AuthorityRoleApplicationsPanel />'),
  'role review must mount only after the local host has an active authority context'
);

console.log('authority role applications panel checks passed');
