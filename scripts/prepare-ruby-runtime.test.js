const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'prepare-ruby-runtime.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

assert.ok(source.includes('GEWU_RUBY_RUNTIME_SOURCE'), 'runtime source must be configurable');
assert.ok(source.includes("require 'mathtype_to_mathml_plus'"), 'readiness must execute the real converter require');
assert.ok(source.includes('fs.cpSync'), 'reviewed runtime should be copied recursively');
assert.ok(packageJson.scripts.build.includes('prepare-ruby-runtime.js'), 'production build must prepare Ruby');
assert.ok(packageJson.build.files.includes('runtime/ruby/**/*'), 'desktop package must include Ruby');
assert.ok(packageJson.build.asarUnpack.includes('runtime/ruby/**/*'), 'Ruby runtime must remain unpacked');

console.log('prepare Ruby runtime checks passed');
