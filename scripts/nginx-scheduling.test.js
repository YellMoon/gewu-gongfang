const assert = require('assert');
const fs = require('fs');

const config = fs.readFileSync('scripts/nginx-scheduling.conf', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const schedulingLocation = config.match(/location\s+\/scheduling\/\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
const cloudBusinessLocation = config.match(/location\s+\/cloud-business\/\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';

assert.ok(schedulingLocation.includes('proxy_pass http://172.18.0.1:3001/;'));
assert.ok(schedulingLocation.includes('proxy_http_version 1.1;'));
assert.ok(schedulingLocation.includes('proxy_set_header Upgrade $http_upgrade;'));
assert.ok(schedulingLocation.includes('proxy_set_header Connection "upgrade";'));
assert.ok(cloudBusinessLocation.includes('proxy_pass http://172.18.0.1:3002/;'), 'cloud business API must have its own public HTTPS path');
assert.ok(schedulingLocation.includes('client_max_body_size 96m;'), 'desktop Word import must not be rejected by the default Nginx body limit');
assert.ok(cloudBusinessLocation.includes('client_max_body_size 96m;'), 'cloud business uploads must share the explicit body limit');
assert.ok(cloudBusinessLocation.includes('proxy_set_header Host $host;'), 'cloud business API must receive the original host header');
assert.ok(cloudBusinessLocation.includes('proxy_set_header X-Forwarded-Proto $scheme;'), 'cloud business API must receive the HTTPS forwarding scheme');
assert.ok(packageJson.scripts['test:release-matrix'].includes('scripts/nginx-scheduling.test.js'), 'release checks must run the cloud-business proxy contract');

console.log('nginx scheduling WebSocket proxy checks passed');
