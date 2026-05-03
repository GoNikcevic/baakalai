/**
 * Sanitize user input strings using DOMPurify (server-side).
 */

const DOMPurify = require('isomorphic-dompurify');

/**
 * Strip all HTML tags from a string.
 */
function sanitizeText(str) {
  if (!str || typeof str !== 'string') return str;
  return DOMPurify.sanitize(str, { ALLOWED_TAGS: [] }).trim();
}

/**
 * Sanitize specific string fields on an object.
 */
function sanitizeObject(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = sanitizeText(result[field]);
    }
  }
  return result;
}

module.exports = { sanitizeText, sanitizeObject };
