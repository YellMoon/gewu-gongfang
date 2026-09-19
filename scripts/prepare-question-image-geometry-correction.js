'use strict';
// Pure, reviewed repair. Preserve every node and all business fields; fill only
// missing image dimensions proven by the original source and verified media.
const crypto = require('node:crypto');
const { stableJson } = require('../shared/authorityProtocol');
const { changesForPublishedQuestion } = require('./real-question-import-publish');
const fail = code => { throw Error(`IMAGE_GEOMETRY_CORRECTION_${code}`); };
const equal = (a, b) => stableJson(a) === stableJson(b);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const dimension = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000;

function imageEntries(value, path = [], result = []) {
  if (path.length > 80 || result.length > 2000) fail('SOURCE_MISMATCH');
  if (!value || typeof value !== 'object') return result;
  if (value.type === 'image') result.push({ node: value, path });
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('SOURCE_MISMATCH');
    if (child && typeof child === 'object') imageEntries(child, [...path, key], result);
  }
  return result;
}

function withoutGeometry(node) {
  const copy = structuredClone(node);
  if (!copy.attrs || typeof copy.attrs !== 'object' || Array.isArray(copy.attrs)) fail('SOURCE_MISMATCH');
  delete copy.attrs.width; delete copy.attrs.height;
  return copy;
}

function prepareImageGeometryCorrection({ current, baseline, sourceBefore, sourceAfter } = {}) {
  if (!current || !baseline || !equal(current, baseline)
    || !/^question-import-[a-f0-9]{40}$/.test(current.id || '')
    || !Number.isSafeInteger(current.version) || current.version < 1 || current.status !== 'published') fail('STATE_CHANGED');
  if (!sourceBefore || !sourceAfter || !isHash(sourceBefore.sourceSha256)
    || sourceBefore.verifiedSourceSha256 !== sourceBefore.sourceSha256
    || sourceAfter.sourceSha256 !== sourceBefore.sourceSha256
    || !/^question_import_task_[A-Za-z0-9_-]{1,128}$/.test(sourceBefore.taskId || '')
    || !Number.isSafeInteger(sourceBefore.itemIndex) || sourceBefore.itemIndex < 0
    || sourceBefore.itemIndex !== sourceAfter.itemIndex
    || !isHash(sourceBefore.contentHash) || current.id !== `question-import-${sourceBefore.contentHash.slice(0, 40)}`
    || !Array.isArray(sourceBefore.media) || !Array.isArray(sourceAfter.assets)
    || current.rich_content?.type !== 'question-document' || sourceAfter.rich_content?.type !== 'question-document') fail('SOURCE_MISMATCH');
  const rich = structuredClone(current.rich_content);
  const before = imageEntries(rich), after = imageEntries(sourceAfter.rich_content);
  if (before.length !== after.length) fail('SOURCE_MISMATCH');
  const media = new Map();
  for (const asset of sourceAfter.assets) {
    if (!isHash(asset?.content_hash) || typeof asset.data_url !== 'string') fail('SOURCE_MISMATCH');
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(asset.data_url);
    if (!match || match[1] !== asset.mime_type) fail('SOURCE_MISMATCH');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.toString('base64') !== match[2] || sha(bytes) !== asset.content_hash) fail('SOURCE_MISMATCH');
    if (!sourceBefore.media.some(item => item.sha256 === asset.content_hash && item.bytes === bytes.length && item.state === 'verified')) fail('SOURCE_MISMATCH');
    media.set(asset.content_hash, bytes.length);
  }
  let changes = 0;
  for (let index = 0; index < before.length; index++) {
    const target = before[index], source = after[index], attrs = source.node.attrs;
    if (!equal(target.path, source.path) || !equal(withoutGeometry(target.node), withoutGeometry(source.node))
      || !isHash(attrs.assetKey) || attrs.src !== `question-asset://${attrs.assetKey}`
      || !media.has(attrs.assetKey) || !dimension(attrs.width) || !dimension(attrs.height)) fail('SOURCE_MISMATCH');
    for (const name of ['width', 'height']) {
      const existing = target.node.attrs[name];
      if (existing !== undefined && existing !== null) {
        if (!dimension(existing) || existing !== attrs[name]) fail('EXISTING_GEOMETRY');
      } else { target.node.attrs[name] = attrs[name]; changes++; }
    }
  }
  if (!changes) fail('NO_CHANGES');
  const type = 'question.update.v1';
  const payload = { id: current.id, expectedVersion: current.version,
    changes: changesForPublishedQuestion({ ...current, rich_content: rich }) };
  const payloadHash = sha(stableJson({ type, payload }));
  return { commandId: `image-geometry-source-correction-${payloadHash.slice(0, 40)}`, payloadHash, type, payload };
}
module.exports = Object.freeze({ prepareImageGeometryCorrection });
