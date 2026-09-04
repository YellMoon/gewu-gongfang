'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.match(source, /createCloudDesktopIdentityService/);
assert.match(source, /createCloudDesktopIdentityPgRepository/);
assert.match(source, /const desktopCloudIdentity = createCloudDesktopIdentityService\(/);
assert.match(source, /repository: createCloudDesktopIdentityPgRepository\(\{ writerPool \}\)/);
assert.match(source, /sessionContext: input => registration\.sessionContext\(input\)/);
assert.match(source, /issueSession: input => registration\.issueSession\(input\)/);
assert.match(source, /s\.row_version AS "rowVersion"/,
  'the signed desktop role-elevation proof must bind to the current cloud session version');
assert.match(source, /desktopCloudIdentity: desktopRuntime\?\.desktopCloudIdentity \|\| null/);
assert.doesNotMatch(source, /embedded.*desktop-identity|desktop-identity.*embedded/i,
  'removed embedded identity routes must not be restored');

console.log('cloud desktop identity server wiring checks passed');
