const assert = require('assert');
const fs = require('fs');
const path = require('path');

const contract = require('./check_cloud_business_authority_contract');
const DATABASE_DECISION = 'docs/superpowers/specs/2026-08-14-vnext-production-control-plane-database-decision.md';

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

console.log('cloud business authority architecture contract checks passed');
