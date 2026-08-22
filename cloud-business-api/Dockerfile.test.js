'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');
assert.match(dockerfile, /^COPY cloud-business-api\/package\.json \.\/$/m, 'the cloud image must be built from the repository root');
assert.match(dockerfile, /^COPY cloud-business-api\/server\.js \.\/$/m);
assert.match(dockerfile, /^COPY cloud-business-api\/src \.\/src$/m);
assert.match(dockerfile, /^COPY cloud-business-api\/sql \.\/sql$/m, 'the cloud image must include versioned database migrations');
assert.match(dockerfile, /^COPY cloud-business-api\/scripts \.\/scripts$/m, 'the cloud image must include the migration runner');
assert.match(dockerfile, /^COPY shared \/shared$/m, 'the runtime must include the shared encrypted-relay module');
console.log('cloud business Docker build context checks passed');
