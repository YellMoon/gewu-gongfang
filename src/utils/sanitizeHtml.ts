const ALLOWED_TAGS = new Set([
  'br', 'span', 'div', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
  'sub', 'sup', 'i', 'b', 'strong', 'em', 'mark', 'img',
]);

const URI_ATTRS = new Set(['src']);
const ALLOWED_ATTRS = new Set([
  'class', 'style', 'src', 'alt', 'width', 'height', 'data-inline-options',
  'data-latex', 'aria-hidden',
]);

function isSafeUri(value: string): boolean {
  const text = value.trim().toLowerCase();
  return text.startsWith('data:image/')
    || text.startsWith('question-asset://')
    || text.startsWith('blob:')
    || text.startsWith('/')
    || text.startsWith('./')
    || text.startsWith('../')
    || text.startsWith('http://')
    || text.startsWith('https://');
}

function cleanStyle(value: string): string {
  return value
    .split(';')
    .map(part => part.trim())
    .filter(part => part && !/expression\s*\(|javascript\s*:|url\s*\(/i.test(part))
    .join('; ');
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return escapeHtml(String(html || ''));
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      const element = child as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tagName)) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
          element.removeAttribute(attr.name);
          continue;
        }
        if (URI_ATTRS.has(name) && !isSafeUri(attr.value)) {
          element.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style') {
          const style = cleanStyle(attr.value);
          if (style) element.setAttribute('style', style);
          else element.removeAttribute('style');
        }
      }
      walk(element);
    }
  };

  walk(root);
  return root.innerHTML;
}
