const assert = require('assert');
const fs = require('fs');
const path = require('path');

const contract = require('./check_cloud_business_authority_contract');
const DATABASE_DECISION = 'docs/superpowers/specs/2026-08-14-vnext-production-control-plane-database-decision.md';
const SOURCE_DICTIONARY = 'docs/vnext-source-data-dictionary.md';
const SHADOW_IMPORT_PLAN = 'docs/superpowers/plans/2026-08-13-vnext-cloud-schema-shadow-import.md';
const UNIFIED_DESKTOP_ADMISSION = 'docs/superpowers/specs/2026-08-21-unified-desktop-silent-registration-offline-draft-admission-design.md';
const CORE_SCHEDULING_ADMISSION = 'docs/superpowers/specs/2026-08-21-core-scheduling-attendance-fee-migration-design.md';
const CORE_SCHEDULING_REAL_SOURCE_ADMISSION = 'docs/superpowers/specs/2026-08-21-core-scheduling-real-source-value-privacy-admission-design.md';
const TASK_CARRIER = 'task.md';

assert.strictEqual(
  typeof contract.checkCloudBusinessAuthorityContract,
  'function',
  'the cloud-business-authority architecture must have an executable contract gate'
);
assert.strictEqual(
  typeof contract.checkContractTexts,
  'function',
  'the contract gate must expose its document evaluation so a regression is testable'
);
assert.ok(
  contract.ACTIVE_DOCUMENTS.includes(DATABASE_DECISION),
  'the still-linked production-database decision must be covered by the architecture gate'
);
for (const activeMigrationDocument of [SOURCE_DICTIONARY, SHADOW_IMPORT_PLAN, UNIFIED_DESKTOP_ADMISSION, CORE_SCHEDULING_ADMISSION, CORE_SCHEDULING_REAL_SOURCE_ADMISSION, TASK_CARRIER]) {
  assert.ok(
    contract.ACTIVE_DOCUMENTS.includes(activeMigrationDocument),
    `${activeMigrationDocument} must be covered once full-business migration is active`
  );
}
assert.deepStrictEqual(
  contract.checkCloudBusinessAuthorityContract().issues,
  [],
  'active architecture documents must agree that cloud is the business and structured-question authority, while NAS holds rich media only'
);

const texts = Object.fromEntries(
  contract.ACTIVE_DOCUMENTS.map(relativePath => [
    relativePath,
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'),
  ])
);
const regressedDesktopAdmissionTexts = {
  ...texts,
  [UNIFIED_DESKTOP_ADMISSION]: `${texts[UNIFIED_DESKTOP_ADMISSION]}\nHuman device approval is required.\n`,
};
assert.ok(
  contract.checkContractTexts(regressedDesktopAdmissionTexts).issues.some(issue => issue.includes(UNIFIED_DESKTOP_ADMISSION) && issue.includes('desktop-registration contradiction')),
  'the executable gate must reject reintroducing manual device approval into the active unified-desktop admission design'
);
const regressedTexts = {
  ...texts,
  'AGENTS.md': `${texts['AGENTS.md']}\n本地数据主机保存全量权威业务数据。\n`,
};
assert.ok(
  contract.checkContractTexts(regressedTexts).issues.some(issue => issue.includes('local-business-authority contradiction')),
  'the executable gate must reject reintroducing local business authority into active instructions'
);
const regressedDecisionTexts = {
  ...texts,
  [DATABASE_DECISION]: `${texts[DATABASE_DECISION]}\ncontrol-plane-only; does not move business authority to the cloud\n`,
};
assert.ok(
  contract.checkContractTexts(regressedDecisionTexts).issues.some(issue => issue.includes(DATABASE_DECISION) && issue.includes('local-business-authority contradiction')),
  'the executable gate must reject reintroducing a control-plane-only production database decision'
);
const regressedDictionaryTexts = {
  ...texts,
  [SOURCE_DICTIONARY]: `${texts[SOURCE_DICTIONARY]}\nIt rejects every business-domain table by default.\n`,
};
assert.ok(
  contract.checkContractTexts(regressedDictionaryTexts).issues.some(issue => issue.includes(SOURCE_DICTIONARY) && issue.includes('local-business-authority contradiction')),
  'the executable gate must reject returning the active data dictionary to a control-plane-only allow-list'
);
const regressedSourceEvidenceTexts = {
  ...texts,
  [SOURCE_DICTIONARY]: `${texts[SOURCE_DICTIONARY]}\nThe first approved legacy desktop root is known to contain no question-bank or personal-asset source data.\n`,
};
assert.ok(
  contract.checkContractTexts(regressedSourceEvidenceTexts).issues.some(issue => issue.includes(SOURCE_DICTIONARY) && issue.includes('contradiction')),
  'the executable gate must reject treating a user-declared absence as proof that a source relation is absent'
);
const regressedRealSourceAdmissionTexts = {
  ...texts,
  [CORE_SCHEDULING_REAL_SOURCE_ADMISSION]: `${texts[CORE_SCHEDULING_REAL_SOURCE_ADMISSION]}\nReal SQLite row reads are authorized and student contact details may be written to the migration report.\n`,
};
assert.ok(
  contract.checkContractTexts(regressedRealSourceAdmissionTexts).issues.some(issue => issue.includes(CORE_SCHEDULING_REAL_SOURCE_ADMISSION) && issue.includes('real-source-admission contradiction')),
  'the executable gate must reject authorizing real-row reads or PII-bearing reports before the reviewed admission gates pass'
);
const regressedTaskTexts = {
  ...texts,
  [TASK_CARRIER]: texts[TASK_CARRIER].replace(
    '<!-- current-architecture-contract:end -->',
    'The local data host remains the sole business authority.\nHuman device approval is required.\n<!-- current-architecture-contract:end -->'
  ),
};
assert.ok(
  contract.checkContractTexts(regressedTaskTexts).issues.some(issue => issue.includes(TASK_CARRIER) && issue.includes('local-business-authority contradiction')),
  'the executable gate must reject a local-business-authority claim inside the current task contract'
);

console.log('cloud business authority architecture contract checks passed');
