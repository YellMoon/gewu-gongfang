const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/services/mutationQueue.ts', 'utf-8');

assert.ok(source.includes('export type SyncOperation'), 'should export SyncOperation');
assert.ok(source.includes('class LocalMutationQueue'), 'should define LocalMutationQueue');
assert.ok(source.includes('riskLevel'), 'operations should include riskLevel');
assert.ok(source.includes('baseVersion'), 'operations should include baseVersion');
assert.ok(source.includes('clearApplied'), 'queue should clear only applied operation ids');

assert.ok(source.includes("classifyRisk('students'") || source.includes('function classifyRisk'), 'should classify operation risk');
assert.ok(source.includes('createSyncOperation'), 'should create sync operations');
assert.ok(source.includes('operationToChange'), 'should convert operations to legacy SyncChange');

console.log('mutationQueue source checks passed');
