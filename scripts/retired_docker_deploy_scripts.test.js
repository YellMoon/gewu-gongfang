'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const name of ['docker_deploy.py', 'docker_deploy2.py', 'docker_deploy3.py']) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
  assert.ok(!source.includes('ssh.connect('), `${name} must not retain a direct SSH connection`);
  assert.ok(source.includes('deploy_cloud_business_api.py'), `${name} must point to the controlled cloud deployment entrypoint`);
  assert.ok(source.includes('RETIRED_UNSAFE_DOCKER_DEPLOY_SCRIPT'), `${name} must fail closed when invoked`);
}

console.log('retired Docker deploy script checks passed');
