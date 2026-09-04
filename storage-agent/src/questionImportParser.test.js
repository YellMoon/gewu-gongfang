'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createQuestionImportParser, executePython } = require('./questionImportParser');

function expectedBundleRevision(directory) {
  function collect(relativeDirectory = '') {
    const absoluteDirectory = path.join(directory, relativeDirectory);
    return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
      const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name);
      if (entry.isDirectory()) return collect(relativePath);
      return entry.isFile() && entry.name.endsWith('.py') ? [relativePath] : [];
    });
  }
  const names = collect()
    .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
  const hash = crypto.createHash('sha256');
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(directory, name));
    hash.update(Buffer.from(`${Buffer.byteLength(name, 'utf8')}:`, 'ascii'));
    hash.update(name, 'utf8');
    hash.update(Buffer.from(`:${bytes.length}:`, 'ascii'));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-import-parser-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-import-parser-outside-'));
  const parserPath = path.join(root, 'parse_word.py');
  const helperPath = path.join(root, 'formula_omml.py');
  const nestedHelperDirectory = path.join(root, 'support');
  const nestedHelperPath = path.join(nestedHelperDirectory, 'normalizer.py');
  const hangingParserPath = path.join(root, 'hang-forever.js');
  fs.writeFileSync(parserPath, '# parser fixture\n');
  fs.writeFileSync(helperPath, '# parser helper fixture\n');
  fs.mkdirSync(nestedHelperDirectory);
  fs.writeFileSync(nestedHelperPath, '# nested parser helper fixture\n');
  fs.writeFileSync(hangingParserPath, 'setInterval(() => {}, 1000);\n');
  const assetBytes = Buffer.from('image-fixture');
  const assetHash = crypto.createHash('sha256').update(assetBytes).digest('hex');
  let temporaryPath = null;
  try {
    let executeCount = 0;
    const parser = createQuestionImportParser({
      nasRoot: root,
      parserPath,
      pythonBin: 'python3',
      execute: async input => {
        executeCount += 1;
        temporaryPath = input.filePath;
        assert.deepStrictEqual(await fs.promises.readFile(input.filePath), Buffer.from('word-fixture'));
        assert.strictEqual(input.sourceType, 'lecture');
        return JSON.stringify({ success: true, questions: [{
          id: 'parser-local-id', stem: '<p>Question <img src="question-asset://' + assetHash + '"></p>', answer: 'Answer', options: [],
          assets: [{ asset_type: 'image', file_name: 'fixture.png', mime_type: 'image/png', size_bytes: assetBytes.length,
            content_hash: assetHash, data_url: `data:image/png;base64,${assetBytes.toString('base64')}` }],
        }] });
      },
    });
    const parserSha256 = expectedBundleRevision(root);
    assert.strictEqual(parser.revision, parserSha256, 'the parser exposed to the worker must identify the deterministic production Python bundle');
    await assert.rejects(
      () => executePython({
        pythonBin: process.execPath,
        parserPath: hangingParserPath,
        filePath: path.join(root, 'unused.docx'),
        sourceType: 'lecture',
        timeoutMs: 25,
      }),
      /QUESTION_IMPORT_PARSE_TIMEOUT/,
      'a parser that ignores normal shutdown must be force-killed so the NAS worker can lease another task'
    );
    const parsed = await parser.parse({ sourceType: 'lecture', sourceFileName: 'fixture.docx', bytes: Buffer.from('word-fixture') });
    assert.strictEqual(parsed.parserSha256, parserSha256);
    assert.strictEqual(parsed.candidates.length, 1);
    assert.strictEqual(parsed.candidates[0].validation.status, 'accepted');
    assert.deepStrictEqual(parsed.candidates[0].mediaManifest, [{ sha256: assetHash, bytes: assetBytes.length, mimeType: 'image/png' }]);
    assert.deepStrictEqual(parsed.candidates[0].candidate.assets, [{ assetIndex: 0, assetType: 'image', fileName: 'fixture.png', mimeType: 'image/png', sizeBytes: assetBytes.length, contentHash: assetHash }]);
    assert.deepStrictEqual(parsed.mediaBytes, [[assetBytes]]);
    assert.ok(!JSON.stringify(parsed.candidates).includes('data:image/png'), 'cloud candidates must never receive media bytes');
    assert.ok(temporaryPath.startsWith(path.join(root, '.gewu-storage-agent', 'parser-')));
    assert.ok(!fs.existsSync(path.dirname(temporaryPath)), 'the transient parser directory must be removed after parsing');
    fs.appendFileSync(helperPath, '# changed after startup\n');
    assert.throws(() => parser.assertRevision(), /QUESTION_IMPORT_PARSE_REVISION_MISMATCH/,
      'runtime heartbeats must be able to reject a changed helper before reporting the cached startup digest');
    await assert.rejects(
      () => parser.parse({ sourceType: 'lecture', sourceFileName: 'fixture.docx', bytes: Buffer.from('word-fixture') }),
      /QUESTION_IMPORT_PARSE_REVISION_MISMATCH/,
      'changing only an imported parser helper must fail closed before executing Python under the startup revision',
    );
    assert.strictEqual(executeCount, 1, 'a changed parser bundle must never be executed');
    fs.writeFileSync(helperPath, '# parser helper fixture\n');
    assert.strictEqual(expectedBundleRevision(root), parser.revision, 'restoring the exact helper bytes restores the startup revision');
    assert.strictEqual(parser.assertRevision(), parser.revision);
    fs.appendFileSync(nestedHelperPath, '# nested helper changed after startup\n');
    assert.throws(() => parser.assertRevision(), /QUESTION_IMPORT_PARSE_REVISION_MISMATCH/,
      'the proof must cover recursively imported Python helpers, not only the entrypoint directory');
    fs.writeFileSync(nestedHelperPath, '# nested parser helper fixture\n');
    assert.strictEqual(parser.assertRevision(), parser.revision);
    const mutationDuringExecutionParser = createQuestionImportParser({
      nasRoot: root,
      parserPath,
      pythonBin: 'python3',
      execute: async () => {
        fs.appendFileSync(nestedHelperPath, '# changed while Python was running\n');
        return JSON.stringify({ success: true, questions: [{
          id: 'parser-mutation-id', stem: 'Question', answer: 'Answer', options: [], assets: [],
        }] });
      },
    });
    await assert.rejects(
      () => mutationDuringExecutionParser.parse({ sourceType: 'lecture', sourceFileName: 'fixture.docx', bytes: Buffer.from('word-fixture') }),
      /QUESTION_IMPORT_PARSE_REVISION_MISMATCH/,
      'a parser bundle changed during execution must fail before candidates are returned to the cloud',
    );
    fs.writeFileSync(nestedHelperPath, '# nested parser helper fixture\n');
    const reviewParser = createQuestionImportParser({
      nasRoot: root,
      parserPath,
      pythonBin: 'python3',
      execute: async () => JSON.stringify({ success: true, questions: [{
        id: 'parser-review-id', stem: 'Question', answer: 'Answer', options: [], assets: [],
        formulas: [{ conversion_status: 'failed' }],
      }] }),
    });
    const review = await reviewParser.parse({ sourceType: 'lecture', sourceFileName: 'fixture.docx', bytes: Buffer.from('word-fixture') });
    assert.deepStrictEqual(review.candidates[0].validation, { status: 'warning', codes: ['formula_needs_review'] });
    await assert.rejects(
      () => parser.parse({ sourceType: 'lecture', sourceFileName: 'fixture.docx', bytes: Buffer.from('word-fixture'), extra: true }),
      /QUESTION_IMPORT_PARSE_INPUT_INVALID/
    );
    fs.rmSync(path.join(root, '.gewu-storage-agent'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, '.gewu-storage-agent'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      () => parser.parse({ sourceType: 'lecture', sourceFileName: 'fixture.docx', bytes: Buffer.from('word-fixture') }),
      /QUESTION_IMPORT_PARSE_STORAGE_REPARSE_POINT/
    );
    assert.deepStrictEqual(fs.readdirSync(outside), [], 'a reparse point beneath the NAS root must not receive parser input');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

main().then(() => console.log('question import parser checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
