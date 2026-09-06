/**
 * Safe JSON extraction from Claude API responses.
 * Handles both result.parsed and result.raw regex fallback with proper error handling.
 */

function safeParseClaudeJSON(result, markerKey) {
  if (result.parsed) return result.parsed;

  const content = result.raw || '';
  try {
    const pattern = markerKey
      ? new RegExp(`\\{[\\s\\S]*"${markerKey}"[\\s\\S]*\\}`)
      : /\{[\s\S]*\}/;
    const m = content.match(pattern);
    if (m) return JSON.parse(m[0]);
  } catch {
    // malformed JSON — return null instead of crashing
  }
  return null;
}

function safeParseClaudeArray(result) {
  if (Array.isArray(result.parsed)) return result.parsed;

  const content = result.raw || '';
  try {
    const m = content.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch {
    // malformed JSON — return null
  }
  return null;
}

module.exports = { safeParseClaudeJSON, safeParseClaudeArray };
