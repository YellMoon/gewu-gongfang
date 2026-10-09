'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { zipSync, strToU8 } = require('fflate');
const { createDesktopQuestionIntake } = require('./desktopQuestionIntake');
const { createQuestionImportParser } = require('../shared/questionImportParser');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function createTopicFixture({ onlyAmbiguous = false, sharedAnswer = false } = {}) {
  const text = value => '<w:p><w:r><w:t>' + value + '</w:t></w:r></w:p>';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const drawing = '<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="diagram"/><a:blip r:embed="picture"/></wp:inline></w:drawing></w:r>';
  const formula = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
  const blocks = [text('Topic collection'), text('\u4e00\u3001\u5355\u9009\u9898'),
    '<w:p><w:r><w:t>1.\uff082026\u00b7\u6d59\u6c5f\u4e8c\u6a21\uff09First \u5b9e\u9a8c question </w:t></w:r>' + drawing + formula + '</w:p>',
    text('A. option A'), text('B. option B'), text('\u3010\u7b54\u6848\u3011A'), text('\u3010\u8be6\u89e3\u3011First explanation'),
    text('\u4e8c\u3001\u5b9e\u9a8c\u9898'), text('2.\uff08\u5728\u771f\u7a7a\u4e2d\uff09Second question'), text('(1) Measure the value'), text('(2) Compare it'),
    '<w:tbl><w:tr><w:tc>' + text('3.14') + '</w:tc><w:tc>' + text('6.28') + '</w:tc></w:tr></w:tbl>',
    text('\u3010\u7b54\u6848\u3011(1) 10 (2) 20'), text('\u3010\u89e3\u6790\u3011Second explanation'),
    text('\u4e09\u3001\u89e3\u7b54\u9898'), text('Shared material for the following questions'),
    text('3.Third question'), text('4.Fourth question'), text('\u3010\u7b54\u6848\u30113\uff0eA 4\uff0eC'),
    text('\u3010\u8be6\u89e3\u3011'), text('3.Third explanation'), text('Continuation for third'), text('4.Fourth explanation'),
  ];
  if (sharedAnswer) blocks[18] = text('\u3010\u7b54\u6848\u3011Shared answer');
  const selected = onlyAmbiguous ? [blocks[0], ...blocks.slice(14)] : blocks;
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' + selected.join('') + '</w:body></w:document>';
  return Buffer.from(zipSync({ 'word/document.xml': strToU8(xml), 'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/diagram.png"/></Relationships>'), 'word/media/diagram.png': image }));
}
async function main() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-topic-intake-'));
  try {
    const bytes = createTopicFixture();
    const parser = createDesktopQuestionIntake({ appRoot: root, workRoot });
    const parsed = await parser.parse({ sourceType: 'topic', sourceFileName: 'topic.docx', bytes: new Uint8Array(bytes) });
    const questions = parsed.candidates.map(item => item.candidate);
    assert.equal(questions.length, 2);
    assert.equal(parsed.sourceSha256, hash(bytes));
    assert.equal(parsed.qualityReport.topic_collection.removed_source_prefixes, 1);
    assert(!questions[0].stem.includes('2026'));
    assert.equal(questions[0].answer, 'A');
    assert.equal(questions[0].analysis, 'First explanation');
    assert(!questions[0].stem.includes('explanation'));
    assert.equal(questions[0].options.length, 2);
    assert.deepEqual(questions[0].options.map(option => option.is_correct),[true,false]);
    assert.equal(questions[0].formulas.length, 1);
    assert.equal(parsed.mediaBytes[0].length, 1);
    assert(questions[1].stem.startsWith('\uff08\u5728\u771f\u7a7a\u4e2d\uff09'), 'ordinary parentheses remain');
    assert.equal(questions[1].sub_questions.length, 2);
    assert.deepEqual(questions[1].sub_questions.map(sub => sub.answer), ['', '']);
    assert.equal(questions[1].answer, '(1) 10 (2) 20', 'numbered answer text remains the whole-question answer');
    assert(JSON.stringify(questions[1]).includes('3.14'), 'decimal cells stay in the question');
    assert.deepEqual(parsed.qualityReport.topic_collection.skipped_groups,
      [{ numbers: [3, 4], reason: 'shared_material_or_combined_answers' }]);
    assert.equal(parsed.qualityReport.topic_collection.detected_numbered_questions, 4);
    assert(!JSON.stringify(questions).includes('Shared material'), 'ambiguous groups are excluded from candidate content');
    const empty = await parser.parse({ sourceType: 'topic', sourceFileName: 'ambiguous.docx', bytes: new Uint8Array(createTopicFixture({onlyAmbiguous:true})) });
    assert.equal(empty.candidates.length,0);
    assert.deepEqual(empty.qualityReport.topic_collection.skipped_groups[0].numbers,[3,4]);
    const shared = await parser.parse({ sourceType: 'topic', sourceFileName: 'shared.docx', bytes: new Uint8Array(createTopicFixture({sharedAnswer:true})) });
    assert.equal(shared.candidates.length,2, 'shared unnumbered answers also exclude the entire ambiguous group');
    for (const question of questions) {
      assert.equal(question.source, 'Topic collection');
      assert(!question.region && !question.school && !question.year, 'removed provenance does not become metadata');
      require('../shared/questionRichContentContract').normalizeQuestionRichContent(question.rich_content);
    }
    const base = createQuestionImportParser({ workRoot, parserPath: path.join(root, 'modules/question-bank/parsers/parse_word.py'), pythonBin: path.join(root, 'runtime/python/python.exe') });
    const topic = createQuestionImportParser({ workRoot, parserPath: path.join(root, 'public/parsers/topic_collection.py'), pythonBin: path.join(root, 'runtime/python/python.exe') });
    assert.equal(parsed.parserSha256, hash(base.revision + ':' + topic.revision), 'parser proof covers both topic and shared formula/media conversion');
    assert.equal((await parser.parse({ sourceType: 'exam', sourceFileName: 'exam.docx', bytes: new Uint8Array(require('./desktopQuestionIntake.test').createFixture()) })).parserSha256, base.revision, 'legacy formats retain their parser revision');
    assert.deepEqual(fs.readdirSync(path.join(workRoot, '.gewu-question-intake')), []);
    console.log('topic intake: inline solutions, source removal, options/subparts, ambiguous-group skip/report, decimals, media/formulas, legacy revision and cleanup passed');
  } finally {
    assert(path.resolve(workRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}
module.exports = { createTopicFixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
