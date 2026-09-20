'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const { xml2js, js2xml } = require('xml-js');
const { isChoiceQuestionType } = require('./questionChoiceStructure');

const TEMPLATE_SHA256 = 'fb8ac8d5b95f18ac72110a9161583fbf92736a991545980dd6b6b7b9a19060f2';
const PAGE = Object.freeze({ width: 11906, height: 16838, top: 1418, bottom: 1134, left: 1134, right: 1134, header: 454, footer: 510 });
const element = (name, attributes, elements) => ({ type: 'element', name, ...(attributes ? { attributes } : {}), ...(elements ? { elements } : {}) });
const child = (node, name) => node.elements?.find(e => e.name === name);
const children = (node, name) => (node.elements || []).filter(e => !name || e.name === name);
const clone = node => structuredClone(node);
function walk(node, visit) { visit(node); for (const e of node.elements || []) walk(e, visit); }
function text(node) { let value = ''; walk(node, n => { if (n.name === 'w:t') value += (n.elements || []).map(e => e.text || '').join(''); }); return value; }
function replaceText(node, value) {
  let first = true;
  walk(node, n => { if (n.name === 'w:t') { n.elements = [{ type: 'text', text: first ? value : '' }]; first = false; } });
  if (first) node.elements = [...(node.elements || []), element('w:r', null, [element('w:t', null, [{ type: 'text', text: value }])])];
  return node;
}
function property(node, name, attributes) {
  let p = child(node, 'w:pPr');
  if (!p) { p = element('w:pPr', null, []); node.elements.unshift(p); }
  p.elements ||= [];
  p.elements = p.elements.filter(e => e.name !== name);
  p.elements.push(element(name, attributes));
}
function questionCategory(item) {
  const types = (Array.isArray(item.questionType) ? item.questionType : [item.questionType]).map(t => String(t || '').trim().toLowerCase());
  if (types.some(t => ['problem', 'calculation', 'calculate', 'solution', 'solve', 'essay', '\u89e3\u7b54', '\u89e3\u7b54\u9898', '\u8ba1\u7b97\u9898', '\u8ba1\u7b97'].includes(t))) return '\u89e3\u7b54\u9898';
  if (types.some(t => ['experiment', 'experimental', '\u5b9e\u9a8c', '\u5b9e\u9a8c\u9898'].includes(t))) return '\u5b9e\u9a8c\u9898';
  if (isChoiceQuestionType(types)) return types.some(t => /multi|multiple|\u591a\u9009/.test(t)) ? '\u591a\u9009\u9898' : '\u5355\u9009\u9898';
  if (types.some(t => ['fill', 'fill_blank', 'fill-blank', '\u586b\u7a7a', '\u586b\u7a7a\u9898'].includes(t))) return '\u586b\u7a7a\u9898';
  return '\u8bd5\u9898';
}
function isSolution(item) { return /\u89e3\u7b54|\u8ba1\u7b97/.test(item.sectionTitle || '') || questionCategory(item) === '\u89e3\u7b54\u9898'; }
function choiceAnswerGrid(source, blocks) {
  const choices = blocks.filter(b => isChoiceQuestionType(b.questionType));
  if (!choices.length) return [];
  const grid = clone(source), rows = children(grid, 'w:tr');
  grid.elements = grid.elements.filter(n => n.name !== 'w:tr');
  for (let start = 0; start < choices.length; start += 10) {
    for (let kind = 0; kind < 2; kind++) {
      const row = clone(rows[kind]);
      // Cloned layout identifiers are editing hints, not semantic identities.
      walk(row, n => { if (n.attributes) { delete n.attributes['w14:paraId']; delete n.attributes['w14:textId']; } });
      children(row, 'w:tc').forEach((cell, column) => {
        const item = choices[start + column - 1];
        const value = column === 0 ? (kind ? '\u7b54\u6848' : '\u9898\u53f7') : item ? String(kind ? item.choiceAnswer : item.number) : '';
        replaceText(child(cell, 'w:p'), value);
      });
      grid.elements.push(row);
    }
  }
  return [grid];
}

async function templateArchive() {
  const bytes = fs.readFileSync(path.join(__dirname, '../resources/paper/output-template.docx'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== TEMPLATE_SHA256) throw new Error('CLOUD_PAPER_TEMPLATE_HASH_MISMATCH');
  return JSZip.loadAsync(bytes);
}

async function pdfTemplateProfile() {
  const zip = await templateArchive();
  const doc = xml2js(await zip.file('word/document.xml').async('string'));
  const body = children(child(child(doc, 'w:document'), 'w:body'));
  const footer = child(xml2js(await zip.file('word/footer1.xml').async('string')), 'w:ftr');
  return { title: text(body[0]), metadata: text(body[1]), answerTitle: text(body[21]),
    contact: children(footer, 'w:p').map(text).filter(Boolean).at(-1),
    page: PAGE, fontSize: 10.5, titleSize: 15, footerSize: 9 };
}

// Only generated question content is imported. The actual supplied package is
// the base; styles, furniture, custom XML, fields and original media stay intact.
async function applyPaperTemplate(generatedBytes, { title, answerPosition, blocks, bodyCount }) {
  const zip = await templateArchive(), generated = await JSZip.loadAsync(generatedBytes);
  const read = async (archive, name) => xml2js(await archive.file(name).async('string'));
  const doc = await read(zip, 'word/document.xml'), sourceDoc = await read(generated, 'word/document.xml');
  const root = child(doc, 'w:document'), sourceRoot = child(sourceDoc, 'w:document');
  for (const [key, value] of Object.entries(sourceRoot.attributes || {})) {
    if (key.startsWith('xmlns:') && root.attributes[key] && root.attributes[key] !== value) throw new Error('CLOUD_PAPER_TEMPLATE_NAMESPACE_CONFLICT');
    if (key.startsWith('xmlns:')) root.attributes[key] = value;
  }
  const body = child(root, 'w:body'), original = children(body);
  const imported = children(child(sourceRoot, 'w:body')).filter(n => n.name !== 'w:sectPr');
  const rels = await read(zip, 'word/_rels/document.xml.rels'), relRoot = child(rels, 'Relationships');
  const generatedRels = child(await read(generated, 'word/_rels/document.xml.rels'), 'Relationships');
  const contentTypes = await read(zip, '[Content_Types].xml'), typeRoot = child(contentTypes, 'Types');
  const generatedTypes = child(await read(generated, '[Content_Types].xml'), 'Types');
  const ids = new Set(children(relRoot).map(n => n.attributes.Id)), references = new Set();
  for (const node of imported) walk(node, n => {
    for (const [key, value] of Object.entries(n.attributes || {})) if (['r:embed', 'r:link', 'r:id'].includes(key)) references.add(value);
  });
  const remap = new Map();
  let serial = 0;
  for (const id of references) {
    const relationship = children(generatedRels).find(n => n.attributes.Id === id);
    if (!relationship || !relationship.attributes.Type.endsWith('/image') || relationship.attributes.TargetMode) throw new Error('CLOUD_PAPER_TEMPLATE_RELATIONSHIP_INVALID');
    const origin = path.posix.normalize(path.posix.join('word', relationship.attributes.Target));
    if (!origin.startsWith('word/media/') || !generated.file(origin)) throw new Error('CLOUD_PAPER_TEMPLATE_MEDIA_INVALID');
    let nextId, target;
    do { serial++; nextId = `rIdExport${serial}`; target = `media/export-${serial}${path.posix.extname(origin)}`; } while (ids.has(nextId) || zip.file(`word/${target}`));
    ids.add(nextId); remap.set(id, nextId);
    zip.file(`word/${target}`, await generated.file(origin).async('nodebuffer'));
    relRoot.elements.push(element('Relationship', { ...relationship.attributes, Id: nextId, Target: target }));
    const extension = path.posix.extname(origin).slice(1);
    if (!children(typeRoot).some(n => n.attributes.Extension === extension)) {
      const type = children(generatedTypes).find(n => n.attributes.Extension === extension);
      if (!type) throw new Error('CLOUD_PAPER_TEMPLATE_MEDIA_TYPE_INVALID');
      typeRoot.elements.push(clone(type));
    }
  }
  let drawingId = 200000;
  for (const node of imported) walk(node, n => {
    for (const key of ['r:embed', 'r:link', 'r:id']) if (n.attributes?.[key]) n.attributes[key] = remap.get(n.attributes[key]);
    if (n.name === 'wp:docPr' || n.name === 'pic:cNvPr') n.attributes.id = String(++drawingId);
  });
  const titleNode = clone(original[0]);
  walk(titleNode, n => { if (n.name === 'w:t') for (const t of n.elements || []) if (t.text) t.text = t.text.replace('\u8bd5\u5377\u540d', title); });
  const result = [titleNode, clone(original[1]), clone(original[2])];
  let previousSection = '', sectionNumber = 0, previousSolution = false;
  for (const block of blocks) {
    const section = block.sectionTitle || questionCategory(block);
    const content = imported.slice(block.start, block.end);
    const solution = isSolution(block);
    const pageBreak = (solution && block.start > 0) || previousSolution;
    let heading;
    if (section !== previousSection) {
      heading = replaceText(clone(original[7]), block.sectionTitle || `${['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u4e03','\u516b','\u4e5d','\u5341'][sectionNumber] || sectionNumber + 1}\u3001${section}`);
      sectionNumber++;
      property(heading, 'w:keepNext');
      if (pageBreak) property(heading, 'w:pageBreakBefore');
      result.push(heading); previousSection = section;
    }
    if (pageBreak && !heading) property(content.find(n => n.name === 'w:p'), 'w:pageBreakBefore');
    result.push(...content);
    if (solution) result.push(element('w:p', null, [element('w:pPr', null, [
      element('w:spacing', { 'w:line': '4800', 'w:lineRule': 'exact', 'w:before': '0', 'w:after': '0' }),
      element('w:snapToGrid', { 'w:val': '0' }),
    ])]));
    previousSolution = solution;
  }
  if (answerPosition !== 'after') {
    const boundary = clone(original[20]);
    boundary.elements = boundary.elements.filter(n => n.name === 'w:pPr');
    const answerTitle = clone(original[21]);
    walk(answerTitle, n => { if (n.name === 'w:t') for (const t of n.elements || []) if (t.text) t.text = t.text.replace('\u8bd5\u5377\u540d', title); });
    result.push(boundary, answerTitle, ...choiceAnswerGrid(original[22], blocks), ...imported.slice(bodyCount), clone(original[38]));
  } else {
    result.push(clone(child(child(original[20], 'w:pPr'), 'w:sectPr')));
  }
  body.elements = result;
  const settings = await read(zip, 'word/settings.xml'), settingsRoot = child(settings, 'w:settings');
  settingsRoot.elements = (settingsRoot.elements || []).filter(n => n.name !== 'w:updateFields');
  settingsRoot.elements.push(element('w:updateFields', { 'w:val': 'true' }));
  zip.file('word/document.xml', js2xml(doc));
  zip.file('word/_rels/document.xml.rels', js2xml(rels));
  zip.file('[Content_Types].xml', js2xml(contentTypes));
  zip.file('word/settings.xml', js2xml(settings));
  // Word sizes the source's floating textbox against stale cached page fields.
  // Move its existing field runs unchanged into the already-centered footer
  // paragraph. Its border/contact/paragraph styling and fields stay intact;
  // only the unreliable, invisible textbox wrapper/fallback is removed.
  for (const name of ['word/footer1.xml', 'word/footer2.xml']) {
    const footer = await zip.file(name).async('string');
    const fieldRuns = /<wps:txbx><w:txbxContent><w:p\b[^>]*>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?([\s\S]*?)<\/w:p><\/w:txbxContent><\/wps:txbx>/.exec(footer)?.[1];
    const wrapper = /<w:r><w:rPr><w:sz w:val="18"\/><\/w:rPr><mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent><\/w:r>/;
    if (!fieldRuns || !wrapper.test(footer)) throw new Error('CLOUD_PAPER_TEMPLATE_FOOTER_INVALID');
    zip.file(name, footer.replace(wrapper, () => fieldRuns));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { applyPaperTemplate, pdfTemplateProfile, questionCategory, isSolution, PAGE, TEMPLATE_SHA256 };
