'use strict';

// Lay out prose and already-rendered math together. Math is an indivisible run:
// wrapping it must never replace superscripts/fractions with source-like text.
function layoutInlineRuns({ tokens, maxWidth, size, lineHeight, measureText }) {
  if (![maxWidth, size, lineHeight].every(value => Number.isFinite(value) && value > 0)
    || typeof measureText !== 'function') throw new Error('CLOUD_PAPER_RENDER_LAYOUT_INVALID');
  const lines = [];
  let line = { runs: [], width: 0, height: lineHeight };
  const flush = () => {
    if (line.runs.length) lines.push(line);
    line = { runs: [], width: 0, height: lineHeight };
  };
  const append = run => {
    if (line.runs.length && line.width + run.width > maxWidth + 0.001) flush();
    if (!line.runs.length && run.kind === 'text' && /^\s+$/u.test(run.text)) return;
    line.runs.push(run);
    line.width += run.width;
    line.height = Math.max(line.height, run.height);
  };
  for (const token of tokens) {
    if (token.kind === 'text') {
      // Keep Latin words intact when possible while allowing Chinese wrapping.
      const parts = String(token.text).replace(/\r\n?/g, '\n').match(/[A-Za-z0-9]+(?:[.,:/_-][A-Za-z0-9]+)*|[^\S\n]+|\n|[^\s]/gu) || [];
      for (const text of parts) {
        if (text === '\n') { flush(); continue; }
        const width = measureText(text);
        if (width > maxWidth) {
          for (const character of text) append({kind:'text',text:character,width:measureText(character),height:lineHeight});
        } else append({kind:'text',text,width,height:lineHeight});
      }
    } else if (token.kind === 'formula') {
      const {width, height} = token.media || {};
      if (![width,height].every(value=>Number.isFinite(value)&&value>0)) throw new Error('CLOUD_PAPER_RENDER_FORMULA_INVALID');
      // MathJax intrinsic pixels use a 16px em. PDF text is measured in points.
      const scale = Math.min(size / 16, size * 2 / height, maxWidth / width);
      append({kind:'formula',token,width:width*scale,height:height*scale});
    }
  }
  flush();
  return lines;
}

module.exports = { layoutInlineRuns };
