const assert = require('assert');
const {
  createMiniappAuthorityProjectionHandler,
} = require('./miniappAuthorityProjection');

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const projection = {
  authorityId: 'authority-1',
  hostEpochId: 'epoch-1',
  userId: 'wechat-user-1',
  role: 'student',
  sourceVersion: 7,
  payloadHash: 'hash-1',
  payload: { courses: [], assetRecords: [] },
  generatedAt: '2026-08-01T00:00:00.000Z',
  signature: 'signature-1',
};

let authorityLookupCount = 0;
const db = {
  prepare(sql) {
    if (sql.includes('FROM authority_accounts')) {
      return {
        all(userId, bindingUserId, role) {
          authorityLookupCount += 1;
          assert.strictEqual(userId, 'wechat-user-1');
          assert.strictEqual(bindingUserId, 'wechat-user-1');
          assert.strictEqual(role, 'student');
          return [{ authorityId: 'authority-1' }];
        },
      };
    }
    if (sql.includes('FROM primary_host_epochs')) {
      return {
        get(epochId, authorityId) {
          assert.strictEqual(epochId, 'epoch-1');
          assert.ok(['authority-1', 'authority-visitor'].includes(authorityId));
          return { id: epochId, db_authority_id: authorityId, host_public_key: 'public-key-1' };
        },
      };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  },
};

const handler = createMiniappAuthorityProjectionHandler({
  db,
  projectionStore: {
    read(scope) {
      assert.deepStrictEqual(scope, {
        authorityId: 'authority-1', userId: 'wechat-user-1', role: 'student',
      });
      return projection;
    },
  },
  verifyProjection({ projection: input, publicKey }) {
    assert.strictEqual(input, projection);
    assert.strictEqual(publicKey, 'public-key-1');
    return Object.freeze({ ...input, verified: true });
  },
});

const formalResponse = responseCapture();
handler({
  authz: {
    tokenUse: 'miniapp-session',
    accountState: 'formal',
    activeRole: 'student',
    userId: 'wechat-user-1',
    // A WeChat account may legitimately have no local student subject yet.
    studentId: null,
  },
}, formalResponse);
assert.strictEqual(formalResponse.statusCode, 200);
assert.strictEqual(formalResponse.body.success, true);
assert.strictEqual(formalResponse.body.projection.verified, true);
assert.strictEqual(authorityLookupCount, 1);

const visitorResponse = responseCapture();
const visitorHandler = createMiniappAuthorityProjectionHandler({
  db,
  projectionStore: {
    read(scope) {
      assert.deepStrictEqual(scope, {
        authorityId: 'authority-visitor', userId: 'visitor-1', role: 'visitor',
      });
      return { ...projection, authorityId: 'authority-visitor', userId: 'visitor-1', role: 'visitor' };
    },
  },
  verifyProjection({ projection: input }) { return input; },
});
visitorHandler({
  authz: {
    tokenUse: 'miniapp-visitor', accountState: 'visitor',
    authorityId: 'authority-visitor', userId: 'visitor-1', activeRole: 'visitor',
  },
}, visitorResponse);
assert.strictEqual(visitorResponse.statusCode, 200);

for (const [label, mismatch] of [
  ['cross-user', { userId: 'wechat-user-2' }],
  ['cross-role', { role: 'teacher' }],
  ['cross-authority', { authorityId: 'authority-2' }],
]) {
  const mismatchedProjection = { ...projection, ...mismatch };
  const mismatchHandler = createMiniappAuthorityProjectionHandler({
    db,
    projectionStore: {
      read(scope) {
        assert.deepStrictEqual(scope, {
          authorityId: 'authority-1', userId: 'wechat-user-1', role: 'student',
        });
        return mismatchedProjection;
      },
    },
    verifyProjection({ projection: input, publicKey }) {
      assert.strictEqual(input, mismatchedProjection);
      assert.strictEqual(publicKey, 'public-key-1');
      return Object.freeze({ ...input, verified: true });
    },
  });
  const mismatchResponse = responseCapture();
  mismatchHandler({
    authz: {
      tokenUse: 'miniapp-session', accountState: 'formal', activeRole: 'student',
      userId: 'wechat-user-1', studentId: null,
    },
  }, mismatchResponse);
  assert.strictEqual(mismatchResponse.statusCode, 403, `${label} signed projection must be rejected`);
  assert.strictEqual(mismatchResponse.body.code, 'AUTHORITY_PROJECTION_SCOPE_MISMATCH');
}

console.log('miniapp authority projection facade tests passed');
