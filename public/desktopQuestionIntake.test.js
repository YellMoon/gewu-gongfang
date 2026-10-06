'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { zipSync, strToU8 } = require('fflate');
const { createQuestionImportParser } = require('../storage-agent/src/questionImportParser');
function createFixture() {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const drawing = (w,h,descr='') => `<w:r><w:drawing><wp:inline><wp:extent cx="${Math.round(w*9525)}" cy="${Math.round(h*9525)}"/><wp:docPr id="1" name="picture" descr="${descr}"/><a:blip r:embed="picture"/></wp:inline></w:drawing></w:r>`;
  const doc = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t>1.题干</w:t></w:r>${drawing(1,1)}${drawing(12,6,'www.example.com logo')}${drawing(107.5,49)}<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p><w:p><w:r><w:t>【答案】结果</w:t></w:r></w:p></w:body></w:document>`;
  const bytes = Buffer.from(zipSync({ 'word/document.xml': strToU8(doc), 'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture.png"/></Relationships>'), 'word/media/picture.png': image }));
  return bytes;
}
async function main() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gewu-desktop-intake-'));
  const bytes = createFixture();
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  try {
    const parser = createQuestionImportParser({ workRoot, parserPath: path.resolve('modules/question-bank/parsers/parse_word.py'), pythonBin: path.resolve('runtime/python/python.exe') });
    const result = await parser.parse({ sourceType: 'exam', sourceFileName: '本地录入.docx', bytes });
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, 'source remains byte-for-byte unchanged');
    assert.equal(result.sourceSha256, hash);
    assert.equal(result.qualityReport.image_cleanup.removed_count, 2);
    const serialized = JSON.stringify(result.candidates);
    const images = []; const visit = node => { if (node?.type === 'image') images.push(node); node?.content?.forEach(visit); }; visit(result.candidates[0].candidate.rich_content.sections.stem); assert(images.some(node => Math.abs(node.attrs.width - 107.5) < 0.001 && node.attrs.height === 49));
    assert(serialized.includes('canonicalLatex'));
    require('../shared/questionRichContentContract').normalizeQuestionRichContent(result.candidates[0].candidate.rich_content);
    assert(!serialized.includes('data:image'));
    assert.deepEqual(fs.readdirSync(path.join(workRoot, '.gewu-question-intake')), [], 'temporary document removed after parsing');
    assert.equal(result.mediaBytes[0].length, 1, 'normal shared-hash image retained');
    const desktop = require('./desktopQuestionIntake').createDesktopQuestionIntake({ appRoot: path.resolve(__dirname, '..'), workRoot });
    assert.equal((await desktop.parse({ sourceType: 'exam', sourceFileName: '本机.docx', bytes: new Uint8Array(bytes) })).sourceSha256, hash);
    await assert.rejects(desktop.parse({ sourceType: 'exam', sourceFileName: '旧版.doc', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) }), /QUESTION_INTAKE_DOC_CONVERSION_REQUIRED/);
    await assert.rejects(desktop.parse({ sourceType: 'exam', sourceFileName: '../outside.docx', bytes: new Uint8Array(bytes) }), /QUESTION_IMPORT_PARSE_INPUT_INVALID/);
    console.log('actual bundled Python desktop intake: original digest, two removed branding occurrences, source geometry, editable LaTeX and temporary cleanup passed');
  } finally {
    const resolved = path.resolve(workRoot); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
module.exports = { createFixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });


