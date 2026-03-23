/**
 * Strip HTML tags and dangerous content from user input strings
 */
function sanitizeText(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/javascript:/gi, '') // Strip JS protocol
    .replace(/on\w+\s*=/gi, '') // Strip event handlers
    .trim();
}

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
