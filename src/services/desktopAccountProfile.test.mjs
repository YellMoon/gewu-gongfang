import assert from 'node:assert/strict';
const modulePath = new URL('./desktopAccountProfile.mjs', import.meta.url);
let loadDesktopAccountProfile;
try { ({ loadDesktopAccountProfile } = await import(modulePath)); } catch (_) {}
assert.equal(typeof loadDesktopAccountProfile, 'function', 'the account profile must have an authenticated data client');
const session = { authorization: 'Bearer fixture', authContext: { userId: 'a', activeRole: 'teacher' } };
let request;
const profile = { accountName: 'alice', name: '教师甲', phone: '13800000000', subject: '物理', wechat: null, activeRole: 'teacher', eligibleRoles: ['teacher'] };
assert.deepEqual(await loadDesktopAccountProfile({ baseUrl: 'https://cloud.example', session, fetchImpl: async (url, options) => {
  request = { url, options }; return { ok: true, json: async () => ({ success: true, data: profile }) };
} }), profile);
assert.equal(request.url, 'https://cloud.example/api/desktop-identity/profile');
assert.equal(request.options.headers.Authorization, 'Bearer fixture');
assert.equal(request.options.method, 'GET');
assert.equal(request.options.cache, 'no-store');
await loadDesktopAccountProfile({ baseUrl: 'https://physicsedu.xyz/cloud-business/', session, fetchImpl: async (url, options) => {
  request = { url, options }; return { ok: true, json: async () => ({ success: true, data: profile }) };
} });
assert.equal(request.url, 'https://physicsedu.xyz/cloud-business/api/desktop-identity/profile', 'production proxy prefix must be preserved');
await assert.rejects(loadDesktopAccountProfile({ baseUrl: 'https://cloud.example', session: {} }), /AUTHORIZATION_CONTEXT_REQUIRED/);
await assert.rejects(loadDesktopAccountProfile({ baseUrl: 'https://cloud.example', session, fetchImpl: async () => ({ ok: false, json: async () => ({ success: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' }) }) }), /CLOUD_ONLINE_IDENTITY_REJECTED/);
await assert.rejects(loadDesktopAccountProfile({ baseUrl: 'https://cloud.example', session, fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, data: { ...profile, activeRole: 'super_admin' } }) }) }), /DESKTOP_ACCOUNT_PROFILE_INVALID/);
console.log('authenticated account profile client checks passed');

const cacheModule = await import(modulePath);
assert.equal(typeof cacheModule.cacheDesktopAccountProfile, 'function', 'verified profile must survive page remounts');
assert.equal(typeof cacheModule.readCachedDesktopAccountProfile, 'function');
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const scope = { userId: 'a', activeRole: 'teacher', storage };
assert.equal(cacheModule.cacheDesktopAccountProfile({ ...scope, profile: { ...profile, authorization: 'Bearer secret', sessionToken: 'secret' } }), true);
assert.deepEqual(cacheModule.readCachedDesktopAccountProfile(scope), profile);
assert.equal(cacheModule.readCachedDesktopAccountProfile({ ...scope, userId: 'b' }), null, 'another account must never see the cached profile');
assert.equal(cacheModule.readCachedDesktopAccountProfile({ ...scope, activeRole: 'super_admin' }), null, 'another role must not reuse the profile');
assert.equal([...values.values()].some(value => /secret|authorization|sessionToken/.test(value)), false, 'cached fields must exclude credentials');
assert.equal(cacheModule.cacheDesktopAccountProfile({ ...scope, profile: { ...profile, eligibleRoles: ['teacher', 'student'] } }), false);
assert.equal(cacheModule.cacheDesktopAccountProfile({ ...scope, profile: { ...profile, activeRole: 'super_admin' } }), false);
const cacheKey = [...values.keys()][0];
values.set(cacheKey, '{malformed');
assert.equal(cacheModule.readCachedDesktopAccountProfile(scope), null);
values.set(cacheKey, JSON.stringify({ version: 1, userId: 'b', activeRole: 'teacher', profile }));
assert.equal(cacheModule.readCachedDesktopAccountProfile(scope), null, 'cache metadata must match its requested account');
const blockedStorage = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('quota'); } };
assert.equal(cacheModule.readCachedDesktopAccountProfile({ ...scope, storage: blockedStorage }), null);
assert.equal(cacheModule.cacheDesktopAccountProfile({ ...scope, profile, storage: blockedStorage }), false);
console.log('verified profile persistence and account/role isolation checks passed');
