'use strict';
const assert = require('assert');
const policy = require('./vNextAuthorizationPolicyReference');

assert.ok(Object.isFrozen(policy.DEFAULT_POLICY_MANIFEST));
assert.deepStrictEqual(policy.DEFAULT_POLICY_MANIFEST.roleDefaults.super_admin, ['access.manage','device.revoke','user.review']);

const manifest = policy.createPolicyManifest({
  capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ],
  roleDefaults: { super_admin: ['user.review', 'access.manage', 'device.revoke'], teacher: [], student: [] },
});
assert.strictEqual(manifest.contractVersion, 1);
assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.capabilities) && Object.isFrozen(manifest.roleDefaults));
assert.deepStrictEqual(policy.resolveEffectiveCapabilityIds({ manifest, roles: ['teacher', 'super_admin'], surface: 'desktop', at: '2026-08-14T00:00:00.000Z' }).capabilityIds, ['access.manage','device.revoke','user.review']);
assert.deepStrictEqual(policy.resolveEffectiveCapabilityIds({ manifest, roles: ['super_admin'], surface: 'miniapp', at: '2026-08-14T00:00:00.000Z' }).capabilityIds, []);
assert.deepStrictEqual(policy.resolveEffectiveCapabilityIds({ manifest, roles: ['super_admin'], surface: 'desktop', at: '2026-08-14T00:00:00.000Z', overrides: [{ capabilityId: 'access.manage', effect: 'deny', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' }] }).capabilityIds, ['device.revoke','user.review']);
assert.throws(() => policy.resolveEffectiveCapabilityIds({ manifest, roles: ['admin'], surface: 'desktop', at: '2026-08-14T00:00:00.000Z' }), /VNEXT_POLICY_INVALID/);
assert.strictEqual(policy.policyManifestSha256(manifest), policy.policyManifestSha256(policy.createPolicyManifest({ capabilities: [...manifest.capabilities].reverse(), roleDefaults: { student: [], teacher: [], super_admin: [...manifest.roleDefaults.super_admin].reverse() } })));
const scope = policy.canonicalizeEffectiveScopes([{ scopeType: 'school', scopeValueHash: 'a'.repeat(64), effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' }, { scopeType: 'school', scopeValueHash: 'a'.repeat(64), effect: 'deny', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' }], '2026-08-14T00:00:00.000Z');
assert.deepStrictEqual(scope, []);
assert.throws(() => policy.canonicalizeEffectiveScopes([{ scopeType: 'unknown', scopeValueHash: 'a'.repeat(64), effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' }], '2026-08-14T00:00:00.000Z'), /VNEXT_POLICY_INVALID/);
assert.deepStrictEqual(policy.canonicalizeEffectiveScopes([
  { scopeType: 'school', scopeValueHash: 'opaque:scope', effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' },
  { scopeType: 'school', scopeValueHash: 'opaque:scope', effect: 'deny', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' },
], '2026-08-14T00:00:00.000Z'), []);
assert.deepStrictEqual(policy.canonicalizeEffectiveScopes([
  { scopeType: 'school', scopeValueHash: 'opaque:allow', effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' },
  { scopeType: 'school', scopeValueHash: 'opaque:deny', effect: 'deny', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' },
], '2026-08-14T00:00:00.000Z'), [{ scopeType: 'school', scopeValueHash: 'opaque:allow' }]);
const retiredManifest = policy.createPolicyManifest({ capabilities: [{ capabilityId: 'user.review', status: 'retired', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['user.review'], teacher: [], student: [] } });
assert.deepStrictEqual(policy.resolveEffectiveCapabilityIds({ manifest: retiredManifest, roles: ['super_admin'], surface: 'desktop', at: '2026-08-14T00:00:00.000Z' }).capabilityIds, []);
const boundary = policy.resolveEffectiveCapabilityIds({ manifest, roles: ['visitor'], surface: 'desktop', at: '2026-08-14T00:00:00.000Z', overrides: [{ capabilityId: 'user.review', effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z', endsAt: '2026-08-14T00:00:00.000Z' }] });
assert.deepStrictEqual(boundary.capabilityIds, []);
assert.throws(() => policy.createPolicyManifest({ capabilities: [{ capabilityId: 'user.review', status: 'active', allowedSurfaces: ['primary-host'] }], roleDefaults: { super_admin: [], teacher: [], student: [] } }), /VNEXT_POLICY_INVALID/);
assert.deepStrictEqual(policy.canonicalizeEffectiveScopes([{ scopeType: 'school', scopeValueHash: 'opaque:scope', effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' }], '2026-08-14T00:00:00.000Z'), [{ scopeType: 'school', scopeValueHash: 'opaque:scope' }]);
assert.throws(() => policy.canonicalizeEffectiveScopes([{ scopeType: 'school', scopeValueHash: '   ', effect: 'allow', status: 'active', startsAt: '2026-08-13T00:00:00.000Z' }], '2026-08-14T00:00:00.000Z'), /VNEXT_POLICY_INVALID/);
assert.doesNotThrow(() => policy.createPolicyManifest({ capabilities: [{ capabilityId: 'question.content.read', status: 'active', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['question.content.read'], teacher: [], student: [] } }));
assert.throws(() => policy.resolveEffectiveCapabilityIds({ manifest, roles: ['visitor'], surface: 'desktop', at: 'not-a-time' }), /VNEXT_POLICY_INVALID/);
assert.throws(() => policy.canonicalizeEffectiveScopes([{ scopeType: 'school', scopeValueHash: 'a'.repeat(64), effect: 'allow', status: 'revoked', startsAt: 'not-a-time' }], '2026-08-14T00:00:00.000Z'), /VNEXT_POLICY_INVALID/);
assert.throws(() => policy.policyManifestSha256({ ...manifest, contractVersion: 999 }), /VNEXT_POLICY_INVALID/);
assert.throws(() => policy.policyManifestSha256({ ...manifest, unexpected: true }), /VNEXT_POLICY_INVALID/);
assert.strictEqual(policy.canonicalizePolicyManifest(manifest), '{"capabilities":[{"allowedSurfaces":["desktop"],"capabilityId":"access.manage","status":"active"},{"allowedSurfaces":["desktop"],"capabilityId":"device.revoke","status":"active"},{"allowedSurfaces":["desktop"],"capabilityId":"user.review","status":"active"}],"contractVersion":1,"roleDefaults":{"student":[],"super_admin":["access.manage","device.revoke","user.review"],"teacher":[]}}');
assert.throws(() => policy.canonicalizeEffectiveScopes([], 'not-a-time'), /VNEXT_POLICY_INVALID/);
assert.throws(() => policy.resolveEffectiveCapabilityIds({ manifest, roles: ['visitor','super_admin'], surface: 'desktop', at: '2026-08-14T00:00:00.000Z' }), /VNEXT_POLICY_INVALID/);
assert.strictEqual(policy.policyManifestSha256(policy.createPolicyManifest({ capabilities: [{ capabilityId: 'a_2.read', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'a_10.read', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'question.content.read', status: 'active', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['question.content.read','a_10.read','a_2.read'], teacher: [], student: [] } })), policy.policyManifestSha256(policy.createPolicyManifest({ capabilities: [{ capabilityId: 'question.content.read', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'a_2.read', status: 'active', allowedSurfaces: ['desktop'] }, { capabilityId: 'a_10.read', status: 'active', allowedSurfaces: ['desktop'] }], roleDefaults: { super_admin: ['a_2.read','question.content.read','a_10.read'], teacher: [], student: [] } })));
console.log('vNext authorization policy reference checks passed');
