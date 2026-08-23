'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync(__dirname + '/unrecognizedExperience.js', 'utf8');
assert.ok(source.includes("router.post('/tasks'"));
assert.ok(source.includes("router.post('/tasks/:taskId/cancel'"));
assert.ok(!source.includes("router.get('/artifacts/:artifactId'"));
assert.ok(!source.includes("fs.readFileSync(artifact.filePath)"));
console.log('unrecognized experience route retirement checks passed');
