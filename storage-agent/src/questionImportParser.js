'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function assertInsideRoot(candidate, nasRoot) {
  const relative = path.relative(nasRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw failure('QUESTION_IMPORT_PARSE_STORAGE_REPARSE_POINT');
  return candidate;
}

function assertNoReparsePoint(candidate, nasRoot) {
  const safeCandidate = assertInsideRoot(candidate, nasRoot);
  try {
    if (fs.lstatSync(nasRoot).isSymbolicLink()) throw failure('QUESTION_IMPORT_PARSE_STORAGE_REPARSE_POINT');
  } catch (error) {
    if (error?.code === 'QUESTION_IMPORT_PARSE_STORAGE_REPARSE_POINT') throw error;
    throw failure('QUESTION_IMPORT_PARSE_STORAGE_REPARSE_POINT');
  }
  let current = nasRoot;
  for (const segment of path.relative(nasRoot, safeCandidate).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw failure('QUESTION_IMPORT_PARSE_STORAGE_REPARSE_POINT');
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
  return safeCandidate;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw failure('QUESTION_IMPORT_PARSE_INPUT_INVALID');
  }
  return value;
}

function stableJson(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (!plainObject(value)) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function dataUrlBytes(value, expectedMime, expectedHash, expectedBytes) {
  if (typeof value !== 'string' || value.length > (90 * 1024 * 1024)) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1] !== expectedMime) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')
    || bytes.length !== expectedBytes || crypto.createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
  }
  return bytes;
}

function containsDataUrl(value) {
  if (typeof value === 'string') return /data:[^,]*;base64,/iu.test(value);
  if (Array.isArray(value)) return value.some(containsDataUrl);
  if (plainObject(value)) return Object.values(value).some(containsDataUrl);
  return false;
}

function sanitizeQuestion(question) {
  if (!plainObject(question) || !Array.isArray(question.assets)) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
  const candidate = JSON.parse(JSON.stringify(question));
  const mediaManifest = [];
  const mediaBytes = [];
  candidate.assets = question.assets.map((asset, assetIndex) => {
    if (!plainObject(asset) || typeof asset.asset_type !== 'string' || !asset.asset_type || asset.asset_type.length > 64
      || typeof asset.file_name !== 'string' || !asset.file_name || asset.file_name.length > 512
      || typeof asset.mime_type !== 'string' || !asset.mime_type || asset.mime_type.length > 255
      || !Number.isSafeInteger(asset.size_bytes) || asset.size_bytes < 1 || asset.size_bytes > (64 * 1024 * 1024)
      || typeof asset.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(asset.content_hash)) {
      throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
    }
    const bytes = dataUrlBytes(asset.data_url, asset.mime_type, asset.content_hash, asset.size_bytes);
    mediaBytes.push(bytes);
    mediaManifest.push({ sha256: asset.content_hash, bytes: asset.size_bytes, mimeType: asset.mime_type });
    return {
      assetIndex,
      assetType: asset.asset_type,
      fileName: asset.file_name,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      contentHash: asset.content_hash,
    };
  });
  if (containsDataUrl(candidate)) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
  return { candidate, mediaManifest, mediaBytes };
}

function validationFor(candidate) {
  const stem = typeof candidate.stem === 'string' ? candidate.stem.trim() : '';
  if (!stem) return { status: 'rejected', codes: ['missing_stem'] };
  const answer = typeof candidate.answer === 'string' ? candidate.answer.trim() : '';
  const codes = answer ? [] : ['missing_answer'];
  if (Array.isArray(candidate.formulas) && candidate.formulas.some(formula => formula && typeof formula === 'object'
    && ['approximate', 'preview_only', 'failed'].includes(formula.conversion_status))) {
    codes.push('formula_needs_review');
  }
  return codes.length ? { status: 'warning', codes } : { status: 'accepted', codes };
}

function executePython({ pythonBin, parserPath, filePath, sourceType }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [parserPath, filePath, sourceType], { windowsHide: true, timeout: 60000 });
    const chunks = [];
    let length = 0;
    let settled = false;
    function rejectOnce() {
      if (!settled) {
        settled = true;
        reject(failure('QUESTION_IMPORT_PARSE_FAILED'));
      }
    }
    child.stdout.on('data', chunk => {
      length += chunk.length;
      if (length > (96 * 1024 * 1024)) {
        child.kill();
        rejectOnce();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.on('error', rejectOnce);
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return rejectOnce();
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function createQuestionImportParser({ nasRoot, parserPath, pythonBin, execute = executePython } = {}) {
  if (typeof nasRoot !== 'string' || !path.isAbsolute(nasRoot) || typeof parserPath !== 'string' || !path.isAbsolute(parserPath)
    || typeof pythonBin !== 'string' || !pythonBin.trim() || typeof execute !== 'function') throw failure('QUESTION_IMPORT_PARSE_CONFIG_INVALID');
  const root = path.resolve(nasRoot);
  const script = path.resolve(parserPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || !fs.existsSync(script) || !fs.statSync(script).isFile()) {
    throw failure('QUESTION_IMPORT_PARSE_CONFIG_INVALID');
  }
  try {
    if (fs.lstatSync(root).isSymbolicLink()) throw failure('QUESTION_IMPORT_PARSE_CONFIG_INVALID');
  } catch (error) {
    if (error?.code === 'QUESTION_IMPORT_PARSE_CONFIG_INVALID') throw error;
    throw failure('QUESTION_IMPORT_PARSE_CONFIG_INVALID');
  }
  return Object.freeze({
    async parse(input) {
      const request = exact(input, ['sourceType', 'sourceFileName', 'bytes']);
      if (!['lecture', 'exam'].includes(request.sourceType) || typeof request.sourceFileName !== 'string'
        || !/\.(?:doc|docx)$/iu.test(request.sourceFileName) || !Buffer.isBuffer(request.bytes) || request.bytes.length < 1 || request.bytes.length > (64 * 1024 * 1024)) {
        throw failure('QUESTION_IMPORT_PARSE_INPUT_INVALID');
      }
      const temporaryRoot = assertNoReparsePoint(path.join(root, '.gewu-storage-agent'), root);
      await fs.promises.mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
      assertNoReparsePoint(temporaryRoot, root);
      const temporaryDirectory = await fs.promises.mkdtemp(path.join(temporaryRoot, 'parser-'));
      assertNoReparsePoint(temporaryDirectory, root);
      const temporaryPath = assertNoReparsePoint(path.join(temporaryDirectory, `source${path.extname(request.sourceFileName).toLowerCase()}`), root);
      try {
        assertNoReparsePoint(temporaryPath, root);
        await fs.promises.writeFile(temporaryPath, request.bytes, { flag: 'wx', mode: 0o600 });
        const raw = await execute({ pythonBin: pythonBin.trim(), parserPath: script, filePath: temporaryPath, sourceType: request.sourceType });
        if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
        let output;
        try {
          output = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
        } catch (_) {
          throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
        }
        if (!plainObject(output) || output.success !== true || !Array.isArray(output.questions) || output.questions.length < 1 || output.questions.length > 500) {
          throw failure('QUESTION_IMPORT_PARSE_OUTPUT_INVALID');
        }
        const parsed = output.questions.map(sanitizeQuestion);
        return {
          candidates: parsed.map(item => ({
            contentHash: crypto.createHash('sha256').update(stableJson(item.candidate), 'utf8').digest('hex'),
            candidate: item.candidate,
            validation: validationFor(item.candidate),
            mediaManifest: item.mediaManifest,
          })),
          mediaBytes: parsed.map(item => item.mediaBytes),
        };
      } finally {
        assertNoReparsePoint(temporaryDirectory, root);
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  });
}

module.exports = Object.freeze({ createQuestionImportParser });
