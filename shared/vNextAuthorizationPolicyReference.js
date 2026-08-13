'use strict';

const crypto = require('crypto');
const ROLES = new Set(['super_admin', 'teacher', 'student', 'visitor']);
const SURFACES = new Set(['desktop', 'miniapp']);
const SCOPE_TYPES = new Set(['teacher_profile', 'student_profile', 'school', 'household', 'resource_owner']);
const CAPABILITY_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const error = () => Object.assign(new Error('VNEXT_POLICY_INVALID'), { code: 'VNEXT_POLICY_INVALID' });
const freeze = value => Object.freeze(value);
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw error(); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw error();
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}
function instant(value) { if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) throw error(); return Date.parse(value); }
function validateTimedRecord(record) {
  if (!record || Object.getPrototypeOf(record) !== Object.prototype || typeof record.startsAt !== 'string') throw error();
  const start = instant(record.startsAt); const end = record.endsAt === undefined ? null : instant(record.endsAt);
  if (end !== null && end <= start) throw error(); return { start, end };
}
function activeAt(record, at) {
  const { start, end } = validateTimedRecord(record); if (record.status !== 'active') return false;
  const now = instant(at);
  if (start > now) return false;
  return end === null || end > now;
}
function capabilityId(value) { if (typeof value !== 'string' || !CAPABILITY_ID.test(value)) throw error(); return value; }
function deepFreezeManifest(manifest) {
  for (const item of manifest.capabilities) freeze(item.allowedSurfaces), freeze(item);
  for (const role of ROLES) freeze(manifest.roleDefaults[role]);
  freeze(manifest.capabilities); freeze(manifest.roleDefaults); return freeze(manifest);
}
function createPolicyManifest(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(key => !['capabilities', 'roleDefaults'].includes(key)) || !Array.isArray(input.capabilities) || !input.roleDefaults || Object.getPrototypeOf(input.roleDefaults) !== Object.prototype || Object.keys(input.roleDefaults).length !== 3 || !['super_admin','teacher','student'].every(role => Object.hasOwn(input.roleDefaults, role))) throw error();
  const capabilities = input.capabilities.map(item => {
    if (!item || Object.getPrototypeOf(item) !== Object.prototype || Object.keys(item).some(key => !['capabilityId','status','allowedSurfaces'].includes(key)) || !['active','retired'].includes(item.status) || !Array.isArray(item.allowedSurfaces)) throw error();
    const allowedSurfaces = [...new Set(item.allowedSurfaces.map(surface => { if (!SURFACES.has(surface)) throw error(); return surface; }))].sort();
    if (!allowedSurfaces.length) throw error(); return { capabilityId: capabilityId(item.capabilityId), status: item.status, allowedSurfaces };
  }).sort((left, right) => left.capabilityId < right.capabilityId ? -1 : left.capabilityId > right.capabilityId ? 1 : 0);
  if (new Set(capabilities.map(item => item.capabilityId)).size !== capabilities.length) throw error();
  const declared = new Set(capabilities.map(item => item.capabilityId));
  const roleDefaults = {};
  for (const role of ['super_admin','teacher','student']) {
    if (!Array.isArray(input.roleDefaults[role])) throw error();
    roleDefaults[role] = [...new Set(input.roleDefaults[role].map(capabilityId))].sort();
    if (roleDefaults[role].some(id => !declared.has(id))) throw error();
  }
  return deepFreezeManifest({ contractVersion: 1, capabilities, roleDefaults });
}
const DEFAULT_POLICY_MANIFEST = createPolicyManifest({
  capabilities: [
    { capabilityId: 'access.manage', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'device.revoke', status: 'active', allowedSurfaces: ['desktop'] },
    { capabilityId: 'user.review', status: 'active', allowedSurfaces: ['desktop'] },
  ],
  roleDefaults: { super_admin: ['access.manage','device.revoke','user.review'], teacher: [], student: [] },
});
function normalizedManifest(manifest) {
  if (!manifest || Object.getPrototypeOf(manifest) !== Object.prototype || Object.keys(manifest).some(key => !['contractVersion','capabilities','roleDefaults'].includes(key)) || manifest.contractVersion !== 1) throw error();
  return createPolicyManifest({ capabilities: manifest.capabilities, roleDefaults: manifest.roleDefaults });
}
function canonicalizePolicyManifest(manifest) { return stableJson(normalizedManifest(manifest)); }
function policyManifestSha256(manifest) { return hash(canonicalizePolicyManifest(manifest)); }
function resolveEffectiveCapabilityIds({ manifest, roles, overrides = [], surface, at }) {
  const policy = normalizedManifest(manifest);
  if (!Array.isArray(roles) || !Array.isArray(overrides) || !SURFACES.has(surface)) throw error();
  instant(at);
  const roleSet = new Set(roles.map(role => { if (!ROLES.has(role)) throw error(); return role; }));
  if (roleSet.has('visitor') && roleSet.size !== 1) throw error();
  const index = new Map(policy.capabilities.map(item => [item.capabilityId, item]));
  const allow = new Set(); const deny = new Set();
  for (const role of roleSet) for (const id of policy.roleDefaults[role] || []) allow.add(id);
  for (const item of overrides) {
    if (!item || Object.getPrototypeOf(item) !== Object.prototype || Object.keys(item).some(key => !['capabilityId','effect','status','startsAt','endsAt'].includes(key)) || !['allow','deny'].includes(item.effect) || !['active','revoked','expired'].includes(item.status)) throw error();
    const id = capabilityId(item.capabilityId); if (!index.has(id)) throw error();
    if (activeAt(item, at)) (item.effect === 'deny' ? deny : allow).add(id);
  }
  const capabilityIds = [...allow].filter(id => index.get(id).status === 'active' && index.get(id).allowedSurfaces.includes(surface) && !deny.has(id)).sort();
  return freeze({ capabilityIds: freeze(capabilityIds), capabilitySha256: hash(stableJson(capabilityIds)) });
}
function canonicalizeEffectiveScopes(scopes, at) {
  if (!Array.isArray(scopes)) throw error(); instant(at); const allow = new Set(); const deny = new Set();
  for (const item of scopes) {
    if (!item || Object.getPrototypeOf(item) !== Object.prototype || Object.keys(item).some(key => !['scopeType','scopeValueHash','effect','status','startsAt','endsAt'].includes(key)) || !SCOPE_TYPES.has(item.scopeType) || typeof item.scopeValueHash !== 'string' || !SHA256.test(item.scopeValueHash) || !['allow','deny'].includes(item.effect) || !['active','revoked','expired'].includes(item.status)) throw error();
    if (activeAt(item, at)) (item.effect === 'deny' ? deny : allow).add(`${item.scopeType}:${item.scopeValueHash}`);
  }
  return freeze([...allow].filter(key => !deny.has(key)).map(key => { const [scopeType, scopeValueHash] = key.split(':'); return freeze({ scopeType, scopeValueHash }); }).sort((a, b) => { const left = stableJson(a); const right = stableJson(b); return left < right ? -1 : left > right ? 1 : 0; }));
}
function scopeSha256(scopes, at) { return hash(stableJson(canonicalizeEffectiveScopes(scopes, at))); }
module.exports = freeze({ POLICY_CONTRACT_VERSION: 1, DEFAULT_POLICY_MANIFEST, createPolicyManifest, canonicalizePolicyManifest, policyManifestSha256, resolveEffectiveCapabilityIds, canonicalizeEffectiveScopes, scopeSha256 });
