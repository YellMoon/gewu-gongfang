'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'api.ts'), 'utf8');

assert.match(source, /async readBusinessProjection\(token: string\)/, 'miniapp must request its core read model from the cloud business API');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-projection'\)/, 'miniapp core reads must use the scoped cloud projection route');
assert.match(source, /response\.data as \{ ok: true; projection: any \}/, 'miniapp must retain the cloud projection response shape');
assert.match(source, /async listQuestionPreviews\(token: string, options:/, 'miniapp question previews must use bounded cloud cursor pages');
for (const field of ['subject', 'query', 'source', 'knowledgePoint', 'type', 'difficulty']) {
  assert.match(source, new RegExp(`${field}\\?:`), `miniapp question previews must expose the cloud ${field} filter`);
  assert.match(source, new RegExp(`${field}: options\\.${field}`), `miniapp question previews must forward the cloud ${field} filter`);
}
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-question-previews'\)/, 'question previews must not use the retired generic API');
assert.match(source, /limit: options\.limit/, 'question preview requests must forward the bounded page size');
assert.match(source, /cursor: options\.cursor/, 'question preview requests must forward the opaque cloud cursor');
assert.match(source, /const requestData = Object\.fromEntries\(Object\.entries\(\{[\s\S]*?\}\)\.filter\(\(\[, value\]\) => value !== undefined\)\);/, 'question preview requests must omit absent filters instead of serializing them as the literal string undefined');
assert.match(source, /data: requestData/, 'question preview requests must send only the compact query object');
assert.match(source, /data\.hasMore === undefined \|\| typeof data\.hasMore === 'boolean'/, 'a rolling upgrade must continue to accept the previous cloud response without the look-ahead flag');
assert.match(source, /hasMore: data\.hasMore === true/, 'the missing legacy look-ahead flag must safely default to no extra questions');
assert.match(source, /nextCursor: typeof data\.nextCursor === 'string' \? data\.nextCursor : null/, 'question preview responses must preserve the cloud continuation cursor without decoding it locally');
assert.match(source, /total: Number\.isSafeInteger\(data\.total\)/, 'the client must retain the authoritative filtered total');
assert.match(source, /filterOptions:/, 'the client must retain authoritative filter choices rather than deriving them from one loaded page');
assert.match(source, /async requestQuestionAssetDelivery\(token: string, questionId: string, assetKey: string\)/, 'miniapp question media must request a short-lived delivery bound to the visible question');
assert.match(source, /data: \{ questionId \}/, 'miniapp asset deliveries must name the visible question');
assert.match(source, /miniapp-question-assets\/\$\{encodeURIComponent\(assetKey\)\}\/delivery/, 'question media delivery must stay bound to the immutable asset key');
assert.match(source, /async downloadQuestionAssetDelivery\(token: string, deliveryId: string\)/, 'miniapp question media must download only a prepared delivery');
assert.match(source, /async createPaperExportTask\(token: string, taskType: 'paper-export-word' \| 'paper-export-pdf'/, 'miniapp may submit only the two cloud export task types');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-paper-export-tasks'\)/, 'paper exports must use the limited cloud task route');
assert.match(source, /async requestPaperExportDelivery\(token: string, taskId: string\)/, 'miniapp must request a short-lived cloud delivery for completed exports');
assert.match(source, /miniapp-paper-export-tasks\/\$\{encodeURIComponent\(taskId\)\}\/delivery/, 'delivery requests must stay bound to one completed task');
assert.match(source, /async downloadPaperExportDelivery\(token: string, deliveryId: string\)/, 'miniapp must download only through the scoped cloud delivery route');
assert.match(source, /async importPersonalAssets\(token: string, records: any\[\], idempotencyKey: string\)/, 'miniapp personal assets must submit parsed records to cloud');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-personal-assets\/import'\)/, 'personal assets must not use the retired generic task route');

console.log('miniapp cloud business projection API checks passed');
