const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');

const { createLocalQuestionImageResolver, normalizeAnswerPosition, normalizedQuestion, writePaperArtifact } = require('./paperArtifactService');

const TEMPLATE_HASH = '631d6bfb41b2606837ee91488161917da7b5a700333b1e66c1ce05c74cd9dfdb';
const templatePath = path.join(__dirname, '..', '..', 'resources', 'paper', 'default-paper-template.docx');
const textOf = xml => xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const countOf = (text, needle) => text.split(needle).length - 1;

(async () => {
  assert.ok(fs.existsSync(templatePath), 'default paper template must be an application resource');
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(templatePath)).digest('hex'), TEMPLATE_HASH);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
  assert.ok(packageJson.build.files.includes('backend/**/*'), 'desktop packaging must include the backend template resource');
  assert.strictEqual(normalizeAnswerPosition('end'), 'end');
  assert.strictEqual(normalizeAnswerPosition('after-each'), 'after-each');
  assert.strictEqual(normalizeAnswerPosition('separate'), 'end');
  assert.strictEqual(normalizeAnswerPosition('inline'), 'after-each');
  assert.strictEqual(normalizeAnswerPosition('after-question'), 'after-each');
  assert.strictEqual(normalizeAnswerPosition('hidden'), 'hidden');

  const templateFiles = unzipSync(fs.readFileSync(templatePath));
  const preserveOnlyParts = ['customXml/item1.xml', 'customXml/_rels/item1.xml.rels', 'docProps/app.xml', 'word/endnotes.xml'];

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-artifacts-'));
  try {
  const questions = [
    { id: 'q1', type: '单选题', stem: '独特单选题干', options: [{ label: 'A', content: '甲' }, { label: 'B', content: '乙' }], answer: 'B', explanation: '单选解析', knowledge_points: ['速度'] },
    { id: 'q2', type: '解答题', stem: '独特解答题干', answer: '42', explanation: '解答解析', knowledge_point_names: ['能量守恒'] },
    { id: 'q3', type: '多选题', stem: '独特多选题干', options: ['甲', '乙'], answer: 'AC', explanation: '多选解析', knowledge_point: '波动' },
    { id: 'q4', type: '实验题', stem: '图片公式题干 $E=mc^2$', answer: '实验答案', explanation: '实验解析', knowledge_point_ids: ['kp-real'], assets: [{ mime_type: 'image/png', oss_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] },
  ];

  for (const answerPosition of ['end', 'after-each', 'hidden']) {
    const artifact = await writePaperArtifact('word', { title: '复杂代表性试卷', subject: '物理', answerPosition, formulaMode: 'word-native' }, questions, { root });
    const files = unzipSync(fs.readFileSync(artifact.filePath));
    const xml = strFromU8(files['word/document.xml']);
    const text = textOf(xml);
    const compact = text.replace(/\s+/g, '');
    assert.ok(files['word/styles.xml'] && files['word/theme/theme1.xml'], 'template styles and theme must remain');
    assert.ok(files['word/footer1.xml'] && files['word/footer2.xml'], 'template footers must remain');
    const footerText = Object.keys(files).filter(name => /^word\/footer\d+\.xml$/.test(name)).map(name => strFromU8(files[name])).join('\n');
    assert.ok(footerText.includes('PAGE') && !footerText.includes('13732250653') && !footerText.includes('\u6797\u8001\u5e08'), 'footer page fields must remain without sample identity residue');
    assert.ok(/<w:pgSz w:w="1190[67]" w:h="1683[89]"/.test(xml), 'A4 template section geometry must remain');
    assert.ok(!text.includes('电场强度是矢量') && !text.includes('补偿阻力'), 'sample facts must not leak');
    assert.ok(!xml.includes('[[GEWU_FORMULA_'), 'formula placeholders must not leak');
    assert.ok(compact.includes('\u4e00\u3001\u5355\u9009\u9898') && compact.includes('\u4e8c\u3001\u89e3\u7b54\u9898'), 'question type section hierarchy must be generated from real question types');
    assert.ok(Object.keys(files).some(name => /^word\/media\/.+\.png$/i.test(name)) && /relationships\/image/.test(strFromU8(files['word/_rels/document.xml.rels'])), 'question image assets and relationships must remain visible');
    for (const name of preserveOnlyParts) assert.deepStrictEqual(Buffer.from(files[name]), Buffer.from(templateFiles[name]), `template-base preserve-only part changed: ${name}`);
    for (const relationshipPart of Object.keys(files).filter(name => name.endsWith('.rels'))) {
      const sourceFolder = path.posix.dirname(path.posix.dirname(relationshipPart));
      for (const match of strFromU8(files[relationshipPart]).matchAll(/Target="([^"]+)"/g)) {
        if (/^[a-z]+:/i.test(match[1])) continue;
        const target = path.posix.normalize(path.posix.join(sourceFolder, match[1])).replace(/^\.\.\//, '');
        assert.ok(files[target], `dangling relationship ${relationshipPart} -> ${target}`);
      }
    }
    if (answerPosition === 'end') {
      assert.ok(xml.includes('<w:tbl>'), 'end mode must contain the choice summary table');
      assert.ok(text.indexOf('独特解答题干') < text.indexOf('参考答案'));
      assert.ok(text.indexOf('参考答案') < text.indexOf('题号'));
      assert.ok(compact.indexOf('题号') < compact.indexOf('1．B'));
      assert.ok(text.includes('1 3') && !text.includes('1 2 3 4'), 'choice summary must include choice questions only');
      assert.strictEqual(countOf(compact, '【知识点】速度'), 1);
      assert.strictEqual(countOf(compact, '【知识点】能量守恒'), 1);
      assert.ok(!compact.includes('kp-real'), 'knowledge point IDs must never be rendered as names');
    } else if (answerPosition === 'after-each') {
      assert.ok(!text.includes('参考答案') && !xml.includes('<w:tbl>'), 'after-each must have no trailing answer section or summary');
      assert.ok(compact.indexOf('独特单选题干') < compact.indexOf('答案：B') && compact.indexOf('答案：B') < compact.indexOf('独特解答题干'));
      assert.strictEqual(countOf(compact, '答案：B'), 1);
    } else {
      assert.ok(!text.includes('参考答案') && !text.includes('答案：B') && !text.includes('【解析】'), 'hidden must truly omit answers');
    }
  }

  const pdf = await writePaperArtifact('pdf', { title: '复杂代表性试卷', answerPosition: 'end' }, questions, { root });
  assert.strictEqual(fs.readFileSync(pdf.filePath).subarray(0, 4).toString('utf8'), '%PDF');
  assert.ok(pdf.semanticText.indexOf('独特解答题干') < pdf.semanticText.indexOf('参考答案'));
  assert.ok(pdf.semanticText.indexOf('题号 1 3') < pdf.semanticText.indexOf('1．B'));
  const afterEachPdf = await writePaperArtifact('pdf', { title: 'after-each', answerPosition: 'after-each' }, questions, { root });
  assert.ok(afterEachPdf.semanticText.indexOf('独特单选题干') < afterEachPdf.semanticText.indexOf('答案：B') && afterEachPdf.semanticText.indexOf('答案：B') < afterEachPdf.semanticText.indexOf('独特解答题干'));
  assert.ok(!afterEachPdf.semanticText.includes('参考答案') && !afterEachPdf.semanticText.includes('题号 1 3'));
  const hiddenPdf = await writePaperArtifact('pdf', { title: 'hidden', answerPosition: 'hidden' }, questions, { root });
  assert.ok(!hiddenPdf.semanticText.includes('答案：B') && !hiddenPdf.semanticText.includes('【知识点】') && !hiddenPdf.semanticText.includes('参考答案'));

  const aliasQuestions = ['选择题', '单选', 'single', 'single-choice', '多选', 'multi', 'multiple', 'multiple-choice'].map((type, index) => ({ type, stem: `alias-${index}`, answer: 'A' }));
  const aliases = await writePaperArtifact('pdf', { title: 'aliases', answerPosition: 'end' }, aliasQuestions, { root });
  assert.ok(aliases.semanticText.includes('题号 1 2 3 4 5 6 7 8'), 'all canonical choice aliases belong in summary');
  assert.strictEqual(normalizedQuestion({ type: 'experiment' }).type, '\u5b9e\u9a8c\u9898');
  assert.strictEqual(normalizedQuestion({ type: 'judge' }).type, '\u5224\u65ad\u9898');
  for (const type of ['fill', 'short', 'drawing', 'calculation', 'problem']) assert.strictEqual(normalizedQuestion({ type }).type, '\u89e3\u7b54\u9898');
  const longQuestions = Array.from({ length: 200 }, (_, index) => ({ type: 'single', stem: `long-question-${index + 1}`, answer: index % 2 ? 'B' : 'A', explanation: `analysis-${index + 1}`, knowledge_points: [`knowledge-${index + 1}`] }));
  const longPdf = await writePaperArtifact('pdf', { title: 'long-paper', answerPosition: 'end' }, longQuestions, { root });
  assert.ok(longPdf.pageCount > 4 && longPdf.semanticText.includes('200．B'), 'long paper must paginate while retaining the final answer block');

  const remoteQuestion = { type: 'single', rich_content: { type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'https://assets.example.test/q.png', width: 80 } }] }] }, options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] } } } };
  const remoteBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const publicDns = async () => [{ address: '93.184.216.34' }];
  const localFirstQuestion = { type: 'single', rich_content: { type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { assetKey: 'folder/local-q.png', src: 'https://assets.example.test/q.png', width: 80 } }] }] }, options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] } } } };
  let localFirstFetchCalls = 0;
  const localFirst = await writePaperArtifact('word', { title: 'local-first', answerPosition: 'hidden' }, [localFirstQuestion], { root, resolveImageAsset: async key => key === 'folder/local-q.png' ? { bytes: remoteBytes, contentType: 'image/png' } : null, fetchImage: async () => { localFirstFetchCalls += 1; throw new Error('fetch must not run'); } });
  assert.ok(fs.existsSync(localFirst.filePath));
  assert.strictEqual(localFirstFetchCalls, 0, 'local assetKey resolver must win over HTTPS src');
  await assert.rejects(() => writePaperArtifact('word', { title: 'local-missing' }, [localFirstQuestion], { root, resolveImageAsset: async () => null }), /IMAGE_ORIGIN_NOT_ALLOWED/);
  let fallbackFetchCalls = 0;
  const fallback = await writePaperArtifact('word', { title: 'allowed-fallback' }, [localFirstQuestion], { root, resolveImageAsset: async () => null, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async () => { fallbackFetchCalls += 1; return { bytes: remoteBytes, contentType: 'image/png' }; } });
  assert.ok(fs.existsSync(fallback.filePath)); assert.strictEqual(fallbackFetchCalls, 1);
  const remote = await writePaperArtifact('word', { title: 'remote', answerPosition: 'hidden' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async () => ({ bytes: remoteBytes, contentType: 'image/png' }) });
  assert.ok(Object.keys(unzipSync(fs.readFileSync(remote.filePath))).some(name => /^word\/media\/.+\.png$/.test(name)), 'allowed HTTPS image resolver must embed bytes');
  await assert.rejects(() => writePaperArtifact('word', { title: 'blocked' }, [remoteQuestion], { root, allowedImageOrigins: [] }), /IMAGE_ORIGIN_NOT_ALLOWED/);
  let timeoutAborted = false;
  await assert.rejects(() => writePaperArtifact('word', { title: 'timeout' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async (_url, init) => new Promise(() => init.signal.addEventListener('abort', () => { timeoutAborted = true; })), imageTimeoutMs: 10 }), /IMAGE_FETCH_TIMEOUT/);
  assert.strictEqual(timeoutAborted, true, 'timeout must abort the underlying fetch');
  await assert.rejects(() => writePaperArtifact('word', { title: 'oversize' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async () => ({ bytes: Buffer.alloc(1025), contentType: 'image/png' }), imageMaxBytes: 1024 }), /IMAGE_TOO_LARGE/);
  await assert.rejects(() => writePaperArtifact('word', { title: 'fake-png' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async () => ({ bytes: Buffer.from('not a png'), contentType: 'image/png' }) }), /IMAGE_CONTENT_TYPE_INVALID/);
  await assert.rejects(() => writePaperArtifact('word', { title: 'header-oversize' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async () => ({ headers: { get: name => name === 'content-length' ? '2048' : 'image/png' }, arrayBuffer: async () => remoteBytes }), imageMaxBytes: 1024 }), /IMAGE_TOO_LARGE/);
  let arrayBufferCalled = false;
  await assert.rejects(() => writePaperArtifact('word', { title: 'stream-required' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: publicDns, fetchImage: async () => ({ headers: { get: name => name === 'content-length' ? '1' : 'image/png' }, arrayBuffer: async () => { arrayBufferCalled = true; return Buffer.alloc(2048); } }) }), /IMAGE_STREAM_REQUIRED/);
  assert.strictEqual(arrayBufferCalled, false, 'non-stream response must be rejected before buffering the body');
  await assert.rejects(() => writePaperArtifact('word', { title: 'resolver-required' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], fetchImage: async () => ({ bytes: remoteBytes, contentType: 'image/png' }) }), /IMAGE_HOST_RESOLVER_REQUIRED/);
  await assert.rejects(() => writePaperArtifact('word', { title: 'dns-private' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: async () => [{ address: '127.0.0.1' }], fetchImage: async () => ({ bytes: remoteBytes, contentType: 'image/png' }) }), /IMAGE_HOST_NOT_ALLOWED/);
  await assert.rejects(() => writePaperArtifact('word', { title: 'redirect-private' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: async () => [{ address: '203.0.113.1' }], fetchImage: async () => ({ url: 'http://127.0.0.1/q.png', bytes: remoteBytes, contentType: 'image/png' }) }), /IMAGE_REDIRECT_ORIGIN_NOT_ALLOWED/);
  await assert.rejects(() => writePaperArtifact('word', { title: 'manual-redirect' }, [remoteQuestion], { root, allowedImageOrigins: ['https://assets.example.test'], resolveHostname: async () => [{ address: '203.0.113.1' }], fetchImage: async (_url, init) => { assert.strictEqual(init.redirect, 'manual'); return { status: 302, headers: { get: () => null } }; } }), /IMAGE_REDIRECT_NOT_ALLOWED/);
  const mappedPrivateQuestion = JSON.parse(JSON.stringify(remoteQuestion));
  mappedPrivateQuestion.rich_content.sections.stem.content[0].content[0].attrs.src = 'http://[::ffff:7f00:1]/q.png';
  await assert.rejects(() => writePaperArtifact('word', { title: 'mapped-private' }, [mappedPrivateQuestion], { root, allowedImageOrigins: ['http://[::ffff:7f00:1]'], resolveHostname: publicDns, fetchImage: async () => ({ bytes: remoteBytes, contentType: 'image/png' }) }), /IMAGE_HOST_NOT_ALLOWED/);
  const oversizedDataQuestion = JSON.parse(JSON.stringify(remoteQuestion));
  oversizedDataQuestion.rich_content.sections.stem.content[0].content[0].attrs.src = `data:image/png;base64,${'A'.repeat(100)}`;
  await assert.rejects(() => writePaperArtifact('word', { title: 'data-oversize' }, [oversizedDataQuestion], { root, imageMaxBytes: 16 }), /IMAGE_TOO_LARGE/);
  const localResolver = createLocalQuestionImageResolver(root);
  assert.strictEqual(await localResolver('../outside.png'), null, 'path traversal must not escape the configured images root');
  const nestedDir = path.join(root, 'assets', 'images', 'folder'); fs.mkdirSync(nestedDir, { recursive: true }); fs.writeFileSync(path.join(nestedDir, 'local-q.png'), remoteBytes);
  assert.ok((await localResolver('folder/local-q.png'))?.path.endsWith(path.join('folder', 'local-q.png')), 'nested asset keys inside images root must resolve');
  await assert.rejects(() => localResolver('folder/local-q.png', { maxBytes: 8 }), /IMAGE_TOO_LARGE/);
  await assert.rejects(() => writePaperArtifact('word', { title: 'custom-path-oversize' }, [localFirstQuestion], { root, imageMaxBytes: 8, resolveImageAsset: async () => ({ path: path.join(nestedDir, 'local-q.png'), contentType: 'image/png' }) }), /IMAGE_TOO_LARGE/);
  const junctionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-junction-root-'));
  const junctionOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-paper-junction-outside-'));
  try {
    fs.mkdirSync(path.join(junctionOutside, 'images'));
    try {
      fs.symlinkSync(junctionOutside, path.join(junctionRoot, 'assets'), 'junction');
      assert.strictEqual(await createLocalQuestionImageResolver(junctionRoot)('escape.png'), null, 'junction components must be rejected');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      console.log(`junction test skipped: ${error.code}`);
    }
  } finally {
    fs.rmSync(junctionRoot, { recursive: true, force: true });
    fs.rmSync(junctionOutside, { recursive: true, force: true });
  }
  console.log('paper artifact service checks passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
