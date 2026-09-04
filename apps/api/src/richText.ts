import sanitizeHtml from 'sanitize-html';

const RICH_TEXT_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li'];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Rich text fields are intentionally a small HTML subset. Plain text from
 * older records is escaped and wrapped before sanitization so it cannot
 * become markup accidentally.
 */
export function sanitizeRichText(value: string | undefined) {
  const source = typeof value === 'string' ? value : '';
  if (!source.trim()) return '';
  const containsSupportedMarkup = /<\/?(?:p|br|strong|b|em|i|ul|ol|li)(?:\s|>)/i.test(source);
  const normalized = containsSupportedMarkup
    ? source
    : `<p>${escapeHtml(source).replace(/\r?\n/g, '<br />')}</p>`;
  return sanitizeHtml(normalized, {
    allowedTags: RICH_TEXT_TAGS,
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}

export function sanitizeTodoNotes(value: string | undefined) {
  return sanitizeRichText(value);
}

export function richTextToPlainText(value: string | undefined) {
  return sanitizeRichText(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
