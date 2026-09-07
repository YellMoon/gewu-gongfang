'use strict';

const { convertToXmlComponent } = require('docx');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { STATE } = require('mathjax-full/js/core/MathItem.js');
RegisterHTMLHandler(liteAdaptor());

const element = (name, elements = [], attributes) => ({ type: 'element', name: `m:${name}`, elements, ...(attributes ? { attributes } : {}) });
const property = (name, value) => element(name, [], { 'm:val': String(value) });
const text = value => ({ type: 'text', text: value });
const unsupported = () => Object.assign(new Error('Native Word formula cannot be represented safely'), { code: 'CLOUD_PAPER_RENDER_NATIVE_FORMULA_UNSUPPORTED' });
// TeX/MathML uses spacing glyphs; Office positions combining marks over the base.
const accentCharacter = value => ({
  '\u2192': '\u20d7', '\u2190': '\u20d6', '\u2194': '\u20e1',
  '^': '\u0302', '\u02c6': '\u0302', '~': '\u0303', '\u02dc': '\u0303',
  '\u00af': '\u0305', '\u02c9': '\u0305', '\u02d9': '\u0307', '\u00a8': '\u0308',
  '\u02c7': '\u030c', '\u00b4': '\u0301', '`': '\u0300', '\u02cb': '\u0300', '\u02d8': '\u0306',
}[value] || value);

// MathJax parses TeX; this translator preserves its mathematical tree as OMML.
// It never imports user XML, executes Office tooling, or silently rasterizes an
// unsupported native formula. Unknown notation fails the export explicitly.
function nativeFormulaComponent(latex) {
  if (typeof latex !== 'string' || !latex.trim() || latex.length > 32768) throw unsupported();
  const tex = new TeX({ packages: AllPackages.filter(name => !['noerrors','noundefined'].includes(name)), formatError() { throw unsupported(); } });
  const document = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'none' }) });
  const root = document.convert(latex, { display: true, end: STATE.CONVERT });
  let visited = 0;
  function convert(node, depth = 0) {
    if (!node || ++visited > 20000 || depth > 128) throw unsupported();
    const children = node.childNodes || [];
    const attr = name => node.attributes?.get(name);
    const parts = child => convert(child, depth + 1);
    const all = () => children.flatMap(parts);
    const field = (name, child) => element(name, child ? parts(child) : []);
    const script = (name, base, sub, sup) => element(name, [field('e', base), ...(sub ? [field('sub', sub)] : []), ...(sup ? [field('sup', sup)] : [])]);
    switch (node.kind) {
      case 'math': case 'inferredMrow': case 'mstyle': case 'TeXAtom':
        return all();
      case 'mrow': {
        const first = children[0], last = children.at(-1);
        if (children.length >= 2 && first?.attributes?.get('fence') && last?.attributes?.get('fence')) {
          return [element('d', [element('dPr', [property('begChr', first.getText()), property('endChr', last.getText())]),
            element('e', children.slice(1, -1).flatMap(parts))])];
        }
        return all();
      }
      case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms': {
        const value = node.getText();
        const variant = String(attr('mathvariant') || '');
        const properties = [];
        if (node.kind !== 'mi' || variant === 'normal') properties.push(property('sty', 'p'));
        else if (variant.includes('bold')) properties.push(property('sty', variant.includes('italic') ? 'bi' : 'b'));
        for (const [key, style] of [['double-struck','double-struck'],['fraktur','fraktur'],['script','script'],['sans-serif','sans-serif'],['monospace','monospace']]) {
          if (variant.includes(key)) properties.push(property('scr', style));
        }
        return [element('r', [...(properties.length ? [element('rPr', properties)] : []), element('t', [text(value)], {'xml:space':'preserve'})])];
      }
      case 'mspace':
        return [element('r', [element('t', [text(' ')], {'xml:space':'preserve'})])];
      case 'mfrac': {
        const kind = attr('bevelled') ? 'skw' : /^0(?:px|em|ex|pt|%)?$/.test(String(attr('linethickness'))) ? 'noBar' : null;
        return [element('f', [...(kind ? [element('fPr', [property('type', kind)])] : []), field('num', children[0]), field('den', children[1])])];
      }
      case 'msup': return [script('sSup', children[0], null, children[1])];
      case 'msub': return [script('sSub', children[0], children[1], null)];
      case 'msubsup': return [script('sSubSup', children[0], children[1], children[2])];
      case 'msqrt': return [element('rad', [element('radPr', [property('degHide', 1)]), element('deg'), element('e', all())])];
      case 'mroot': return [element('rad', [field('deg', children[1]), field('e', children[0])])];
      case 'mover': {
        if (attr('accent')) return [element('acc', [element('accPr', [property('chr', accentCharacter(children[1].getText()))]), field('e', children[0])])];
        return [element('limUpp', [field('e', children[0]), field('lim', children[1])])];
      }
      case 'munder': {
        if (attr('accentunder')) {
          if (!['\u0332', '_'].includes(children[1].getText())) throw unsupported();
          return [element('bar', [element('barPr', [property('pos', 'bot')]), field('e', children[0])])];
        }
        return [element('limLow', [field('e', children[0]), field('lim', children[1])])];
      }
      case 'munderover':
        return [element('limUpp', [element('e', [element('limLow', [field('e', children[0]), field('lim', children[1])])]), field('lim', children[2])])];
      case 'mtable':
        return [element('m', children.map(row => {
          if (row.kind !== 'mtr') throw unsupported();
          return element('mr', row.childNodes.map(cell => {
            if (cell.kind !== 'mtd') throw unsupported();
            return element('e', cell.childNodes.flatMap(parts));
          }));
        }))];
      case 'none': return [];
      case 'mphantom': return [element('phant', [element('phantPr', [property('show', 0)]), element('e', all())])];
      case 'semantics': return children.length ? parts(children[0]) : [];
      default: throw unsupported();
    }
  }
  return convertToXmlComponent(element('oMath', convert(root)));
}

module.exports = Object.freeze({ nativeFormulaComponent });
