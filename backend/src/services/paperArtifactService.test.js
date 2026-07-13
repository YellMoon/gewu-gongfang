const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');

const { createLocalQuestionImageResolver, normalizeAnswerPosition, normalizedQuestion, prepareFormulaRows, resolveSupportScript, writePaperArtifact } = require('./paperArtifactService');

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
  const originalCwd = process.cwd();
  const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-unrelated-cwd-'));
  try {
    process.chdir(unrelatedCwd);
    assert.ok(resolveSupportScript('modules/question-bank/export/visible_gate.py').endsWith(path.join('modules', 'question-bank', 'export', 'visible_gate.py')), 'support scripts must resolve outside the project cwd');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(unrelatedCwd, { recursive: true, force: true });
  }
  const formulaRow = (index, latex = 'x') => ({ latex, display: false, questionId: `q-limit-${index}`, location: `subQuestions[${index}].answer`, index });
  await assert.rejects(
    () => prepareFormulaRows([formulaRow(0, 'x'.repeat(20001))], 'latex-vector'),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_LATEX_LENGTH_LIMIT_EXCEEDED' && error.diagnostics[0].questionId === 'q-limit-0'
  );
  await assert.rejects(
    () => prepareFormulaRows(Array.from({ length: 2001 }, (_, index) => formulaRow(index)), 'latex-vector'),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_COUNT_LIMIT_EXCEEDED'
  );
  await assert.rejects(
    () => prepareFormulaRows(Array.from({ length: 51 }, (_, index) => formulaRow(index, 'x'.repeat(20000))), 'latex-vector'),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_TOTAL_LATEX_LIMIT_EXCEEDED' && error.diagnostics[0].questionId === 'q-limit-50'
  );
  await assert.rejects(
    () => prepareFormulaRows([formulaRow(0)], 'latex-vector', { renderFormula: async () => ({ svg: '<svg/>', width: 4096, height: 10 }), rasterizeFormula: async () => Buffer.from('png') }),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_RENDER_BOUNDS_LIMIT_EXCEEDED'
  );
  let rasterTarget;
  await prepareFormulaRows([formulaRow(0)], 'latex-vector', {
    renderFormula: async () => ({ svg: '<svg/>', width: 1000, height: 250 }),
    rasterizeFormula: async (_rendered, target) => { rasterTarget = target; return Buffer.from('png'); },
  });
  assert.ok(rasterTarget.width * rasterTarget.height <= rasterTarget.pixelBudget && rasterTarget.width <= 2000, 'rasterization must obey the explicit pixel budget instead of fixed 4x enlargement');
  const blockingStarted = Date.now();
  await assert.rejects(
    () => prepareFormulaRows([formulaRow(0)], 'latex-vector', { formulaDeadlineMs: 30, formulaWorkerPath: path.join(__dirname, 'fixtures', 'blockingFormulaWorker.js') }),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_PREPARATION_TIMEOUT'
  );
  assert.ok(Date.now() - blockingStarted < 2000, 'blocking CPU worker must be terminated before timeout rejection returns');
  let eventLoopAdvanced = false;
  setTimeout(() => { eventLoopAdvanced = true; }, 5);
  const blockingPythonStarted = Date.now();
  await assert.rejects(
    () => prepareFormulaRows([formulaRow(0)], 'latex-vector', {
      formulaDeadlineMs: 500,
      formulaPolicyScript: path.join(__dirname, 'fixtures', 'blockingPython.py'),
      renderFormula: async () => ({ svg: '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>', width: 10, height: 10 }),
      rasterizeFormula: async () => Buffer.from('png'),
    }),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_PREPARATION_TIMEOUT'
  );
  assert.ok(eventLoopAdvanced, 'Python formula conversion must not block the Node event loop');
  assert.ok(Date.now() - blockingPythonStarted < 2000, 'blocking Python conversion must be terminated before timeout rejection returns');
  await assert.rejects(
    () => prepareFormulaRows([formulaRow(0)], 'word-native', {
      allowNative: true,
      formulaDeadlineMs: 1000,
      formulaMathmlToOmmlScript: path.join(__dirname, 'fixtures', 'blockingPython.py'),
    }),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.code === 'FORMULA_PREPARATION_TIMEOUT'
  );
  let activeFormulaRenders = 0; let peakFormulaRenders = 0;
  await prepareFormulaRows(Array.from({ length: 12 }, (_, index) => formulaRow(index)), 'latex-vector', {
    renderFormula: async () => { activeFormulaRenders += 1; peakFormulaRenders = Math.max(peakFormulaRenders, activeFormulaRenders); await new Promise(resolve => setTimeout(resolve, 5)); activeFormulaRenders -= 1; return { svg: '<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>', width: 10, height: 10 }; },
    rasterizeFormula: async () => Buffer.from('png'),
  });
  assert.ok(peakFormulaRenders <= 4, `formula preparation concurrency must be bounded, observed ${peakFormulaRenders}`);

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

  const hiddenAnswerFormula = [{ id: 'q-hidden-formula', type: 'single', stem: 'plain stem', answer: '$x+1$' }];
  const hiddenFormulaWord = await writePaperArtifact('word', { title: 'hidden-formula', answerPosition: 'hidden', formulaMode: 'word-native' }, hiddenAnswerFormula, { root });
  assert.strictEqual(hiddenFormulaWord.formulaCount, 0, 'formulas omitted by answer placement must not be reported as visible formulas');
  assert.strictEqual(hiddenFormulaWord.questionCount, 1);
  assert.match(hiddenFormulaWord.sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(hiddenFormulaWord.pageCount, null, 'DOCX page count must remain explicitly unknown until a real renderer runs');

  const subAnswerFormula = [{ id: 'q-sub-answer', type: 'single', rich_content: { type: 'question-document', sections: { stem: { type: 'doc', content: [] }, options: [], subQuestions: [{ label: '(1)', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'part' }] }] }, answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'formula', attrs: { canonicalLatex: 'x+1' } }] }] } }], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] } } } }];
  for (const answerPosition of ['end', 'after-each']) {
    const artifact = await writePaperArtifact('word', { title: `sub-answer-${answerPosition}`, answerPosition, formulaMode: 'latex-vector' }, subAnswerFormula, { root });
    assert.strictEqual(artifact.formulaCount, 1, `${answerPosition} must include sub-question answer formulas in the manifest`);
    const xml = strFromU8(unzipSync(fs.readFileSync(artifact.filePath))['word/document.xml']);
    assert.ok(xml.includes('GEWU_FORMULA_0'), `${answerPosition} must render the sub-question answer`);
  }
  const hiddenSubAnswer = await writePaperArtifact('word', { title: 'sub-answer-hidden', answerPosition: 'hidden', formulaMode: 'latex-vector' }, subAnswerFormula, { root });
  assert.strictEqual(hiddenSubAnswer.formulaCount, 0, 'hidden must omit sub-question answers from output and manifest');

  const legacySubAnswerFormula = [{ id: 'q-legacy-sub', type: 'single', stem: 'legacy parent', sub_questions: [{ label: '(a)', content: 'legacy part $y$', answer: 'legacy result $z+1$' }] }];
  for (const answerPosition of ['end', 'after-each']) {
    const artifact = await writePaperArtifact('word', { title: `legacy-sub-${answerPosition}`, answerPosition, formulaMode: 'latex-vector' }, legacySubAnswerFormula, { root });
    assert.strictEqual(artifact.formulaCount, 2, `${answerPosition} must include legacy sub-question content and answer formulas`);
    const text = textOf(strFromU8(unzipSync(fs.readFileSync(artifact.filePath))['word/document.xml']));
    assert.ok(text.includes('legacy part') && text.includes('legacy result'), `${answerPosition} must render legacy sub-question content and answer`);
  }
  const hiddenLegacySub = await writePaperArtifact('word', { title: 'legacy-sub-hidden', answerPosition: 'hidden', formulaMode: 'latex-vector' }, legacySubAnswerFormula, { root });
  assert.strictEqual(hiddenLegacySub.formulaCount, 1, 'hidden must keep legacy sub-question content formula but omit its answer formula');

  const concurrent = await Promise.all(Array.from({ length: 8 }, () => writePaperArtifact('word', { title: 'same-title', answerPosition: 'hidden' }, [{ type: 'single', stem: 'plain' }], { root })));
  assert.strictEqual(new Set(concurrent.map(item => item.fileName)).size, concurrent.length, 'concurrent exports in the same millisecond must use collision-resistant names');

  const modeQuestion = [{ id: 'q-mode', type: 'single', stem: 'mode $\\frac{a}{b}$', answer: 'A' }];
  const mathtypeFallback = await writePaperArtifact('word', { title: 'mathtype-fallback', answerPosition: 'hidden', formulaMode: 'mathtype-compatible' }, modeQuestion, { root });
  assert.deepStrictEqual(mathtypeFallback.effectiveFormulaModes, ['latex-vector']);
  assert.strictEqual(mathtypeFallback.fallbackCount, 1);
  assert.ok(mathtypeFallback.diagnostics.some(item => item.code === 'MATHTYPE_WRITER_UNAVAILABLE' && item.questionId === 'q-mode' && item.location === 'stem'));
  const mathtypeFiles = unzipSync(fs.readFileSync(mathtypeFallback.filePath));
  assert.ok(!Object.keys(mathtypeFiles).some(name => name.startsWith('word/embeddings/')), 'vector fallback must not masquerade as MathType OLE');
  assert.ok(!strFromU8(mathtypeFiles['word/_rels/document.xml.rels']).includes('/oleObject'));

  const pdfNativeFallback = await writePaperArtifact('pdf', { title: 'pdf-native-fallback', answerPosition: 'hidden', formulaMode: 'word-native' }, modeQuestion, { root });
  assert.deepStrictEqual(pdfNativeFallback.effectiveFormulaModes, ['latex-vector']);
  assert.strictEqual(pdfNativeFallback.fallbackCount, 1, 'PDF vectorization must be reported as a fallback from a requested editable Word mode');
  assert.strictEqual(pdfNativeFallback.formulaCount, 1);
  assert.ok(pdfNativeFallback.pageCount >= 1);
  assert.match(pdfNativeFallback.sha256, /^[a-f0-9]{64}$/);
  assert.ok(fs.readFileSync(pdfNativeFallback.filePath).includes(Buffer.from('gewu-formula:0')), 'generated PDF must carry formula-index geometry evidence');

  const emptyFormulaQuestion = [{ id: 'q-empty', type: 'single', rich_content: { type: 'question-document', sections: { stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'formula', attrs: { canonicalLatex: '', displayMode: 'inline' } }] }] }, options: [], subQuestions: [], answer: { type: 'doc', content: [] }, analysis: { type: 'doc', content: [] } } } }];
  const exportsDir = path.join(root, 'assets', 'exports');
  const filesBeforeEmptyFailure = new Set(fs.readdirSync(exportsDir));
  await assert.rejects(
    () => writePaperArtifact('word', { title: 'must-clean-empty', answerPosition: 'hidden', formulaMode: 'latex-vector' }, emptyFormulaQuestion, { root }),
    error => error.code === 'FORMULA_VISIBLE_GATE_FAILED' && error.diagnostics?.[0]?.questionId === 'q-empty' && error.diagnostics?.[0]?.location === 'stem'
  );
  assert.deepStrictEqual(new Set(fs.readdirSync(exportsDir)), filesBeforeEmptyFailure, 'failed visible gate must not leave a partial artifact');

  const aliasQuestions = ['选择题', '单选', 'single', 'single-choice', '多选', 'multi', 'multiple', 'multiple-choice'].map((type, index) => ({ type, stem: `alias-${index}`, answer: 'A' }));
  const aliases = await writePaperArtifact('pdf', { title: 'aliases', answerPosition: 'end' }, aliasQuestions, { root });
  assert.ok(aliases.semanticText.includes('题号 1 2 3 4 5 6 7 8'), 'all canonical choice aliases belong in summary');
  assert.strictEqual(normalizedQuestion({ type: 'experiment' }).type, '\u5b9e\u9a8c\u9898');
  assert.strictEqual(normalizedQuestion({ type: 'judge' }).type, '\u5224\u65ad\u9898');
  for (const type of ['fill', 'short', 'drawing', 'calculation', 'problem']) assert.strictEqual(normalizedQuestion({ type }).type, '\u89e3\u7b54\u9898');
  const hiddenEmptyFormulaQuestion = [{ id: 'q-hidden-empty', type: 'single', rich_content: { type: 'question-document', sections: { stem: { type: 'doc', content: [] }, options: [], subQuestions: [], answer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'formula', attrs: { canonicalLatex: '' } }] }] }, analysis: { type: 'doc', content: [] } } } }];
  const hiddenEmpty = await writePaperArtifact('word', { title: 'hidden-empty', answerPosition: 'hidden', formulaMode: 'latex-vector' }, hiddenEmptyFormulaQuestion, { root });
  assert.strictEqual(hiddenEmpty.formulaCount, 0, 'hidden answer formulas are outside the output contract and must not block or count');

  const filesBeforePostWriteGateFailure = new Set(fs.readdirSync(exportsDir));
  await assert.rejects(
    () => writePaperArtifact('word', { title: 'must-clean-post-write', answerPosition: 'hidden', formulaMode: 'latex-vector' }, [{ id: 'q-clean', type: 'single', stem: 'plain' }], {
      root,
      inspectVisibleArtifact: () => { throw Object.assign(new Error('forced final gate failure'), { code: 'FORMULA_VISIBLE_GATE_FAILED' }); },
    }),
    /forced final gate failure/
  );
  assert.deepStrictEqual(new Set(fs.readdirSync(exportsDir)), filesBeforePostWriteGateFailure, 'post-write gate failure must delete the generated artifact');

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
