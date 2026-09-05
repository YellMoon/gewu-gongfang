const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeRoots = ['src', 'miniapp/src', 'gateway/src', 'backend/src'];
const allowedFiles = new Set([
  'backend/src/databaseAuthorization.test.js',
  'backend/src/services/miniappAccessPolicy.test.js',
  'gateway/src/db/schema.sql',
  'gateway/src/routes/adminAuthorization.test.js',
]);
const forbidden = [
  /menu-manage|MenuManage/,
  /\b(?:invitee|invited)\b/,
  /permissions_data|invite_codes_geworks|admin_accounts_geworks/,
  /pages\/admin\/invitations/,
  /grantPermission|revokePermission/,
];

const files = [];
const visit = (relativeDir) => {
  for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
    const relative = path.posix.join(relativeDir.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) visit(relative);
    else if (/\.(?:js|jsx|ts|tsx|json)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) files.push(relative);
  }
};
runtimeRoots.forEach(visit);

const violations = [];
for (const file of files) {
  if (allowedFiles.has(file)) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  forbidden.forEach(pattern => {
    if (pattern.test(source)) violations.push(`${file}: ${pattern}`);
  });
}

assert.deepStrictEqual(violations, [], `legacy authorization runtime references remain:\n${violations.join('\n')}`);
assert(!fs.existsSync(path.join(root, 'src/pages/MenuManage.tsx')), 'desktop menu manager page must be deleted');
assert(!fs.existsSync(path.join(root, 'miniapp/src/pages/admin/invitations/index.tsx')), 'miniapp invitation page must be deleted');
const gatewayAuthPath = path.join(root, 'gateway/src/routes/auth.js');
assert(!fs.existsSync(gatewayAuthPath), 'the retired gateway authentication router must remain physically deleted');
const gatewayApp = fs.readFileSync(path.join(root, 'gateway/src/app.js'), 'utf8');
assert(
  gatewayApp.includes("app.use('/api/auth', gatewayAuthRetired)")
    && gatewayApp.includes("'GATEWAY_AUTH_RETIRED'"),
  'the gateway must retain a permanent 410 tombstone for retired authentication endpoints',
);
const miniappInventory = fs.readFileSync(path.join(root, 'miniapp/src/utils/miniappUiPageInventory.js'), 'utf8');
assert(!/invite-register|invitationApi|auth\/register|邀请码/i.test(miniappInventory), 'miniapp inventory must not describe legacy invitation or registration flows');

console.log('legacy authorization runtime regression tests passed');
