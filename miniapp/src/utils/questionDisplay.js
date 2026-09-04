'use strict';

const OPTION_SEPARATOR = '[\\.\\uff0e\\u3001\\u3002\\)\\uff09:\\uff1a]';
const OPTION_SHORT_TEXT_LIMIT = 12;
const OPTION_MEDIUM_TEXT_LIMIT = 28;
const OPTION_LABEL = new RegExp(`^([A-G])${OPTION_SEPARATOR}\\s*([\\s\\S]*)$`, 'i');
const OPTION_LABEL_ONLY = new RegExp(`^\\s*([A-G])(?:${OPTION_SEPARATOR})?\\s*$`, 'i');
const PACKED_OPTION_LABEL = new RegExp(`(^|[\\r\\n\\t\\f])\\s*([A-G])${OPTION_SEPARATOR}\\s*`, 'g');
const SAFE_ASSET_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/;
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;
const SAFE_FONT_SIZE = /^(?:12|14|16|18|20|24|28|32)px$/;
const SAFE_FONT_FAMILY = new Set(['SimSun', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Arial', 'Times New Roman']);
const SAFE_TEXT_ALIGN = new Set(['left', 'center', 'right', 'justify']);
const SAFE_LINE_HEIGHT = new Set(['1', '1.25', '1.5', '1.75', '2']);
const MAX_RENDER_DEPTH = 40;
const QUESTION_ASSET_REF = /question-asset:\/\/([0-9a-f]{64})/gi;
const QUESTION_ASSET_IMAGE = /<img\b([^>]*?)\bsrc\s*=\s*(["'])question-asset:\/\/([0-9a-f]{64})\2([^>]*)>/gi;
const QUESTION_MEDIA_PENDING = String.fromCharCode(22270, 29255, 26242, 26410, 21152, 36733);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveQuestionAssetRefs(value, paths = {}) {
  const source = String(value || '');
  const visiblePlaceholder = attributes => {
    const alt = String(attributes || '').match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    const label = alt ? `${QUESTION_MEDIA_PENDING}${String.fromCharCode(65306)}${alt}` : QUESTION_MEDIA_PENDING;
    return `<span class="question-media-placeholder">${escapeHtml(label)}</span>`;
  };
  return source
    .replace(QUESTION_ASSET_IMAGE, (_match, before, _quote, assetKey, after) => {
      const resolved = typeof paths?.[assetKey] === 'string' ? paths[assetKey].trim() : '';
      if (!resolved) return visiblePlaceholder(`${before || ''}${after || ''}`);
      return `<img${before || ' '}src="${escapeHtml(resolved)}"${after || ''}>`;
    })
    .replace(QUESTION_ASSET_REF, (_match, assetKey) => {
      const resolved = typeof paths?.[assetKey] === 'string' ? paths[assetKey].trim() : '';
      return resolved ? escapeHtml(resolved) : `<span class="question-media-placeholder">${QUESTION_MEDIA_PENDING}</span>`;
    });
}

function normalizeOptionLabel(value, index) {
  const raw = String(value || '').trim();
  const label = raw.match(OPTION_LABEL_ONLY)?.[1];
  if (label) return label.toUpperCase();
  return raw ? raw.toUpperCase() : String.fromCharCode(65 + index);
}

function normalizeOption(option, index) {
  if (typeof option === 'string') {
    const value = option.trim();
    const match = value.match(OPTION_LABEL);
    return {
      label: normalizeOptionLabel(match?.[1], index),
      content: (match?.[2] || value).trim(),
    };
  }
  return {
    label: normalizeOptionLabel(option?.label, index),
    content: String(option?.content || option?.text || '').trim(),
  };
}

function splitPackedOption(option) {
  const raw = `${option.label}. ${option.content}`;
  const labels = Array.from(raw.matchAll(PACKED_OPTION_LABEL)).map(match => {
    const prefix = match[1] || '';
    const labelStart = (match.index || 0) + prefix.length;
    return {
      label: match[2].toUpperCase(),
      labelStart,
      contentStart: labelStart + match[2].length + match[0].slice(prefix.length + match[2].length).length,
    };
  });
  if (labels.length < 2) return [option];
  const split = labels.map((match, index) => ({
    label: match.label,
    content: raw.slice(match.contentStart, labels[index + 1]?.labelStart ?? raw.length).trim(),
  })).filter(item => item.content);
  return split.length >= 2 ? split : [option];
}

function splitPackedOptions(options) {
  const expanded = options.flatMap(splitPackedOption);
  return expanded.length >= options.length ? expanded : options;
}

function normalizeOptions(options) {
  const rows = (Array.isArray(options) ? options : [])
    .map(normalizeOption)
    .filter(option => option.content);
  return splitPackedOptions(rows);
}

function isImageOnlyOption(value) {
  const html = String(value || '').trim();
  if (!/<img\b/i.test(html)) return false;
  return html
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .trim() === '';
}

function visibleOptionText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos);/gi, 'x')
    .replace(/&#x[0-9a-f]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyOptionLength(options) {
  const rows = Array.isArray(options) ? options : [];
  let maxLength = 0;
  for (const option of rows) {
    maxLength = Math.max(maxLength, Array.from(visibleOptionText(option?.content)).length);
  }
  if (maxLength <= OPTION_SHORT_TEXT_LIMIT) return 'short';
  if (maxLength <= OPTION_MEDIUM_TEXT_LIMIT) return 'medium';
  return 'long';
}

function columnsForOptions(options) {
  const rows = Array.isArray(options) ? options : [];
  if (rows.length > 4 || rows.length < 2 || rows.length === 3) return 1;
  if (rows.length === 4 && rows.every(option => isImageOnlyOption(option?.content))) return 4;
  const lengthClass = classifyOptionLength(rows);
  const maxLength = Math.max(...rows.map(option => Array.from(visibleOptionText(option?.content)).length));
  if (rows.length === 4) {
    // The desktop has more horizontal room. On a phone, four text columns are
    // only readable when every option is genuinely brief (for example a
    // number, symbol or short unit); longer options use two rows instead.
    if (maxLength <= 6) return 4;
    if (lengthClass !== 'long') return 2;
    return 1;
  }
  if (rows.length === 2 && lengthClass !== 'long') return 2;
  return 1;
}

const LATEX_SYMBOLS = Object.freeze({
  alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', epsilon: '\u03b5', varepsilon: '\u03f5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8', vartheta: '\u03d1',
  iota: '\u03b9', kappa: '\u03ba', lambda: '\u03bb', mu: '\u03bc', nu: '\u03bd', xi: '\u03be', omicron: '\u03bf', pi: '\u03c0', varpi: '\u03d6', rho: '\u03c1', varrho: '\u03f1',
  sigma: '\u03c3', varsigma: '\u03c2', tau: '\u03c4', upsilon: '\u03c5', phi: '\u03c6', varphi: '\u03d5', chi: '\u03c7', psi: '\u03c8', omega: '\u03c9',
  Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039b', Xi: '\u039e', Pi: '\u03a0', Sigma: '\u03a3', Upsilon: '\u03a5', Phi: '\u03a6', Psi: '\u03a8', Omega: '\u03a9',
  times: '\u00d7', cdot: '\u00b7', div: '\u00f7', pm: '\u00b1', mp: '\u2213', le: '\u2264', leq: '\u2264', ge: '\u2265', geq: '\u2265',
  neq: '\u2260', ne: '\u2260', approx: '\u2248', sim: '\u223c', simeq: '\u2243', equiv: '\u2261', propto: '\u221d', infty: '\u221e', degree: '\u00b0',
  sum: '\u2211', prod: '\u220f', int: '\u222b', partial: '\u2202', nabla: '\u2207', sqrt: '\u221a',
  rightarrow: '\u2192', to: '\u2192', leftarrow: '\u2190', leftrightarrow: '\u2194', Rightarrow: '\u21d2', Leftarrow: '\u21d0',
  parallel: '\u2225', perp: '\u22a5', angle: '\u2220', because: '\u2235', therefore: '\u2234', langle: '\u27e8', rangle: '\u27e9',
  in: '\u2208', notin: '\u2209', ni: '\u220b', subset: '\u2282', subseteq: '\u2286', supset: '\u2283', supseteq: '\u2287',
  cup: '\u222a', cap: '\u2229', emptyset: '\u2205', varnothing: '\u2205', cdots: '\u22ef', ldots: '\u2026', dots: '\u2026',
});

const BARE_LATEX_COMMANDS = Object.freeze([
  ...Object.keys(LATEX_SYMBOLS),
  'vec', 'overrightarrow', 'overleftarrow',
  'overline', 'bar', 'underline', 'hat', 'widehat', 'tilde', 'widetilde', 'dot', 'ddot',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp', 'lim', 'max', 'min',
].sort((left, right) => right.length - left.length));

const BARE_LATEX_PATTERN = new RegExp(
  `\\\\(?:${BARE_LATEX_COMMANDS.join('|')})(?![A-Za-z])(?:\\s*(?:\\{[^{}\\r\\n]*\\}|\\[[^\\]\\r\\n]*\\]))*`,
  'g',
);

function readLatexGroup(source, start) {
  let index = start;
  while (/\s/.test(source[index] || '')) index += 1;
  if (source[index] !== '{') {
    if (index >= source.length) return { value: '', next: index };
    if (source[index] === '\\') {
      const command = source.slice(index).match(/^\\(?:[A-Za-z]+|.)/);
      const value = command?.[0] || source[index];
      return { value, next: index + value.length };
    }
    return { value: source[index], next: index + 1 };
  }
  let depth = 1;
  let cursor = index + 1;
  for (; cursor < source.length && depth > 0; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
  }
  if (depth !== 0) return { value: source.slice(index + 1), next: source.length };
  return { value: source.slice(index + 1, cursor - 1), next: cursor };
}

function splitLatexEnvironmentRows(value) {
  const rows = [];
  let current = '';
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (character === '\\' && value[index + 1] === '\\' && braceDepth === 0) {
      rows.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += character;
  }
  rows.push(current);
  return rows.map(row => row.trim()).filter(Boolean);
}

function splitLatexEnvironmentCells(value) {
  const cells = [];
  let current = '';
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (character === '&' && braceDepth === 0 && value[index - 1] !== '\\') {
      cells.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells;
}

function renderLatexEnvironment(environment, body, depth) {
  const rows = splitLatexEnvironmentRows(body).map(row => splitLatexEnvironmentCells(row));
  const rowHtml = rows.map(cells => `<tr>${cells.map(cell => `<td>${renderLatex(cell, depth + 1)}</td>`).join('')}</tr>`).join('');
  if (environment === 'cases') {
    return `<span class="question-formula-cases"><span class="question-formula-cases-brace">&#123;</span><table><tbody>${rowHtml}</tbody></table></span>`;
  }
  const delimiters = {
    matrix: ['', ''],
    pmatrix: ['(', ')'],
    bmatrix: ['[', ']'],
    Bmatrix: ['&#123;', '&#125;'],
    vmatrix: ['|', '|'],
    Vmatrix: ['\u2016', '\u2016'],
  };
  const pair = delimiters[environment];
  if (!pair) return renderLatex(body, depth + 1);
  return `<span class="question-formula-matrix-wrap"><span class="question-formula-matrix-delimiter">${pair[0]}</span><table class="question-formula-matrix"><tbody>${rowHtml}</tbody></table><span class="question-formula-matrix-delimiter">${pair[1]}</span></span>`;
}

function renderLatex(value, depth = 0) {
  if (depth > MAX_RENDER_DEPTH) return '';
  const source = String(value || '').trim().replace(/^\$+|\$+$/g, '');
  let html = '';
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '^' || character === '_') {
      const group = readLatexGroup(source, index + 1);
      const tag = character === '^' ? 'sup' : 'sub';
      html += `<${tag}>${renderLatex(group.value, depth + 1)}</${tag}>`;
      index = Math.max(group.next, index + 1);
      continue;
    }
    if (character === '{') {
      const group = readLatexGroup(source, index);
      html += renderLatex(group.value, depth + 1);
      index = group.next;
      continue;
    }
    if (character === '}') {
      index += 1;
      continue;
    }
    if (character !== '\\') {
      html += escapeHtml(character);
      index += 1;
      continue;
    }
    const commandMatch = source.slice(index + 1).match(/^([A-Za-z]+|.)/);
    if (!commandMatch) {
      index += 1;
      continue;
    }
    const command = commandMatch[1];
    index += 1 + command.length;
    if (command === 'begin') {
      const environmentGroup = readLatexGroup(source, index);
      const environment = String(environmentGroup.value || '').trim();
      const endToken = `\\end{${environment}}`;
      const endIndex = environment ? source.indexOf(endToken, environmentGroup.next) : -1;
      if (endIndex !== -1) {
        html += renderLatexEnvironment(environment, source.slice(environmentGroup.next, endIndex), depth + 1);
        index = endIndex + endToken.length;
      } else {
        html += escapeHtml(environment);
        index = environmentGroup.next;
      }
      continue;
    }
    if (command === 'end') {
      const environmentGroup = readLatexGroup(source, index);
      index = environmentGroup.next;
      continue;
    }
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
      const numerator = readLatexGroup(source, index);
      const denominator = readLatexGroup(source, numerator.next);
      html += `<span class="question-formula-fraction"><span class="question-formula-numerator">${renderLatex(numerator.value, depth + 1)}</span><span class="question-formula-denominator">${renderLatex(denominator.value, depth + 1)}</span></span>`;
      index = denominator.next;
      continue;
    }
    if (command === 'sqrt') {
      let degree = null;
      while (/\s/.test(source[index] || '')) index += 1;
      if (source[index] === '[') {
        const end = source.indexOf(']', index + 1);
        if (end !== -1) {
          degree = source.slice(index + 1, end);
          index = end + 1;
        }
      }
      const radicand = readLatexGroup(source, index);
      html += `${degree ? `<sup>${renderLatex(degree, depth + 1)}</sup>` : ''}\u221a<span class="question-formula-radicand">${renderLatex(radicand.value, depth + 1)}</span>`;
      index = radicand.next;
      continue;
    }
    if (['vec', 'overrightarrow', 'overleftarrow'].includes(command)) {
      const group = readLatexGroup(source, index);
      const arrow = command === 'overleftarrow' ? '\u20d6' : '\u20d7';
      html += `<span class="question-formula-vector">${renderLatex(group.value, depth + 1)}${arrow}</span>`;
      index = group.next;
      continue;
    }
    if (['overline', 'bar', 'underline'].includes(command)) {
      const group = readLatexGroup(source, index);
      const className = command === 'underline' ? 'question-formula-underline' : 'question-formula-overline';
      html += `<span class="${className}">${renderLatex(group.value, depth + 1)}</span>`;
      index = group.next;
      continue;
    }
    if (['hat', 'widehat', 'tilde', 'widetilde', 'dot', 'ddot'].includes(command)) {
      const group = readLatexGroup(source, index);
      const marks = { hat: '\u0302', widehat: '\u0302', tilde: '\u0303', widetilde: '\u0303', dot: '\u0307', ddot: '\u0308' };
      html += `<span class="question-formula-accent">${renderLatex(group.value, depth + 1)}${marks[command]}</span>`;
      index = group.next;
      continue;
    }
    if (['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp', 'lim', 'max', 'min'].includes(command)) {
      html += `<span class="question-formula-function">${command}</span>`;
      continue;
    }
    if (['text', 'textrm', 'mathrm', 'operatorname', 'mathbf', 'boldsymbol', 'mathit'].includes(command)) {
      const group = readLatexGroup(source, index);
      const content = renderLatex(group.value, depth + 1);
      html += ['mathbf', 'boldsymbol'].includes(command) ? `<strong>${content}</strong>` : (command === 'mathit' ? `<em>${content}</em>` : content);
      index = group.next;
      continue;
    }
    if (['left', 'right'].includes(command)) continue;
    if ([',', ';', ':', '!', 'quad', 'qquad', 'enspace'].includes(command)) {
      html += ' ';
      continue;
    }
    if (command === '\\') {
      html += '<br />';
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, command)) {
      html += LATEX_SYMBOLS[command];
      continue;
    }
    // Preserve unsupported commands as readable text instead of silently losing content.
    html += `<span class="question-formula-unsupported">${escapeHtml(command)}</span>`;
  }
  return html;
}

function safeWebHref(value) {
  const href = String(value || '').trim();
  return /^(?:https?:\/\/|\/(?!\/)|#[A-Za-z0-9_-]+$)/i.test(href) ? href : '';
}

function applyMarks(html, marks) {
  let result = html;
  for (const mark of Array.isArray(marks) ? marks : []) {
    const type = String(mark?.type || '');
    const attrs = mark?.attrs && typeof mark.attrs === 'object' ? mark.attrs : {};
    if (type === 'bold') result = `<strong>${result}</strong>`;
    else if (type === 'italic') result = `<em>${result}</em>`;
    else if (type === 'underline') result = `<u>${result}</u>`;
    else if (type === 'strike') result = `<s>${result}</s>`;
    else if (type === 'code') result = `<code>${result}</code>`;
    else if (type === 'subscript') result = `<sub>${result}</sub>`;
    else if (type === 'superscript') result = `<sup>${result}</sup>`;
    else if (type === 'highlight' && (!attrs.color || SAFE_COLOR.test(String(attrs.color)))) {
      result = `<span style="background-color:${escapeHtml(attrs.color || '#fff3a3')}">${result}</span>`;
    } else if (type === 'fontFamily' && SAFE_FONT_FAMILY.has(String(attrs.fontFamily))) {
      result = `<span style="font-family:${escapeHtml(attrs.fontFamily)}">${result}</span>`;
    } else if (type === 'fontSize' && SAFE_FONT_SIZE.test(String(attrs.fontSize))) {
      result = `<span style="font-size:${escapeHtml(attrs.fontSize)}">${result}</span>`;
    } else if (type === 'textStyle') {
      const styles = [];
      if (SAFE_COLOR.test(String(attrs.color || ''))) styles.push(`color:${attrs.color}`);
      if (SAFE_FONT_FAMILY.has(String(attrs.fontFamily))) styles.push(`font-family:${attrs.fontFamily}`);
      if (SAFE_FONT_SIZE.test(String(attrs.fontSize || ''))) styles.push(`font-size:${attrs.fontSize}`);
      if (styles.length) result = `<span style="${escapeHtml(styles.join(';'))}">${result}</span>`;
    } else if (type === 'link') {
      const href = safeWebHref(attrs.href);
      if (href) result = `<a href="${escapeHtml(href)}">${result}</a>`;
    }
  }
  return result;
}

function blockStyle(attrs) {
  const styles = [];
  if (SAFE_TEXT_ALIGN.has(String(attrs?.textAlign))) styles.push(`text-align:${attrs.textAlign}`);
  if (SAFE_LINE_HEIGHT.has(String(attrs?.lineHeight))) styles.push(`line-height:${attrs.lineHeight}`);
  if (Number.isInteger(attrs?.indent) && attrs.indent > 0 && attrs.indent <= 8) styles.push(`padding-left:${attrs.indent * 2}em`);
  return styles.length ? ` style="${escapeHtml(styles.join(';'))}"` : '';
}

function renderStructuredNode(node, state, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_RENDER_DEPTH || state.ancestors.has(node)) return '';
  state.ancestors.add(node);
  const type = String(node.type || '');
  let html = '';
  if (type === 'text') {
    html = applyMarks(escapeHtml(node.text), node.marks);
  } else if (type === 'formula' || type === 'formulaBlock') {
    const formula = renderLatex(node.attrs?.canonicalLatex || node.canonicalLatex || node.latex);
    html = type === 'formulaBlock' || node.attrs?.displayMode === 'block'
      ? `<div class="question-formula question-formula-block">${formula}</div>`
      : `<span class="question-formula">${formula}</span>`;
  } else if (type === 'image') {
    const assetKey = String(node.attrs?.assetKey || '');
    if (SAFE_ASSET_KEY.test(assetKey)) {
      const alt = escapeHtml(node.attrs?.alt || '');
      html = `<img src="question-asset://${escapeHtml(assetKey)}" alt="${alt}" />`;
    }
  } else if (type === 'hardBreak') {
    html = '<br />';
  } else if (type === 'horizontalRule') {
    html = '<hr />';
  } else {
    const children = (Array.isArray(node.content) ? node.content : [])
      .map(child => renderStructuredNode(child, state, depth + 1)).join('');
    const style = blockStyle(node.attrs);
    if (type === 'doc') html = children;
    else if (type === 'paragraph') html = `<p${style}>${children}</p>`;
    else if (type === 'heading') {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2));
      html = `<h${level}${style}>${children}</h${level}>`;
    } else if (type === 'bulletList') html = `<ul>${children}</ul>`;
    else if (type === 'orderedList') {
      const start = Number.isInteger(node.attrs?.start) && node.attrs.start > 1 ? ` start="${node.attrs.start}"` : '';
      html = `<ol${start}>${children}</ol>`;
    } else if (type === 'listItem') html = `<li>${children}</li>`;
    else if (type === 'blockquote') html = `<blockquote>${children}</blockquote>`;
    else if (type === 'codeBlock') html = `<pre><code>${children}</code></pre>`;
    else html = children;
  }
  state.ancestors.delete(node);
  return html;
}

function structuredDocToHtml(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'doc') return '';
  return renderStructuredNode(value, { ancestors: new Set() });
}

function validRichSections(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.version === 1 && value.type === 'question-document'
    && value.sections && typeof value.sections === 'object' && !Array.isArray(value.sections)
    ? value.sections : null;
}

function decodeLegacyEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_all, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return named[entity.toLowerCase()] || '';
  });
}

function decodeLegacyLatexAttribute(value) {
  const decoded = decodeLegacyEntities(value);
  if (!/%[0-9a-f]{2}/i.test(decoded)) return decoded;
  try { return decodeURIComponent(decoded); } catch { return decoded; }
}

function renderLegacyRichText(value) {
  const formulaTokens = [];
  const protectFormula = (latex, block = false) => {
    const rendered = renderLatex(decodeLegacyEntities(latex));
    const html = block
      ? `<div class="question-formula question-formula-block">${rendered}</div>`
      : `<span class="question-formula">${rendered}</span>`;
    const token = `@@QUESTION_FORMULA_${formulaTokens.length}@@`;
    formulaTokens.push(html);
    return token;
  };

  let source = String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--?[\s\S]*?-->/g, '');
  source = source
    .replace(/<span\b[^>]*data-latex=["']([^"']+)["'][^>]*>\s*<\/span>/gi, (_match, latex) => protectFormula(decodeLegacyLatexAttribute(latex)))
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, latex) => protectFormula(latex, true))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, latex) => protectFormula(latex, true))
    .replace(/\\\(([^\r\n]*?)\\\)/g, (_match, latex) => protectFormula(latex))
    .replace(/\$([^$\r\n]+?)\$/g, (_match, latex) => protectFormula(latex))
    .replace(/\\(?:d?frac|tfrac)\{([^{}]*)\}\{([^{}]*)\}/g, (_match, numerator, denominator) => protectFormula(`\\frac{${numerator}}{${denominator}}`))
    .replace(/\\sqrt\{([^{}]*)\}/g, (_match, radicand) => protectFormula(`\\sqrt{${radicand}}`));

  const tagTokens = [];
  const protectTag = html => {
    const token = `@@QUESTION_HTML_${tagTokens.length}@@`;
    tagTokens.push(html);
    return token;
  };
  source = source.replace(/<img\b([^>]*)>/gi, (_match, attrs) => {
    const srcMatch = String(attrs || '').match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    const assetMatch = String(srcMatch?.[2] || '').match(/^question-asset:\/\/([0-9a-f]{64})$/i);
    if (!assetMatch) return '';
    const altMatch = String(attrs || '').match(/\balt\s*=\s*(["'])(.*?)\1/i);
    return protectTag(`<img src="question-asset://${assetMatch[1]}" alt="${escapeHtml(altMatch?.[2] || '')}" />`);
  });
  source = source.replace(/<\s*(\/?)\s*(p|br|strong|b|em|i|u|s|sub|sup|ul|ol|li|blockquote|code|pre|hr|table|thead|tbody|tr|td|th)\b[^>]*>/gi, (_match, closing, rawName) => {
    const name = String(rawName).toLowerCase();
    if (['br', 'hr'].includes(name)) return protectTag(`<${name} />`);
    return protectTag(closing ? `</${name}>` : `<${name}>`);
  });
  source = source
    .replace(/<[^>]*>/g, '')
    .replace(BARE_LATEX_PATTERN, match => protectFormula(match));
  source = escapeHtml(decodeLegacyEntities(source)).replace(/\r\n?|\n/g, '<br />');
  source = source.replace(/@@QUESTION_HTML_(\d+)@@/g, (_match, index) => tagTokens[Number(index)] || '');
  return source.replace(/@@QUESTION_FORMULA_(\d+)@@/g, (_match, index) => formulaTokens[Number(index)] || '');
}

function hasRenderableQuestionContent(value) {
  const source = String(value || '');
  if (/<img\b/i.test(source)) return true;
  const visibleText = decodeLegacyEntities(source.replace(/<[^>]*>/g, ''))
    .replace(/[\s\u200b-\u200d\ufeff]/gi, '');
  return Boolean(visibleText);
}

function hasQuestionAnswerContent(display) {
  if (!display || typeof display !== 'object') return false;
  return hasRenderableQuestionContent(display.answer)
    || hasRenderableQuestionContent(display.explanation)
    || (Array.isArray(display.subQuestions)
      && display.subQuestions.some(subQuestion => hasRenderableQuestionContent(subQuestion?.answer)));
}

function legacyDisplay(question) {
  const options = normalizeOptions(question?.options).map(option => ({
    ...option,
    content: renderLegacyRichText(option.content),
  }));
  return {
    stem: renderLegacyRichText(question?.stemPreview ?? question?.stem ?? ''),
    options,
    subQuestions: [],
    answer: renderLegacyRichText(question?.answer ?? ''),
    explanation: renderLegacyRichText(question?.explanation ?? question?.analysis ?? ''),
    structured: false,
  };
}

function createQuestionDisplay(question) {
  const fallback = legacyDisplay(question || {});
  const sections = validRichSections(question?.richContent ?? question?.rich_content);
  if (!sections) return fallback;

  const structuredOptions = (Array.isArray(sections.options) ? sections.options : [])
    .map((option, index) => ({
      label: normalizeOptionLabel(option?.label, index),
      content: structuredDocToHtml(option?.content),
    }))
    .filter(option => option.content);
  const subQuestions = (Array.isArray(sections.subQuestions) ? sections.subQuestions : [])
    .map((subQuestion, index) => ({
      label: String(subQuestion?.label || `(${index + 1})`),
      content: structuredDocToHtml(subQuestion?.content),
      answer: structuredDocToHtml(subQuestion?.answer),
    }))
    .filter(subQuestion => subQuestion.label || subQuestion.content || subQuestion.answer);

  return {
    stem: structuredDocToHtml(sections.stem) || fallback.stem,
    options: structuredOptions.length ? splitPackedOptions(structuredOptions) : fallback.options,
    subQuestions,
    answer: structuredDocToHtml(sections.answer) || fallback.answer,
    explanation: structuredDocToHtml(sections.analysis) || fallback.explanation,
    structured: true,
  };
}

module.exports = {
  classifyOptionLength,
  columnsForOptions,
  createQuestionDisplay,
  hasQuestionAnswerContent,
  normalizeOptionLabel,
  normalizeOptions,
  renderLatex,
  resolveQuestionAssetRefs,
  renderLegacyRichText,
  structuredDocToHtml,
};
