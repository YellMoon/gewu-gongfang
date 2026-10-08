'use strict';
const { spawnSync } = require('node:child_process');
const tests = [
  'shared/personal-finance/billCsv.test.js', 'shared/personal-finance/ledger.test.js',
  'cloud-business-api/src/billFileDecoder.test.js', 'cloud-business-api/src/personalFinanceRepository.test.js',
  'cloud-business-api/src/personalFinanceRoutes.test.js', 'cloud-business-api/sql/personal-finance.postgres.test.js',
  'cloud-business-api/src/billSourceArchive.test.js', 'cloud-business-api/src/billMailbox.test.js',
  'cloud-business-api/src/personalFinanceIntegration.test.js', 'src/services/personalFinanceClient.test.mjs',
  'src/components/PersonalFinancePanel.runtime.test.js',
  'miniapp/src/utils/personalFinanceTransport.test.js', 'miniapp/src/components/PersonalFinanceSummary.runtime.test.js',
  'miniapp/src/components/QuestionBasketOverlay.runtime.test.js',
  'miniapp/src/utils/permissionConcurrentRuntime.test.js', 'miniapp/src/pages/schedule/orientationRuntime.test.js',
  'miniapp/src/pages/question-bank/featureParityRuntime.test.js', 'miniapp/src/pages/question-bank/typography.test.js',
  'miniapp/src/pages/question-paper/featureParityRuntime.test.js',
];
for (const file of tests) {
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: require('node:path').resolve(__dirname, '..') });
  if (result.status !== 0) process.exit(result.status || 1);
}
