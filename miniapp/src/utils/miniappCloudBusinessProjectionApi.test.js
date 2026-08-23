'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'api.ts'), 'utf8');

assert.match(source, /async readBusinessProjection\(token: string\)/, 'miniapp must request its core read model from the cloud business API');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-projection'\)/, 'miniapp core reads must use the scoped cloud projection route');
assert.match(source, /response\.data as \{ ok: true; projection: any \}/, 'miniapp must retain the cloud projection response shape');
assert.match(source, /async listQuestionPreviews\(token: string\)/, 'miniapp question previews must use the cloud business API');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-question-previews'\)/, 'question previews must not use the retired generic API');
assert.match(source, /async createPaperExportTask\(token: string, taskType: 'paper-export-word' \| 'paper-export-pdf'/, 'miniapp may submit only the two cloud export task types');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-paper-export-tasks'\)/, 'paper exports must use the limited cloud task route');
assert.match(source, /async requestPaperExportDelivery\(token: string, taskId: string\)/, 'miniapp must request a short-lived cloud delivery for completed exports');
assert.match(source, /miniapp-paper-export-tasks\/\$\{encodeURIComponent\(taskId\)\}\/delivery/, 'delivery requests must stay bound to one completed task');
assert.match(source, /async downloadPaperExportDelivery\(token: string, deliveryId: string\)/, 'miniapp must download only through the scoped cloud delivery route');
assert.match(source, /async importPersonalAssets\(token: string, records: any\[\], idempotencyKey: string\)/, 'miniapp personal assets must submit parsed records to cloud');
assert.match(source, /cloudBusinessUrl\('\/api\/business\/miniapp-personal-assets\/import'\)/, 'personal assets must not use the retired generic task route');

console.log('miniapp cloud business projection API checks passed');
