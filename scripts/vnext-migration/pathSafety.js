'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function pathError(code) {
  return Object.assign(new Error(code), { code });
}

function requirePath(value, code) {
  const candidate = String(value || '').trim();
  if (!candidate) throw pathError(code);
  return path.resolve(candidate);
}

function resolveExistingDirectory(value) {
  const resolved = requirePath(value, 'MIGRATION_SOURCE_DIRECTORY_MISSING');
  if (!fs.existsSync(resolved)) throw pathError('MIGRATION_SOURCE_DIRECTORY_MISSING');
  const real = fs.realpathSync(resolved);
  if (!fs.statSync(real).isDirectory()) throw pathError('MIGRATION_SOURCE_DIRECTORY_REQUIRED');
  return real;
}

function resolveExistingFile(value) {
  const resolved = requirePath(value, 'MIGRATION_SOURCE_FILE_MISSING');
  if (!fs.existsSync(resolved)) throw pathError('MIGRATION_SOURCE_FILE_MISSING');
  const real = fs.realpathSync(resolved);
  if (!fs.statSync(real).isFile()) throw pathError('MIGRATION_SOURCE_FILE_REQUIRED');
  return real;
}

function comparable(value) {
  const normalized = path.normalize(path.resolve(value)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function containsPath(parent, child) {
  const parentComparable = comparable(parent);
  const childComparable = comparable(child);
  if (parentComparable === childComparable) return true;
  return childComparable.startsWith(`${parentComparable}${path.sep}`);
}

function resolveForComparison(value) {
  const resolved = requirePath(value, 'MIGRATION_PATH_REQUIRED');
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function assertDisjointPaths({ sources = [], output } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) throw pathError('MIGRATION_SOURCES_REQUIRED');
  const resolvedSources = sources.map(resolveForComparison);
  const resolvedOutput = resolveForComparison(output);
  for (const source of resolvedSources) {
    if (containsPath(source, resolvedOutput) || containsPath(resolvedOutput, source)) {
      throw pathError('MIGRATION_OUTPUT_OVERLAPS_SOURCE');
    }
  }
  return { sources: resolvedSources, output: resolvedOutput };
}

function assertSafeOutputRoot(value) {
  const output = requirePath(value, 'MIGRATION_OUTPUT_REQUIRED');
  const parsed = path.parse(output);
  if (comparable(output) === comparable(parsed.root)) throw pathError('MIGRATION_OUTPUT_ROOT_FORBIDDEN');
  if (fs.existsSync(output)) throw pathError('MIGRATION_OUTPUT_ALREADY_EXISTS');
  const parent = path.dirname(output);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw pathError('MIGRATION_OUTPUT_PARENT_MISSING');
  }
  return output;
}

function summarizePath(value, label) {
  const resolved = requirePath(value, 'MIGRATION_PATH_REQUIRED');
  const safeLabel = String(label || '').trim();
  if (!safeLabel) throw pathError('MIGRATION_PATH_LABEL_REQUIRED');
  return Object.freeze({
    label: safeLabel,
    pathHash: crypto.createHash('sha256').update(comparable(resolved), 'utf8').digest('hex'),
  });
}

module.exports = {
  assertDisjointPaths,
  assertSafeOutputRoot,
  resolveExistingDirectory,
  resolveExistingFile,
  summarizePath,
};
