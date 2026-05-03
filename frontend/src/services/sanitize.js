/**
 * HTML sanitizer using DOMPurify — allows only safe formatting tags.
 */

import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['strong', 'b', 'em', 'i', 'u', 'br', 'span', 'p', 'div',
    'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote'],
  ALLOWED_ATTR: ['class', 'style', 'href', 'target', 'rel'],
  ADD_ATTR: ['target'],
};

// Force all links to open in new tab
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Sanitize HTML string, keeping only safe tags.
 * @param {string} html - Raw HTML string
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
