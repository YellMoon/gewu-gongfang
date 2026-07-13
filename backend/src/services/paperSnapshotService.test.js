const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initQuestionBankStore } = require('./questionBankStorageService');
const { collectQuestionAssetReferences, freezePaperSnapshot, pinSnapshotAssets, resolveSnapshotAssets } = require('./paperSnapshotService');

(async () => {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-snapshot-'));
try {
  initQuestionBankStore(root, { deviceId: 'host-a' });
  const source = path.join(root, 'assets', 'images', 'formula.png');
  fs.writeFileSync(source, Buffer.from('stable-image'));
  const questions = [{ id: 'q1', rich_content: { sections: { stem: [{ type: 'formula', latex: 'x^2' }] } }, updated_at: 'v1' }];
  const frozen = freezePaperSnapshot({
    authoritativeRoot: root,
    selectQuestions: () => questions,
    resolveAssets: () => [{ questionId: 'q1', path: source }],
    formulaPolicy: { requestedMode: 'word-native', fallback: 'latex-vector' },
    templateVersion: 'template-sha256-v1',
  });
  assert.deepStrictEqual(frozen.snapshot.questions, questions);
  assert.deepStrictEqual(frozen.snapshot.formulaPolicy, { requestedMode: 'word-native', fallback: 'latex-vector' });
  assert.strictEqual(frozen.snapshot.templateVersion, 'template-sha256-v1');
  assert.strictEqual(frozen.snapshot.assets.length, 1);
  assert.strictEqual(path.isAbsolute(frozen.snapshot.assets[0].blobPath), false, 'snapshot hash must not include machine-specific absolute paths');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'paper-snapshot-blobs', frozen.snapshot.assets[0].sha256)));
  assert.strictEqual(frozen.snapshotHash.length, 64);

  const preview = path.join(root, 'assets', 'images', 'preview.emf'); fs.writeFileSync(preview, 'preview');
  const referencedQuestion = [{ id: 'q-rich', rich_content: { sections: { stem: { type: 'doc', content: [{ type: 'image', attrs: { assetKey: 'formula.png' } }, { type: 'formula', attrs: { canonicalLatex: 'x', sourceRef: 'preview.emf' } }] } } } }];
  const references = collectQuestionAssetReferences(referencedQuestion);
  assert.deepStrictEqual(references.map(row => row.key).sort(), ['formula.png', 'preview.emf']);
  assert.deepStrictEqual(resolveSnapshotAssets(root, references).map(row => path.basename(row.path)).sort(), ['formula.png', 'preview.emf']);
  assert.throws(() => resolveSnapshotAssets(root, [{ questionId: 'q-rich', key: 'https://example.test/unpinned.png' }]), error => error.code === 'PAPER_SNAPSHOT_REMOTE_ASSET_UNPINNED');

  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('safe')]);
  const dataKey = `data:image/png;base64,${png.toString('base64')}`;
  const dataPinned = await pinSnapshotAssets(root, [{ questionId: 'q-rich', key: dataKey }]);
  assert.deepStrictEqual(fs.readFileSync(dataPinned[0].path), png, 'valid data image must be pinned inside the authoritative root');
  const remoteOptions = { allowedImageOrigins: ['https://assets.example.test'], resolveHostname: async () => [{ address: '203.0.113.10' }], fetchImage: async () => ({ bytes: png, contentType: 'image/png' }) };
  const remotePinned = await pinSnapshotAssets(root, [{ questionId: 'q-rich', key: 'https://assets.example.test/q.png' }], remoteOptions);
  assert.deepStrictEqual(fs.readFileSync(remotePinned[0].path), png, 'allowlisted public HTTPS image must be pinned');
  await assert.rejects(() => pinSnapshotAssets(root, [{ questionId: 'q-rich', key: 'https://assets.example.test/private.png' }], { ...remoteOptions, resolveHostname: async () => [{ address: '127.0.0.1' }] }), error => error.code === 'IMAGE_HOST_NOT_ALLOWED');
  await assert.rejects(() => pinSnapshotAssets(root, [{ questionId: 'q-rich', key: 'https://assets.example.test/redirect.png' }], { ...remoteOptions, fetchImage: async () => ({ status: 302 }) }), error => error.code === 'IMAGE_REDIRECT_NOT_ALLOWED');
  await assert.rejects(() => pinSnapshotAssets(root, [{ questionId: 'q-rich', key: 'https://assets.example.test/large.png' }], { ...remoteOptions, imageMaxBytes: 8, fetchImage: async () => ({ bytes: Buffer.concat([png, Buffer.alloc(20)]), contentType: 'image/png' }) }), error => error.code === 'IMAGE_TOO_LARGE');
  await assert.rejects(() => pinSnapshotAssets(root, [{ questionId: 'q-rich', key: 'data:image/png;base64,bm90LXBuZw==' }]), error => error.code === 'IMAGE_CONTENT_TYPE_INVALID');

  let selectionRead = 0;
  assert.throws(() => freezePaperSnapshot({
    authoritativeRoot: root,
    selectQuestions: () => (++selectionRead === 1 ? questions : [{ ...questions[0], updated_at: 'v2' }]),
    resolveAssets: () => [], formulaPolicy: {}, templateVersion: 'v1',
  }), error => error.code === 'PAPER_SNAPSHOT_QUESTION_CHANGED', 'question hash must be rechecked after asset copy');

  let assetRead = 0;
  assert.throws(() => freezePaperSnapshot({
    authoritativeRoot: root, selectQuestions: () => questions,
    resolveAssets: () => [{ questionId: 'q1', path: source }], formulaPolicy: {}, templateVersion: 'v1',
    readFile: file => file === source && ++assetRead > 1 ? Buffer.from('changed-image') : fs.readFileSync(file),
  }), error => error.code === 'PAPER_SNAPSHOT_ASSET_CHANGED', 'asset hash must be rechecked after copy');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('paper snapshot checks passed');
})().catch(error => { console.error(error); process.exit(1); });
