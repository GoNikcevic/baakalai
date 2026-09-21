/* ═══════════════════════════════════════════════════
   Editor Helper Functions
   ═══════════════════════════════════════════════════ */

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Highlight {{varName}} in text by wrapping with styled spans */
export function highlightVars(text) {
  if (!text) return '';
  return text.replace(
    /\{\{(\w+)\}\}/g,
    '<span class="var">{{$1}}</span>'
  );
}

/** Strip HTML back to plain text, preserving {{variables}} */
export function stripEditorHtml(html) {
  if (!html) return '';
  // Convert <br> to newlines
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  // Convert <span class="var">{{x}}</span> back to {{x}}
  text = text.replace(/<span[^>]*class="var"[^>]*>(.*?)<\/span>/gi, '$1');
  // Remove any remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  // Decode HTML entities
  const tmp = document.createElement('textarea');
  tmp.innerHTML = text;
  return tmp.value;
}

/** Get plain text length from HTML */
export function getPlainTextLength(html) {
  if (!html) return 0;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent.length;
}

/* ─── Channel metadata ─── */

export const CH_ICONS = { email: '✉️', linkedin: '💼', multi: '📧' };
export const CH_BGS = { email: 'var(--blue-bg)', linkedin: 'rgba(151,117,250,0.15)', multi: 'var(--warning-bg)' };
export const CH_LABELS = { email: 'Email', linkedin: 'LinkedIn', multi: 'Multi-canal' };

/* ─── Sync campaigns from AppContext to editor format ─── */

export function syncCampaignsFromContext(contextCampaigns) {
  const result = {};
  for (const [id, c] of Object.entries(contextCampaigns)) {
    const ch = c.channel || 'email';
    const seq = c.sequence || [];

    result[id] = {
      _backendId: c._backendId || id,
      name: c.name,
      icon: CH_ICONS[ch] || '✉️',
      iconBg: CH_BGS[ch] || 'var(--blue-bg)',
      channel: CH_LABELS[ch] || 'Email',
      meta: `${seq.length} touchpoints · ${c.status === 'prep' ? 'En preparation' : 'Iteration ' + (c.iteration || 1)}`,
      status: c.status || 'prep',
      params: [
        { l: 'Canal', v: CH_LABELS[ch] || 'Email' },
        { l: 'Cible', v: [c.position, c.sectorShort].filter(Boolean).join(' · ') },
        c.size ? { l: 'Taille', v: c.size } : null,
        c.angle ? { l: 'Angle', v: c.angle } : null,
        { l: 'Ton', v: c.tone || 'Pro decontracte' },
        { l: 'Tutoiement', v: c.formality || 'Vous' },
        c.length ? { l: 'Longueur', v: c.length } : null,
        c.cta ? { l: 'CTA', v: c.cta } : null,
      ].filter(Boolean),
      aiBar: null,
      touchpoints: seq.map((s) => ({
        id: s.id,
        _backendId: s._backendId,
        type: s.type,
        label: s.label || '',
        timing: s.timing || '',
        subType: s.subType || '',
        subject: s.subject || null,
        body: s.body || '',
        maxChars: s.maxChars || undefined,
        suggestion: null,
      })),
    };
  }
  return result;
}
