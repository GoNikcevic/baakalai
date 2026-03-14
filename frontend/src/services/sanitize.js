/**
 * Simple HTML sanitizer — allows only safe formatting tags.
 * Strips all attributes except class and style on safe tags.
 */

const SAFE_TAGS = new Set([
  'strong', 'b', 'em', 'i', 'u', 'br', 'span', 'p', 'div',
  'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote',
]);

/**
 * Sanitize HTML string, keeping only safe tags.
 * @param {string} html - Raw HTML string
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';

  // Remove script tags and event handlers
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '');

  // Remove unsafe tags but keep their content
  clean = clean.replace(/<\/?(\w+)([^>]*)>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!SAFE_TAGS.has(lower)) return '';

    // For opening tags, strip all attributes except class, style, href (for links)
    if (!match.startsWith('</')) {
      const safeAttrs = [];
      const classMatch = attrs.match(/class\s*=\s*"([^"]*)"/i);
      if (classMatch) safeAttrs.push(`class="${classMatch[1]}"`);
      const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
      if (styleMatch) safeAttrs.push(`style="${styleMatch[1]}"`);
      if (lower === 'a') {
        const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"/i);
        if (hrefMatch && !hrefMatch[1].toLowerCase().startsWith('javascript:')) {
          safeAttrs.push(`href="${hrefMatch[1]}" rel="noopener noreferrer" target="_blank"`);
        }
      }
      return `<${lower}${safeAttrs.length ? ' ' + safeAttrs.join(' ') : ''}>`;
    }

    return `</${lower}>`;
  });

  return clean;
}
