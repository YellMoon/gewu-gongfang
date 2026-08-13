'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveExistingDirectory,
  resolveExistingFile,
  summarizePath,
} = require('./pathSafety');

const SOURCE_DEFINITIONS = Object.freeze([
  { sourceId: 'authority-db', kind: 'sqlite', explicitKey: 'db', configKey: 'mainDbPath', type: 'file' },
  { sourceId: 'question-files', kind: 'filesystem', explicitKey: 'files', configKey: 'questionBankPath', type: 'directory' },
  { sourceId: 'question-assets', kind: 'filesystem', explicitKey: 'questionAssets', configKey: 'questionAssetPath', type: 'directory' },
  { sourceId: 'desktop-export', kind: 'desktop-export', explicitKey: 'desktopExport', configKey: 'desktopExportPath', type: 'directory' },
  { sourceId: 'offline-export', kind: 'desktop-export', explicitKey: 'offlineExport', configKey: 'offlineExportPath', type: 'directory' },
  { sourceId: 'local-cache', kind: 'filesystem', explicitKey: 'localCache', configKey: 'localCachePath', type: 'directory' },
  { sourceId: 'nas-backup', kind: 'filesystem', explicitKey: 'nasBackup', configKey: 'nasBackupPath', type: 'directory' },
]);

function discoveryError(code) {
  return Object.assign(new Error(code), { code });
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || '';
}

function readRuntimeConfig(runtimeConfigPath) {
  const candidate = optionalText(runtimeConfigPath);
  if (!candidate) return {};
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw discoveryError('MIGRATION_RUNTIME_CONFIG_MISSING');
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object required');
    }
    return parsed;
  } catch (error) {
    if (error.code === 'MIGRATION_RUNTIME_CONFIG_MISSING') throw error;
    throw discoveryError('MIGRATION_RUNTIME_CONFIG_INVALID');
  }
}

function addPrivateProperty(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: false,
    writable: false,
    value,
  });
}

function comparablePath(value) {
  const normalized = path.normalize(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function discoverSources({ runtimeConfigPath, explicit = {} } = {}) {
  const hasRuntimeConfig = Boolean(optionalText(runtimeConfigPath));
  const hasExplicitSource = Object.values(explicit || {}).some(value => Boolean(optionalText(value)));
  if (!hasRuntimeConfig && !hasExplicitSource) {
    throw discoveryError('MIGRATION_EXPLICIT_SOURCE_REQUIRED');
  }

  const config = readRuntimeConfig(runtimeConfigPath);
  const sources = [];
  const unavailable = [];
  const byRealPath = new Map();

  for (const definition of SOURCE_DEFINITIONS) {
    const explicitCandidate = optionalText(explicit?.[definition.explicitKey]);
    const candidate = explicitCandidate || optionalText(config[definition.configKey]);
    if (!candidate) continue;

    if (!explicitCandidate && definition.sourceId !== 'authority-db'
      && (!fs.existsSync(candidate))) {
      const summary = summarizePath(candidate, definition.sourceId);
      unavailable.push({
        sourceId: definition.sourceId,
        kind: definition.kind,
        label: summary.label,
        pathHash: summary.pathHash,
        code: 'MIGRATION_CONFIGURED_SOURCE_UNAVAILABLE',
      });
      continue;
    }

    const resolvedPath = definition.type === 'file'
      ? resolveExistingFile(candidate)
      : resolveExistingDirectory(candidate);
    const dedupeKey = comparablePath(resolvedPath);
    const existing = byRealPath.get(dedupeKey);
    if (existing) {
      existing.aliases.push(definition.sourceId);
      continue;
    }

    const summary = summarizePath(resolvedPath, definition.sourceId);
    const source = {
      sourceId: definition.sourceId,
      kind: definition.kind,
      label: summary.label,
      pathHash: summary.pathHash,
    };
    addPrivateProperty(source, 'resolvedPath', resolvedPath);
    addPrivateProperty(source, 'aliases', []);
    sources.push(source);
    byRealPath.set(dedupeKey, source);
  }

  sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  unavailable.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return Object.freeze({
    sources: Object.freeze(sources),
    unavailable: Object.freeze(unavailable),
  });
}

module.exports = { discoverSources };
