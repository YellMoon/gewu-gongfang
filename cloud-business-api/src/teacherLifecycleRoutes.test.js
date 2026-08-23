'use strict';

const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync('src/app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

assert.ok(source.includes("app.post('/api/business/teachers'"), 'teacher creation route must exist');
assert.ok(source.includes("app.put('/api/business/teachers/:teacherId'"), 'teacher update route must exist');
assert.ok(source.includes("app.delete('/api/business/teachers/:teacherId'"), 'teacher deletion route must exist');
assert.ok(source.includes('businessTeacherLifecycleMutations'), 'teacher routes must use cloud lifecycle mutations');
assert.ok(server.includes('createBusinessTeacherLifecycleMutations'), 'server must provide the teacher cloud mutation runtime');
console.log('teacher lifecycle route source checks passed');
