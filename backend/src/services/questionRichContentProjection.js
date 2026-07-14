const sanitizeHtml = require('sanitize-html');

function normalizeText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function plainLegacy(value) {
  return normalizeText(sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} }).replace(/\u00a0/g, ' '));
}

function projectRichContent(richContent) {
  const flags = { hasFormula: false, hasImage: false };
  const nodeText = node => {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'formula') { flags.hasFormula = true; return ` ${node.attrs?.canonicalLatex || ''} `; }
    if (node.type === 'image') { flags.hasImage = true; return ` ${node.attrs?.alt || ''} `; }
    const text = (node.content || []).map(nodeText).join('');
    return ['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock'].includes(node.type) ? `${text}\n` : text;
  };
  const docText = doc => normalizeText(nodeText(doc));
  const sections = richContent?.sections || {};
  const stem = docText(sections.stem);
  const options = (sections.options || []).map(option => ({ label: String(option.label || ''), content: docText(option.content), is_correct: Boolean(option.isCorrect) }));
  const subQuestions = (sections.subQuestions || []).map(sub => ({ label: String(sub.label || ''), content: docText(sub.content), answer: docText(sub.answer) }));
  const answer = docText(sections.answer);
  const explanation = docText(sections.analysis);
  const searchText = [stem, ...options.flatMap(option => [option.label, option.content]), ...subQuestions.flatMap(sub => [sub.label, sub.content, sub.answer]), answer, explanation]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { stem, options, subQuestions, answer, explanation, searchText, ...flags };
}

function projectSearchTextFromRow(row = {}) {
  if (row.rich_content_json) {
    try {
      const rich = JSON.parse(row.rich_content_json);
      if (rich?.version === 1 && rich?.type === 'question-document') return projectRichContent(rich).searchText;
    } catch (_error) {}
  }
  let options = [];
  try { options = JSON.parse(row.options_json || '[]'); } catch (_error) {}
  const optionParts = (Array.isArray(options) ? options : []).flatMap((option, index) => typeof option === 'string'
    ? [String.fromCharCode(65 + index), plainLegacy(option)]
    : [String(option?.label || String.fromCharCode(65 + index)), plainLegacy(option?.content ?? option?.text ?? '')]);
  return [plainLegacy(row.stem), ...optionParts, plainLegacy(row.answer), plainLegacy(row.explanation)]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = { plainLegacy, projectRichContent, projectSearchTextFromRow };
