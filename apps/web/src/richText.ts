const TODO_NOTE_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI']);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeWithoutDom(value: string) {
  let clean = value.replace(/<\s*(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  clean = clean.replace(/<\s*(\/?)\s*([a-z0-9]+)(?:\s[^>]*)?>/gi, (_match, closing: string, tag: string) => {
    const normalizedTag = tag.toUpperCase();
    return TODO_NOTE_TAGS.has(normalizedTag) ? `<${closing ? '/' : ''}${tag.toLowerCase()}>` : '';
  });
  return clean;
}

/** Keep the local POC renderer subject to the same small formatting subset as the API. */
export function sanitizeTodoNotes(value: string | undefined) {
  const source = typeof value === 'string' ? value : '';
  if (!source.trim()) return '';
  const containsSupportedMarkup = /<\/?(?:p|br|strong|b|em|i|ul|ol|li)(?:\s|>)/i.test(source);
  const normalized = containsSupportedMarkup
    ? source
    : `<p>${escapeHtml(source).replace(/\r?\n/g, '<br />')}</p>`;
  if (typeof DOMParser === 'undefined') return sanitizeWithoutDom(normalized);
  const document = new DOMParser().parseFromString(normalized, 'text/html');
  const clean = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (!TODO_NOTE_TAGS.has(element.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(element.tagName)) {
            child.remove();
            continue;
          }
          while (element.firstChild) node.insertBefore(element.firstChild, element);
          child.remove();
          continue;
        }
        for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
        clean(element);
      }
    }
  };
  clean(document.body);
  return document.body.innerHTML;
}
