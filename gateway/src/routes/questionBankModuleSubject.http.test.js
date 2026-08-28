'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('gateway/src/app.js', 'utf8');

assert.ok(!source.includes("require('./config/moduleLoader')"),
  'gateway must not import the retired local module loader');
assert.ok(!source.includes("require('./routes/modules')"),
  'gateway must not import the retired local module catalog');
assert.ok(!source.includes("app.use('/api/modules'"),
  'gateway must not expose the retired local module catalog endpoint');
assert.ok(!source.includes('loadModules()'),
  'gateway must not mount local scheduling or question-bank HTTP modules');

console.log('gateway local module retirement checks passed');
