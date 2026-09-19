'use strict';

// Keep the desktop's existing rules. The parity test imports the actual desktop
// utility, so changes there cannot silently diverge from exported papers.
function richOptionText(value) {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'text') return String(value.text || '');
  if (value.type === 'formula' || value.type === 'formulaBlock') return String(value.attrs?.canonicalLatex || '[\u516c\u5f0f\u5f85\u8865\u5168]');
  if (value.type === 'image') return '[image]';
  return (Array.isArray(value.content) ? value.content : []).map(richOptionText).join(' ');
}

function paperOptionColumns(options) {
  if (!Array.isArray(options) || ![2, 4].includes(options.length)) return 1;
  const contents = options.map(option => {
    const content = typeof option === 'string' ? option.replace(/^\s*[A-G][.\uff0e\u3001\u3002:\uff1a)\uff09]\s*/i, '') : option?.content ?? option?.text ?? '';
    return typeof content === 'object' ? richOptionText(content) : String(content);
  });
  const imageOnly = content => /<img\b/i.test(content) && content.replace(/<img\b[^>]*>/gi, '').replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').trim() === '';
  if (contents.length === 4 && contents.every(imageOnly)) return 4;
  const length = Math.max(...contents.map(content => Array.from(content
    .replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos);/gi, 'x').replace(/&#x[0-9a-f]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ').trim()).length));
  return length > 28 ? 1 : contents.length === 4 && length <= 12 ? 4 : 2;
}

module.exports = { paperOptionColumns };
