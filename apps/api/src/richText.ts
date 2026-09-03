import sanitizeHtml from 'sanitize-html';

const TODO_NOTE_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li'];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * To-Do Notes are intentionally a small HTML subset. Plain text from older
 * records is escaped and wrapped before sanitization so it cannot become
 * markup accidentally.
 */
export function sanitizeTodoNotes(value: string | undefined) {
  const source = typeof value === 'string' ? value : '';
  if (!source.trim()) return '';
  const containsSupportedMarkup = /<\/?(?:p|br|strong|b|em|i|ul|ol|li)(?:\s|>)/i.test(source);
  const normalized = containsSupportedMarkup
    ? source
    : `<p>${escapeHtml(source).replace(/\r?\n/g, '<br />')}</p>`;
  return sanitizeHtml(normalized, {
    allowedTags: TODO_NOTE_TAGS,
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}
