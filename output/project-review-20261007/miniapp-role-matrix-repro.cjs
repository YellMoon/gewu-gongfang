'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const auth = require(path.join(root, 'miniapp/src/utils/miniappAuthorizationRuntime'));
const routes = require(path.join(root, 'miniapp/src/utils/miniappRouteAccess'));
const { runtimeScenarios } = require(path.join(root, 'miniapp/src/utils/miniappUiRuntimeScenarios'));
const { pageInventory } = require(path.join(root, 'miniapp/src/utils/miniappUiPageInventory'));
const checks = [];
for (const role of ['student', 'family_member']) {
  const user = { id: 'account-1', role, user_type: role, account_state: 'formal', token_use: 'miniapp-cloud', student_id: 'student-1' };
  const access = auth.deriveAccess(user, {
    status: 'loaded', identityKey: auth.permissionIdentityKey(user), capabilities: ['question-bank:view'],
  });
  checks.push({
    role, modules: access.modules, canOpenCourse: routes.canOpenMiniappRoute('pages/courses/index', access),
    declaredScenarios: runtimeScenarios.filter(scenario => scenario.route === 'pages/courses/index' && scenario.roleView === role)
      .map(scenario => ({ id: scenario.id, expectedText: scenario.expectedText })),
  });
}
const matrixPath = path.join(root, 'output/miniapp-8.4.0-ui-coverage/runtime-scenario-matrix/matrix.json');
const oldMatrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
console.log(JSON.stringify({
  registeredInventoryPages: pageInventory.length, runtimeScenarios: runtimeScenarios.length,
  unreachableCourseScenarios: checks,
  historicalRepositoryMatrix: { version: oldMatrix.version, generatedAt: oldMatrix.generatedAt,
    registeredPageCount: oldMatrix.registeredPageCount, screenshotCount: oldMatrix.screenshotCount, rolesCovered: oldMatrix.rolesCovered },
  scope: 'Static role contract reproduction. No claim of current WeChat screenshot coverage.',
  externalRequests: 0, productionWrites: 0,
}, null, 2));
if (checks.some(check => check.canOpenCourse || check.declaredScenarios.length !== 1)) process.exitCode = 1;
