const assert = require('assert');
const fs = require('fs');

const manager = fs.readFileSync('src/components/TaxonomyManager.tsx', 'utf8');
const preview = fs.readFileSync('src/pages/QuestionBankPreview.tsx', 'utf8');
const importer = fs.readFileSync('src/pages/QuestionBankImport.tsx', 'utf8');
const database = fs.readFileSync('src/services/browserDatabase.ts', 'utf8');
const schema = fs.readFileSync('backend/src/schema.sql', 'utf8');

for (const method of [
  'createTaxonomySystem', 'updateTaxonomySystem', 'deleteTaxonomySystem',
  'createTaxonomyNode', 'updateTaxonomyNode', 'deleteTaxonomyNode',
]) assert.ok(manager.includes(method), `taxonomy manager must expose ${method}`);

assert.ok(manager.includes('removeSystemBody'));
assert.ok(manager.includes('database.deleteTaxonomySystem(system.id)'));
assert.ok(preview.includes('<TaxonomyManager'));
assert.ok(importer.includes('<TaxonomyManager'));
assert.ok(preview.includes('taxonomySelections'));
assert.ok(preview.includes('includeGroups'));
assert.ok(preview.includes('excludeIds'));
assert.ok(preview.includes("name={['taxonomy_ids', systemId, node.id]}"));
assert.ok(importer.includes("name={['taxonomy_ids', systemId, node.id]}"));
assert.ok(database.includes("subject: '\\u7269\\u7406'"));
assert.ok(database.includes("ensure('knowledge', '\\u77e5\\u8bc6\\u70b9'"));
assert.ok(database.includes("ensure('model', '\\u6a21\\u578b'"));
assert.ok(database.includes("if (question.taxonomy_ids) delete question.taxonomy_ids[id]"));
for (const table of ['taxonomy_systems', 'taxonomy_nodes', 'question_taxonomy_nodes']) {
  assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
}

console.log('taxonomy manager integration checks passed');
