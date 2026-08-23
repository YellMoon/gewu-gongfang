'use strict';

const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('src/app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

assert.ok(source.includes("app.post('/api/business/courses'"), 'course creation route must exist');
assert.ok(source.includes("app.put('/api/business/courses/:courseId'"), 'course update route must exist');
assert.ok(source.includes("app.delete('/api/business/courses/:courseId'"), 'course deletion route must exist');
assert.ok(source.includes('businessCourseLifecycleMutations'), 'course routes must use cloud lifecycle mutations');
assert.ok(server.includes('createBusinessCourseLifecycleMutations'), 'server must provide the course cloud mutation runtime');
console.log('course lifecycle route source checks passed');
