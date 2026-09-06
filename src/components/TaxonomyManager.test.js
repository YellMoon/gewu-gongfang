const assert = require('assert');
const fs = require('fs');

const manager = fs.readFileSync('src/components/TaxonomyManager.tsx', 'utf8');
const preview = fs.readFileSync('src/pages/QuestionBankPreview.tsx', 'utf8');
const importer = fs.readFileSync('src/pages/QuestionBankImport.tsx', 'utf8');
const tools = fs.readFileSync('src/pages/QuestionBankTools.tsx', 'utf8');
const workbench = fs.readFileSync('src/pages/TodayWorkbench.tsx', 'utf8');
const globalStyles = fs.readFileSync('src/index.css', 'utf8');
const database = fs.readFileSync('src/services/browserDatabase.ts', 'utf8');
const schema = fs.readFileSync('backend/src/schema.sql', 'utf8');
const legacyRoutePath = 'backend/src/routes/questionBank.js';
const cloudQuestionAuthority = fs.readFileSync('cloud-business-api/src/questionAuthorityService.js', 'utf8');

for (const method of [
  'createTaxonomySystem', 'updateTaxonomySystem', 'deleteTaxonomySystem',
  'createTaxonomyNode', 'updateTaxonomyNode', 'deleteTaxonomyNode',
]) assert.ok(manager.includes(method), `taxonomy manager must expose ${method}`);

assert.ok(manager.includes('removeSystemBody'));
assert.ok(manager.includes('getTaxonomySystemDeletionImpact'));
assert.ok(manager.includes('getTaxonomyNodeDeletionImpact'));
assert.ok(manager.includes('affected_question_count'));
assert.ok(manager.includes('expectedAffectedQuestionCount'));
assert.ok(manager.includes('restoreTaxonomyDeletion'));
assert.ok(preview.includes('<TaxonomyManager'));
assert.ok(importer.includes('<TaxonomyManager'));
assert.ok(preview.includes('taxonomySelections'));
assert.ok(preview.includes('includeGroups'));
assert.ok(preview.includes('excludeIds'));
assert.ok(preview.includes('<BranchesOutlined /> \u4f53\u7cfb</span>'), 'question bank sidebar must be named from the unified taxonomy concept');
assert.ok(preview.includes('>\u5c55\u5f00\u4f53\u7cfb</Button>'), 'collapsed question bank sidebar must use the unified taxonomy label');
assert.ok(!preview.includes('placeholder="\u5305\u542b\u77e5\u8bc6\u70b9"'), 'legacy knowledge include filter must not render beside dynamic taxonomy filters');
assert.ok(!preview.includes('placeholder="\u6392\u9664\u77e5\u8bc6\u70b9"'), 'legacy knowledge exclude filter must not render beside dynamic taxonomy filters');
assert.ok(!preview.includes('placeholder="\u6a21\u578b"'), 'legacy model filter must not render beside dynamic taxonomy filters');
assert.ok(importer.includes('<BranchesOutlined /> \u4f53\u7cfb</span>'), 'import sidebar must use the unified taxonomy label');
assert.ok(importer.includes('>\u5c55\u5f00\u4f53\u7cfb</Button>'), 'collapsed import sidebar must use the unified taxonomy label');
assert.ok(!globalStyles.includes(':has(> .taxonomy-manager)'), 'legacy taxonomy trees must not be rendered and hidden through a global CSS selector');
assert.ok(tools.includes('\u5bfc\u5165\u4e0e\u4f53\u7cfb'), 'question bank tools entry must use the unified taxonomy label');
assert.ok(workbench.includes('\u5bfc\u5165\u4e0e\u4f53\u7cfb'), 'workbench entry must use the unified taxonomy label');
assert.ok(preview.includes("name={['taxonomy_ids', systemId, node.id]}"));
assert.ok(importer.includes("name={['taxonomy_ids', systemId, node.id]}"));
assert.ok(database.includes("subject: '\\u7269\\u7406'"));
assert.ok(database.includes("ensure('knowledge', '\\u77e5\\u8bc6\\u70b9'"));
assert.ok(database.includes("ensure('model', '\\u6a21\\u578b'"));
assert.ok(database.includes("if (question.taxonomy_ids) delete question.taxonomy_ids[id]"));
const localSystemDelete = database.slice(database.indexOf('deleteTaxonomySystem('), database.indexOf('getTaxonomyNodes(', database.indexOf('deleteTaxonomySystem(')));
assert.ok(
  localSystemDelete.includes('new Set(annotations.map(item => item.question_id))'),
  'system deletion must enqueue every question whose taxonomy annotation was removed, including legacy rows missing relation records',
);
assert.ok(localSystemDelete.includes("status: 'pending'"), 'local deletion audit must not claim success before the destructive save completes');
assert.ok(localSystemDelete.includes("appendTaxonomyDeletionAudit(backupId, 'success'"), 'local deletion audit must record successful completion');
assert.ok(localSystemDelete.includes("appendTaxonomyDeletionAudit(backupId, 'failed'"), 'local deletion audit must record a failed local transaction');
assert.ok(!fs.existsSync(legacyRoutePath),
  'the retired local taxonomy router must not remain available beside the cloud authority');
assert.ok(cloudQuestionAuthority.includes('executeTaxonomyCommand'),
  'taxonomy changes must be adjudicated by the cloud question authority');
assert.ok(cloudQuestionAuthority.includes('vnext_delete_question_taxonomy_system_v1'));
assert.ok(cloudQuestionAuthority.includes('vnext_delete_question_taxonomy_node_v1'));
for (const table of ['taxonomy_systems', 'taxonomy_nodes', 'question_taxonomy_nodes', 'taxonomy_deletion_backups']) {
  assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
}

assert.ok(manager.includes('className="taxonomy-manager__actions"'));
assert.ok(!manager.includes('<Space.Compact block>'), 'taxonomy actions must wrap in narrow sidebars');
assert.match(globalStyles, /\.taxonomy-manager__actions\s*\{[^}]*flex-wrap:\s*wrap/u);
console.log('taxonomy manager integration checks passed');
