'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '20260823-cloud-question-authority.sql'), 'utf8');

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
assert.match(sql, /CREATE TABLE business\.questions/u);
assert.match(sql, /CREATE TABLE business\.question_contents/u);
assert.match(sql, /CREATE TABLE business\.question_assets/u);
assert.match(sql, /taxonomy_json jsonb NOT NULL DEFAULT '\{\}'::jsonb/u);
assert.match(sql, /storage_object_id text COLLATE "C" NOT NULL CHECK \(storage_object_id ~ '\^obj_\[A-Za-z0-9_-\]\{1,128\}\$'\)/u);
assert.match(sql, /state text COLLATE "C" NOT NULL CHECK \(state IN \('queued','verified','deleted'\)\)/u);
assert.match(sql, /REVOKE ALL ON TABLE business\.questions, business\.question_contents, business\.question_assets FROM PUBLIC;/u);
assert.doesNotMatch(sql, /storage_state|host_committed|local_draft|root_path|oss_url|oss_key|data_url|file_path|nas[_ -]?path|smb:|\\\\/iu, 'cloud question authority must store text and NAS object references only');

console.log('cloud question authority SQL checks passed');
