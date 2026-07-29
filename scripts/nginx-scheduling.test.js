const assert = require('assert');
const fs = require('fs');

const config = fs.readFileSync('scripts/nginx-scheduling.conf', 'utf8');
const schedulingLocation = config.match(/location\s+\/scheduling\/\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';

assert.ok(schedulingLocation.includes('proxy_pass http://172.18.0.1:3001/;'));
assert.ok(schedulingLocation.includes('proxy_http_version 1.1;'));
assert.ok(schedulingLocation.includes('proxy_set_header Upgrade $http_upgrade;'));
assert.ok(schedulingLocation.includes('proxy_set_header Connection "upgrade";'));

console.log('nginx scheduling WebSocket proxy checks passed');
