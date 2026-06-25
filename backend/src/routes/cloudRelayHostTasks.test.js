const assert = require('assert');
const fs = require('fs');

const route = fs.readFileSync('backend/src/routes/cloudRelayHost.js', 'utf-8');
const packageJson = fs.readFileSync('package.json', 'utf-8');

assert.ok(route.includes('processMiniappTask'), 'host cloud relay route should process miniapp tasks');
assert.ok(route.includes("task.task_type === 'question-paper'"), 'host should process miniapp paper assembly tasks');
assert.ok(route.includes("task.task_type === 'paper-export-word'"), 'host should process miniapp Word export tasks');
assert.ok(route.includes("task.task_type === 'paper-export-pdf'"), 'host should process miniapp PDF export tasks');
assert.ok(route.includes('completeMiniappTask(task.id'), 'host should complete miniapp tasks back to cloud');
assert.ok(route.includes("router.post('/tasks/process'"), 'host should expose a process pending tasks endpoint');
assert.ok(packageJson.includes('backend/src/routes/cloudRelayHostTasks.test.js'), 'host task processing test should run in npm test');

console.log('cloudRelayHost task processing checks passed');
