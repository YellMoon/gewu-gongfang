'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');
const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');

assert.match(dockerfile, /^FROM node:20-alpine$/m, 'the NAS agent must use the validated Node Alpine runtime');
assert.match(dockerfile, /^RUN apk add --no-cache python3$/m, 'the Word parser must install Python through the validated Alpine package source without retaining package-manager cache');
assert.match(dockerfile, /^COPY shared \/app\/shared$/m, 'the NAS agent must include the encrypted relay implementation');
assert.match(dockerfile, /^COPY storage-agent \/app\/storage-agent$/m, 'the NAS agent must include its runtime');
assert.match(dockerfile, /^COPY modules\/question-bank\/parsers\/\*\.py \/app\/modules\/question-bank\/parsers\/$/m,
  'the NAS image must copy only source files from the parser bundle, never local tests or bytecode');
assert.match(dockerfile, /^ENV PYTHONDONTWRITEBYTECODE=1$/m, 'the NAS image must execute the hashed Python sources instead of untracked bytecode');
assert.match(dockerfile, /^CMD \["node", "src\/launch\.js", "\/nas-storage\/agent\.env"\]$/m, 'the NAS agent must load its dedicated mounted launch configuration before starting');
assert.match(dockerignore, /^__pycache__\/$/m, 'local Python bytecode directories must not enter the NAS image build context');
assert.match(dockerignore, /^\*\.py\[cod\]$/m, 'local Python bytecode files must not enter the NAS image build context');

console.log('storage agent Docker build context checks passed');
