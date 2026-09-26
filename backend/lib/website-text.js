/**
 * Website text extraction — best-effort, no external dependency (cheerio/jsdom
 * would be overkill for "get readable text off a marketing homepage for an
 * LLM prompt"). Never throws: returns null on any failure so the caller can
 * fall back to "no website content available" instead of failing the whole
 * profile auto-fill.
 */

const TIMEOUT_MS = 8000;
const MAX_CHARS = 8000;

async function fetchWebsiteText(rawUrl) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BaakalaiBot/1.0; +https://baakal.ai)' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await res.text();
    const text = htmlToText(html).slice(0, MAX_CHARS);
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { fetchWebsiteText };
