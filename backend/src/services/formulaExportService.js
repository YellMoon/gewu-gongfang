const katex = require('katex');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document('', { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: 'none' }) });
const MODES = new Set(['word-native', 'eq-field', 'mathtype-compatible', 'latex-vector']);

function resolveFormulaMode(value) {
  if (value === 'mathtype') return 'mathtype-compatible';
  if (value === 'eq') return 'eq-field';
  if (value === 'latex') return 'latex-vector';
  return MODES.has(value) ? value : 'word-native';
}

function latexToMathml(latex) {
  const html = katex.renderToString(String(latex || ''), { throwOnError: false, output: 'mathml', displayMode: false });
  const match = html.match(/<math[\s\S]*?<\/math>/i);
  return match ? match[0].replace(/<annotation[\s\S]*?<\/annotation>/gi, '') : '';
}

function renderLatexSvg(latex, display = false) {
  const node = mathDocument.convert(String(latex || ''), { display });
  const svg = adaptor.outerHTML(node).replace(/^<mjx-container[^>]*>/, '').replace(/<\/mjx-container>$/, '').replace(/currentColor/g, '#000000');
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/\s+/).map(Number) || [0, 0, 1000, 200];
  const ratio = viewBox[3] > 0 ? viewBox[2] / viewBox[3] : 5;
  const height = display ? 38 : 26;
  return { svg, width: Math.max(24, Math.min(520, Math.round(height * ratio))), height };
}

function readGroup(source, start) {
  if (source[start] !== '{') return { value: source[start] || '', end: start + 1 };
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
  }
  return { value: source.slice(start + 1), end: source.length };
}

function latexToEqField(latex) {
  let source = String(latex || '').trim().replace(/^\$+|\$+$/g, '');
  const casesMatch = source.match(/^([\s\S]*?)\\begin\{cases\}([\s\S]*?)\\end\{cases\}([\s\S]*)$/);
  if (casesMatch) {
    const cells = casesMatch[2].split(/\\\\/).flatMap(row => row.split('&').map(cell => latexToEqField(cell.trim())));
    return `${latexToEqField(casesMatch[1])}\\b\\lc\\{(\\a\\al\\co2(${cells.join(',')}))${latexToEqField(casesMatch[3])}`;
  }
  let output = '';
  for (let index = 0; index < source.length;) {
    if (source.startsWith('\\frac', index)) {
      const numerator = readGroup(source, index + 5); const denominator = readGroup(source, numerator.end);
      output += `\\f(${latexToEqField(numerator.value)},${latexToEqField(denominator.value)})`; index = denominator.end; continue;
    }
    if (source.startsWith('\\sqrt', index)) {
      const radicand = readGroup(source, index + 5); output += `\\r(,${latexToEqField(radicand.value)})`; index = radicand.end; continue;
    }
    if (source.startsWith('\\int', index)) {
      index += 4;
      let lower = ''; let upper = '';
      if (source[index] === '_') { const group = readGroup(source, index + 1); lower = latexToEqField(group.value); index = group.end; }
      if (source[index] === '^') { const group = readGroup(source, index + 1); upper = latexToEqField(group.value); index = group.end; }
      output += `\\i\\su(${lower},${upper},${latexToEqField(source.slice(index))})`;
      break;
    }
    if (source.startsWith('\\,', index) || source.startsWith('\\;', index) || source.startsWith('\\!', index)) { output += ' '; index += 2; continue; }
    if (source.startsWith('\\', index)) {
      const command = source.slice(index).match(/^\\([A-Za-z]+)/)?.[1] || '';
      const symbols = { times: '×', cdot: '·', le: '≤', ge: '≥', ne: '≠', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', infty: '∞' };
      output += symbols[command] || command; index += command.length + 1; continue;
    }
    if (source[index] === '^' || source[index] === '_') {
      const upper = source[index] === '^'; const group = readGroup(source, index + 1);
      output += upper ? `\\s\\up(${latexToEqField(group.value)})` : `\\s\\do(${latexToEqField(group.value)})`; index = group.end; continue;
    }
    if (!'{}'.includes(source[index])) output += source[index];
    index += 1;
  }
  return output;
}

function extractFormulaNodes(question = {}) {
  const result = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'formula' && node.attrs?.canonicalLatex) result.push({ latex: String(node.attrs.canonicalLatex), display: node.attrs.displayMode === 'block' });
    if (Array.isArray(node.content)) node.content.forEach(visit);
    Object.entries(node).forEach(([key, value]) => { if (key !== 'content' && value && typeof value === 'object') visit(value); });
  };
  visit(question.rich_content);
  return result;
}

module.exports = { extractFormulaNodes, latexToEqField, latexToMathml, renderLatexSvg, resolveFormulaMode };
