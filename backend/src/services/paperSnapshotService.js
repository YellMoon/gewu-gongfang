const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalJson, sha256 } = require('./paperJobRepository');
const { resolveImageSegments } = require('./paperArtifactService');

function snapshotError(code, message) { return Object.assign(new Error(message), { code, statusCode: 409 }); }

function assertSafeExistingPath(root, target) {
  const absoluteRoot = path.resolve(root); const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw snapshotError('PAPER_SNAPSHOT_PATH_ESCAPE', 'snapshot asset escapes authoritative root');
  let cursor = absoluteRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw snapshotError('PAPER_SNAPSHOT_REPARSE_REJECTED', 'snapshot path contains a reparse link');
    cursor = path.join(cursor, segment);
  }
  if (!fs.existsSync(absoluteTarget) || fs.lstatSync(absoluteTarget).isSymbolicLink()) throw snapshotError('PAPER_SNAPSHOT_ASSET_MISSING', 'snapshot asset is unavailable or unsafe');
  return absoluteTarget;
}

function freezePaperSnapshot(input) {
  const root = path.resolve(input.authoritativeRoot || '');
  if (!root || !fs.existsSync(root)) throw snapshotError('QUESTION_BANK_STORE_NOT_BOUND', 'verified authoritative root is required');
  const readFile = input.readFile || fs.readFileSync;
  const questionJsonBefore = canonicalJson(input.selectQuestions());
  const assets = [];
  const blobRoot = path.join(root, 'assets', 'paper-snapshot-blobs');
  fs.mkdirSync(blobRoot, { recursive: true });
  for (const asset of input.resolveAssets?.(JSON.parse(questionJsonBefore)) || []) {
    const source = assertSafeExistingPath(root, asset.path);
    const firstBytes = readFile(source);
    const digest = crypto.createHash('sha256').update(firstBytes).digest('hex');
    const destination = path.join(blobRoot, digest);
    if (!fs.existsSync(destination)) {
      const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
      fs.writeFileSync(temporary, firstBytes, { flag: 'wx' });
      fs.renameSync(temporary, destination);
    }
    const copiedHash = sha256(fs.readFileSync(destination));
    const sourceHashAfter = sha256(readFile(source));
    if (copiedHash !== digest || sourceHashAfter !== digest) throw snapshotError('PAPER_SNAPSHOT_ASSET_CHANGED', 'asset changed while the snapshot was frozen');
    assets.push({ questionId: asset.questionId || '', sourceKey: asset.key || '', sourceName: path.basename(source), sha256: digest, blobPath: path.relative(root, destination).split(path.sep).join('/'), sizeBytes: firstBytes.length });
  }
  const questionJsonAfter = canonicalJson(input.selectQuestions());
  if (sha256(questionJsonAfter) !== sha256(questionJsonBefore)) throw snapshotError('PAPER_SNAPSHOT_QUESTION_CHANGED', 'question content changed while the snapshot was frozen');
  const snapshot = {
    questions: JSON.parse(questionJsonBefore),
    formulaPolicy: JSON.parse(canonicalJson(input.formulaPolicy || {})),
    templateVersion: String(input.templateVersion || ''),
    assets,
  };
  const snapshotJson = canonicalJson(snapshot);
  return { snapshot, snapshotJson, snapshotHash: sha256(snapshotJson) };
}

function collectQuestionAssetReferences(questions = []) {
  const references = [];
  const add = (questionId, key) => { const value = String(key || '').trim(); if (value) references.push({ questionId: String(questionId || ''), key: value }); };
  const visit = (value, questionId) => {
    if (Array.isArray(value)) return value.forEach(item => visit(item, questionId));
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image') add(questionId, value.attrs?.assetKey || value.attrs?.asset_key || value.attrs?.src);
    if (value.type === 'formula') { add(questionId, value.attrs?.sourceRef); add(questionId, value.attrs?.previewRef); }
    Object.values(value).forEach(child => visit(child, questionId));
  };
  for (const question of questions) {
    visit(question.rich_content || question.richContent, question.id);
    for (const asset of question.assets || []) add(question.id, asset.assetKey || asset.asset_key || asset.file_name || asset.oss_key || asset.oss_url || asset.url || asset.data_url);
  }
  return [...new Map(references.map(item => [`${item.questionId}\0${item.key}`, item])).values()];
}

function resolveSnapshotAssets(authoritativeRoot, references = []) {
  const root = path.resolve(authoritativeRoot);
  return references.map(reference => {
    let key = String(reference.key || '').trim();
    if (/^https?:\/\//i.test(key)) throw snapshotError('PAPER_SNAPSHOT_REMOTE_ASSET_UNPINNED', 'remote asset must be pinned locally before export');
    if (/^data:/i.test(key)) throw snapshotError('PAPER_SNAPSHOT_DATA_ASSET_UNPINNED', 'data asset must be materialized before export');
    key = key.replace(/^question-asset:\/\//i, '').replace(/\\/g, '/').replace(/^(?:assets\/)?images\//, '');
    if (!key || key.includes('..') || path.isAbsolute(key)) throw snapshotError('PAPER_SNAPSHOT_ASSET_KEY_INVALID', 'snapshot asset key is invalid');
    const candidates = [
      path.join(root, 'assets', 'images', key),
      path.join(root, 'questions', path.basename(reference.questionId || ''), path.basename(key)),
    ];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (!found) throw snapshotError('PAPER_SNAPSHOT_ASSET_MISSING', `snapshot asset is missing: ${path.basename(key)}`);
    return { ...reference, path: assertSafeExistingPath(root, found) };
  });
}

async function pinSnapshotAssets(authoritativeRoot, references = [], options = {}) {
  const root = path.resolve(authoritativeRoot); const pinnedRoot = path.join(root, 'assets', 'paper-snapshot-inputs');
  fs.mkdirSync(pinnedRoot, { recursive: true });
  const result = [];
  for (const reference of references) {
    const key = String(reference.key || '').trim();
    if (!/^https:\/\//i.test(key) && !/^data:/i.test(key)) { result.push(...resolveSnapshotAssets(root, [reference])); continue; }
    if (/^http:\/\//i.test(key)) throw snapshotError('PAPER_SNAPSHOT_REMOTE_ASSET_UNSAFE', 'only HTTPS remote snapshot assets are allowed');
    const segment = { type: 'image', src: key };
    await resolveImageSegments([{ stem: [segment], options: [], subs: [], answer: [], analysis: [] }], { ...options, root });
    const bytes = Buffer.from(segment.resolvedData); const digest = sha256(bytes); const extension = segment.resolvedType;
    const destination = path.join(pinnedRoot, `${digest}.${extension}`);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
    result.push({ ...reference, path: assertSafeExistingPath(root, destination) });
  }
  return result;
}

module.exports = { assertSafeExistingPath, collectQuestionAssetReferences, freezePaperSnapshot, pinSnapshotAssets, resolveSnapshotAssets };
