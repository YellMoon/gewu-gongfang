'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');

assert.match(dockerfile, /^FROM node:20-alpine$/m, 'the NAS agent must use the validated Node Alpine runtime');
assert.match(dockerfile, /^RUN apk add --no-cache python3$/m, 'the Word parser must install Python through the validated Alpine package source without retaining package-manager cache');
assert.match(dockerfile, /^COPY shared \/app\/shared$/m, 'the NAS agent must include the encrypted relay implementation');
assert.match(dockerfile, /^COPY storage-agent \/app\/storage-agent$/m, 'the NAS agent must include its runtime');
assert.match(dockerfile, /^COPY modules\/question-bank\/parsers \/app\/modules\/question-bank\/parsers$/m, 'the NAS agent must include the immutable Word parser');
assert.match(dockerfile, /^CMD \["node", "src\/main\.js"\]$/m, 'the NAS agent must accept secrets only as runtime environment variables');

console.log('storage agent Docker build context checks passed');
