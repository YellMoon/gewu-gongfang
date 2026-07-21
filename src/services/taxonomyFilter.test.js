const assert = require('assert');

(async () => {
  const { matchesTaxonomyFilters } = await import('./taxonomyFilter.mjs');
  const labels = { systemA: ['a-child', 'a-second'], systemB: ['b-root'] };
  assert.strictEqual(matchesTaxonomyFilters(labels, {}), true);
  assert.strictEqual(matchesTaxonomyFilters(labels, {
    systemA: { includeGroups: [['a-root', 'a-child']], excludeIds: [] },
  }), true);
  assert.strictEqual(matchesTaxonomyFilters(labels, {
    systemA: { includeGroups: [['a-child'], ['a-second']], excludeIds: [] },
  }), true, 'multiple include selections use AND between groups');
  assert.strictEqual(matchesTaxonomyFilters(labels, {
    systemA: { includeGroups: [['a-child']], excludeIds: ['a-second'] },
  }), false, 'exclude wins when a question has an excluded node');
  assert.strictEqual(matchesTaxonomyFilters(labels, {
    systemB: { includeGroups: [['missing']], excludeIds: [] },
  }), false, 'each system is filtered independently');
  console.log('taxonomy filter checks passed');
})().catch(error => { console.error(error); process.exit(1); });
