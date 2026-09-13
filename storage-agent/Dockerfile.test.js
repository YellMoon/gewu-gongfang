'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');
const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');

assert.match(dockerfile, /^FROM node:20-alpine$/m, 'the NAS agent must use the validated Node Alpine runtime');
assert.match(dockerfile, /^RUN apk add --no-cache python3 ruby ruby-nokogiri$/m,
  'the Linux importer must include the MathType runtime, not silently depend on the desktop Ruby installation');
assert.match(dockerfile, /gem install --no-document --ignore-dependencies ruby-ole:1\.2\.13\.1 bindata:2\.5\.1 mathtype:0\.0\.8 mathtype_to_mathml_plus:0\.0\.16/,
  'MathType converter dependencies must use the versions validated with the original Word files');
assert.match(dockerfile, /ruby -e "require 'json'; require 'mathtype_to_mathml_plus'"/,
  'image build must fail when the converter or a transitive runtime dependency is missing');
assert.match(dockerfile, /^COPY shared \/app\/shared$/m, 'the NAS agent must include the encrypted relay implementation');
assert.match(dockerfile, /^COPY storage-agent \/app\/storage-agent$/m, 'the NAS agent must include its runtime');
assert.match(dockerfile, /^COPY modules\/question-bank\/parsers\/\*\.py \/app\/modules\/question-bank\/parsers\/$/m,
  'the NAS image must copy only source files from the parser bundle, never local tests or bytecode');
assert.match(dockerfile, /^ENV PYTHONDONTWRITEBYTECODE=1$/m, 'the NAS image must execute the hashed Python sources instead of untracked bytecode');
assert.match(dockerfile, /^CMD \["node", "src\/launch\.js", "\/nas-storage\/agent\.env"\]$/m, 'the NAS agent must load its dedicated mounted launch configuration before starting');
assert.match(dockerignore, /^__pycache__\/$/m, 'local Python bytecode directories must not enter the NAS image build context');
assert.match(dockerignore, /^\*\.py\[cod\]$/m, 'local Python bytecode files must not enter the NAS image build context');

console.log('storage agent Docker build context checks passed');
