'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(source, /assertFixedSuperAdminVerified\(\);/u, 'direct server startup must not bypass the invariant gate');
assert.match(source, /resolveActiveVerifiedPhone:\s*async input/u);
assert.match(source, /vnext_control_plane\.vnext_accounts[\s\S]*status='active'/u);
assert.match(source, /vnext_control_plane\.vnext_verified_contacts[\s\S]*contact_type='phone'[\s\S]*verification_state='verified'[\s\S]*revoked_at IS NULL/u);
assert.match(source, /LIMIT 2[\s\S]*result\.rows\.length === 1/u, 'ambiguous or missing active phones must fail closed');
console.log('desktop password active-phone server wiring checks passed');
