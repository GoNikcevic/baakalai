/**
 * Baakalai Content Script : Injected on LinkedIn pages
 *
 * Features:
 * 1. "Add to Baakalai" button on profile pages (with enrichment)
 * 2. CRM badge on profiles already in Baakalai (status + churn)
 * 3. Bulk import from search results
 * 4. Contact panel: notes, emails, campaigns, patterns
 * 5. Quick email action from LinkedIn
 */

const API_BASE = 'https://app.baakal.ai/api';
let _token = null;
let _crmContacts = null; // Cache of LinkedIn slug → CRM status

// ── Init ──

async function init() {
  _token = await getToken();
  if (!_token) return;

  await loadCrmContacts();

  const observer = new MutationObserver(debounce(onPageChange, 500));
  observer.observe(document.body, { childList: true, subtree: true });

  onPageChange();
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ── Token ──

function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get('baakalai_token', (data) => resolve(data.baakalai_token || null));
  });
}

async function apiFetch(path, opts = {}) {
  if (!_token) return null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}`, ...opts.headers },
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Load CRM contacts ──

async function loadCrmContacts() {
  try {
    const data = await apiFetch('/dashboard/opportunities?limit=1000');
    if (!data?.opportunities) return;
    _crmContacts = new Map();
    for (const opp of data.opportunities) {
      if (opp.linkedin_url) {
        const key = normalizeLinkedInUrl(opp.linkedin_url);
        if (key) _crmContacts.set(key, { id: opp.id, status: opp.status, name: opp.name, email: opp.email, churnScore: opp.churn_score });
      }
    }
  } catch { _crmContacts = new Map(); }
}

function normalizeLinkedInUrl(url) {
  const match = url?.match(/linkedin\.com\/in\/([^/?]+)/);
  return match ? match[1].toLowerCase() : null;
}

function getCurrentSlug() {
  return window.location.pathname.match(/\/in\/([^/?]+)/)?.[1]?.toLowerCase() || null;
}

// ── Page Change Handler ──

function onPageChange() {
  const url = window.location.href;

  if (url.includes('/in/')) {
    injectProfileButton();
    injectProfileBadge();
  }
  if (url.includes('/search/') || url.includes('/sales/')) {
    injectSearchButtons();
  }
}

// ── 1. Profile Page: "Add to Baakalai" button (with enrichment) ──

function injectProfileButton() {
  if (document.getElementById('baakalai-add-btn')) return;

  const actionsBar = document.querySelector('.pvs-profile-actions') ||
    document.querySelector('[class*="profile-actions"]') ||
    document.querySelector('.pv-top-card-v2-ctas') ||
    document.querySelector('.pv-top-card__cta-container');

  if (!actionsBar) return;

  const slug = getCurrentSlug();
  const alreadyInCrm = slug && _crmContacts?.has(slug);

  const btn = document.createElement('button');
  btn.id = 'baakalai-add-btn';
  btn.innerHTML = mkBtnContent(alreadyInCrm ? 'View in Baakalai' : 'Add to Baakalai');
  Object.assign(btn.style, {
    padding: '6px 14px', borderRadius: '20px', border: `1px solid ${alreadyInCrm ? '#16A34A' : '#6E57FA'}`,
    background: '#fff', color: alreadyInCrm ? '#16A34A' : '#6E57FA', fontSize: '13px', fontWeight: '600',
    cursor: 'pointer', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    transition: 'all 0.15s', marginLeft: '8px',
  });
  btn.onmouseenter = () => { btn.style.background = alreadyInCrm ? '#16A34A' : '#6E57FA'; btn.style.color = '#fff'; };
  btn.onmouseleave = () => { btn.style.background = '#fff'; btn.style.color = alreadyInCrm ? '#16A34A' : '#6E57FA'; };

  if (alreadyInCrm) {
    btn.onclick = () => toggleContactPanel(slug);
  } else {
    btn.onclick = () => addProfileEnriched(btn);
  }

  actionsBar.appendChild(btn);
}

function mkBtnContent(label) {
  return `<span style="display:flex;align-items:center;gap:6px;">
    <svg width="14" height="14" viewBox="0 0 100 100"><circle cx="50" cy="50" r="13" fill="currentColor"/><line x1="50" y1="50" x2="22" y2="26" stroke="currentColor" stroke-width="5" opacity="0.5"/><circle cx="22" cy="26" r="7" fill="currentColor" opacity="0.5"/></svg>
    ${label}
  </span>`;
}

// ── Enriched profile extraction ──

function extractProfileData() {
  const name = document.querySelector('h1')?.textContent?.trim() || '';
  const title = document.querySelector('[data-generated-suggestion-target*="headline"]')?.textContent?.trim() ||
    document.querySelector('.text-body-medium')?.textContent?.trim() || '';
  const company = document.querySelector('[aria-label*="Current company"]')?.textContent?.trim() ||
    document.querySelector('.pv-text-details__right-panel-item-text')?.textContent?.trim() || '';
  const publicId = getCurrentSlug() || '';
  const location = document.querySelector('.text-body-small.inline.t-black--light.break-words')?.textContent?.trim() || '';

  // Try to extract email from contact info (if visible)
  const contactSection = document.querySelector('.pv-contact-info');
  const email = contactSection?.querySelector('a[href^="mailto:"]')?.href?.replace('mailto:', '') || '';
  const phone = contactSection?.querySelector('.t-14.t-black.t-normal')?.textContent?.trim() || '';

  // Company size from about section
  const companySize = document.querySelector('[class*="company-size"]')?.textContent?.trim() || '';

  // Sector from experience
  const sector = document.querySelector('[class*="industry"]')?.textContent?.trim() || '';

  return {
    name, title, company, companySize, email, phone, sector, location,
    linkedinUrl: publicId ? `https://www.linkedin.com/in/${publicId}` : window.location.href,
  };
}

async function addProfileEnriched(btn) {
  btn.disabled = true;
  btn.innerHTML = '<span style="color:#6E57FA">Adding...</span>';

  try {
    const profile = extractProfileData();
    if (!profile.name) throw new Error('Could not extract profile');

    const data = await apiFetch('/ext/contact/enrich', {
      method: 'POST',
      body: JSON.stringify(profile),
    });

    if (data?.contact) {
      btn.innerHTML = '<span style="color:#16A34A">✅ Added!</span>';
      btn.style.borderColor = '#16A34A';
      const slug = normalizeLinkedInUrl(profile.linkedinUrl);
      if (slug && _crmContacts) {
        _crmContacts.set(slug, { id: data.contact.id, status: 'new', name: profile.name, email: profile.email });
      }
      injectProfileBadge();
    } else {
      throw new Error('Failed');
    }
  } catch (err) {
    btn.innerHTML = '<span style="color:#DC2626">Failed</span>';
    setTimeout(() => { btn.innerHTML = mkBtnContent('Add to Baakalai'); btn.disabled = false; btn.style.borderColor = '#6E57FA'; }, 2000);
  }
}

// ── 2. Profile Badge (CRM status) ──

function injectProfileBadge() {
  if (!_crmContacts) return;
  const existing = document.getElementById('baakalai-badge');
  if (existing) existing.remove();

  const slug = getCurrentSlug();
  if (!slug) return;

  const contact = _crmContacts.get(slug);
  if (!contact) return;

  const colors = {
    won: { bg: '#DCFCE7', border: '#16A34A', text: '#16A34A', label: 'Client' },
    new: { bg: '#EDE9FE', border: '#6E57FA', text: '#6E57FA', label: 'In CRM' },
    imported: { bg: '#DBEAFE', border: '#2563EB', text: '#2563EB', label: 'Imported' },
    interested: { bg: '#FEF3C7', border: '#D97706', text: '#D97706', label: 'Interested' },
    meeting: { bg: '#FEF3C7', border: '#D97706', text: '#D97706', label: 'Meeting' },
    lost: { bg: '#FEE2E2', border: '#DC2626', text: '#DC2626', label: 'Lost' },
  };
  const c = colors[contact.status] || colors.new;

  const nameEl = document.querySelector('h1');
  if (!nameEl) return;

  const badge = document.createElement('span');
  badge.id = 'baakalai-badge';
  badge.textContent = `baakalai · ${c.label}${contact.churnScore >= 50 ? ` · Churn ${contact.churnScore}%` : ''}`;
  badge.style.cursor = 'pointer';
  Object.assign(badge.style, {
    display: 'inline-block', marginLeft: '10px', padding: '3px 10px',
    borderRadius: '12px', fontSize: '11px', fontWeight: '600',
    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    verticalAlign: 'middle', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    transition: 'all 0.15s',
  });
  badge.onclick = () => toggleContactPanel(slug);
  badge.title = 'Click to view details';

  nameEl.parentElement.appendChild(badge);
}

// ── 3. Bulk Import (unchanged logic, uses enrichment endpoint) ──

function injectSearchButtons() {
  if (document.getElementById('baakalai-bulk-bar')) return;

  const searchContainer = document.querySelector('.search-results-container') ||
    document.querySelector('[class*="search-results"]') ||
    document.querySelector('.reusable-search__entity-result-list');

  if (!searchContainer) return;

  const bar = document.createElement('div');
  bar.id = 'baakalai-bulk-bar';
  Object.assign(bar.style, {
    position: 'sticky', top: '60px', zIndex: '100',
    background: '#fff', borderBottom: '2px solid #6E57FA',
    padding: '8px 16px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  });
  bar.innerHTML = `
    <span style="font-size:13px;font-weight:600;color:#6E57FA;display:flex;align-items:center;gap:6px;">
      <svg width="14" height="14" viewBox="0 0 100 100"><circle cx="50" cy="50" r="13" fill="#6E57FA"/></svg>
      Baakalai
    </span>
    <button id="baakalai-import-btn" style="padding:6px 14px;border-radius:8px;border:1px solid #6E57FA;background:#6E57FA;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">
      Import visible profiles
    </button>
    <span id="baakalai-import-status" style="font-size:11px;color:#737373;"></span>
  `;

  searchContainer.parentElement.insertBefore(bar, searchContainer);
  document.getElementById('baakalai-import-btn').onclick = importSearchResults;
}

async function importSearchResults() {
  const btn = document.getElementById('baakalai-import-btn');
  const status = document.getElementById('baakalai-import-status');
  btn.disabled = true;
  btn.textContent = 'Importing...';

  const cards = document.querySelectorAll('.reusable-search__result-container, [class*="entity-result"]');
  let imported = 0, skipped = 0;

  // Rate limit: max 25 per batch, 500ms delay between each to mimic human behavior
  const MAX_PER_BATCH = 25;
  let count = 0;

  for (const card of cards) {
    if (count >= MAX_PER_BATCH) { skipped += cards.length - count; break; }
    try {
      const linkEl = card.querySelector('a[href*="/in/"]');
      const nameEl = card.querySelector('.entity-result__title-text a span span, [class*="entity-result__title"] span');
      const titleEl = card.querySelector('.entity-result__primary-subtitle, [class*="primary-subtitle"]');
      const companyEl = card.querySelector('.entity-result__secondary-subtitle, [class*="secondary-subtitle"]');

      const publicId = linkEl?.href?.match(/\/in\/([^/?]+)/)?.[1];
      const name = nameEl?.textContent?.trim();
      if (!publicId || !name) { skipped++; count++; continue; }

      if (_crmContacts?.has(publicId.toLowerCase())) { skipped++; count++; continue; }

      const data = await apiFetch('/ext/contact/enrich', {
        method: 'POST',
        body: JSON.stringify({
          name,
          title: titleEl?.textContent?.trim() || '',
          company: companyEl?.textContent?.trim() || '',
          linkedinUrl: `https://www.linkedin.com/in/${publicId}`,
        }),
      });

      if (data?.contact) {
        imported++;
        _crmContacts?.set(publicId.toLowerCase(), { id: data.contact.id, status: 'new', name });
      }
      // Human-like delay between imports
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
    } catch { skipped++; }
    count++;
  }

  btn.textContent = 'Import visible profiles';
  btn.disabled = false;
  status.textContent = `✅ ${imported} imported, ${skipped} skipped`;
  setTimeout(() => { if (status) status.textContent = ''; }, 5000);
}

// ── 4. Contact Panel (notes, emails, campaigns, patterns, quick email) ──

let _panelOpen = false;

function toggleContactPanel(slug) {
  const existing = document.getElementById('baakalai-panel');
  if (existing) { existing.remove(); _panelOpen = false; return; }
  _panelOpen = true;
  showContactPanel(slug);
}

async function showContactPanel(slug) {
  const panel = document.createElement('div');
  panel.id = 'baakalai-panel';
  Object.assign(panel.style, {
    position: 'fixed', top: '80px', right: '20px', width: '360px', maxHeight: 'calc(100vh - 100px)',
    background: '#FAFAF9', border: '1px solid #E5E5E3', borderRadius: '14px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.15)', zIndex: '10000', overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex', flexDirection: 'column',
  });

  // Header
  panel.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid #E5E5E3;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:700;font-size:14px;color:#0A0A0A;display:flex;align-items:center;gap:6px;">
        <svg width="16" height="16" viewBox="0 0 100 100"><circle cx="50" cy="50" r="13" fill="#6E57FA"/></svg>
        baakalai
      </span>
      <button id="baakalai-panel-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#737373;line-height:1;">×</button>
    </div>
    <div id="baakalai-panel-body" style="padding:16px 20px;overflow-y:auto;flex:1;font-size:12px;color:#0A0A0A;">
      <div style="text-align:center;padding:20px;color:#737373;">Loading...</div>
    </div>
  `;

  document.body.appendChild(panel);
  document.getElementById('baakalai-panel-close').onclick = () => { panel.remove(); _panelOpen = false; };

  // Fetch full contact data
  const linkedinUrl = `https://www.linkedin.com/in/${slug}`;
  const data = await apiFetch(`/ext/contact?linkedin=${encodeURIComponent(linkedinUrl)}`);
  const body = document.getElementById('baakalai-panel-body');
  if (!body) return;

  if (!data?.found) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:#737373;">Contact not found in Baakalai.</div>';
    return;
  }

  const c = data.contact;
  const statusColors = {
    won: '#16A34A', new: '#6E57FA', imported: '#2563EB',
    interested: '#D97706', meeting: '#D97706', lost: '#DC2626',
  };

  body.innerHTML = `
    <!-- Contact info -->
    <div style="margin-bottom:14px;">
      <div style="font-size:15px;font-weight:700;">${esc(c.name)}</div>
      <div style="color:#737373;margin-top:2px;">${esc(c.title || '')}${c.company ? ` · ${esc(c.company)}` : ''}</div>
      ${c.email ? `<div style="color:#737373;margin-top:2px;">${esc(c.email)}</div>` : ''}
      <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
        <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${(statusColors[c.status] || '#6E57FA')}15;color:${statusColors[c.status] || '#6E57FA'};font-weight:600;">${c.status}</span>
        ${c.churnScore >= 30 ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${c.churnScore >= 70 ? '#FEE2E2' : '#FEF3C7'};color:${c.churnScore >= 70 ? '#DC2626' : '#D97706'};font-weight:600;">Churn ${c.churnScore}%</span>` : ''}
      </div>
    </div>

    <!-- 5. Quick email -->
    ${c.email ? `
    <div style="margin-bottom:14px;">
      <button id="baakalai-quick-email" style="width:100%;padding:8px;border-radius:8px;border:1px solid #6E57FA;background:#6E57FA;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">
        Send quick email
      </button>
      <div id="baakalai-email-form" style="display:none;margin-top:8px;">
        <input id="baakalai-email-subject" type="text" placeholder="Subject" style="width:100%;padding:6px 10px;border:1px solid #E5E5E3;border-radius:6px;font-size:11px;margin-bottom:6px;">
        <textarea id="baakalai-email-body" rows="4" placeholder="Message..." style="width:100%;padding:6px 10px;border:1px solid #E5E5E3;border-radius:6px;font-size:11px;resize:vertical;margin-bottom:6px;"></textarea>
        <div style="display:flex;gap:6px;">
          <button id="baakalai-send-email" style="flex:1;padding:6px;border-radius:6px;border:none;background:#6E57FA;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Send</button>
          <button id="baakalai-cancel-email" style="padding:6px 12px;border-radius:6px;border:1px solid #E5E5E3;background:#fff;color:#737373;font-size:11px;cursor:pointer;">Cancel</button>
        </div>
        <div id="baakalai-email-msg" style="margin-top:4px;font-size:11px;"></div>
      </div>
    </div>` : '<div style="margin-bottom:14px;padding:8px;border-radius:8px;background:#FEF3C7;color:#D97706;font-size:11px;">No email address, add one in Baakalai to send emails.</div>'}

    <!-- 3. Patterns -->
    ${data.patterns?.length > 0 ? `
    <div style="margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Patterns to apply</div>
      ${data.patterns.map(p => `
        <div style="padding:6px 8px;background:#EDE9FE;border-radius:6px;margin-bottom:4px;font-size:11px;color:#4C1D95;line-height:1.4;">
          <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:#6E57FA20;color:#6E57FA;font-weight:600;margin-right:4px;">${esc(p.confidence)}</span>
          ${esc(p.pattern)}
        </div>
      `).join('')}
    </div>` : ''}

    <!-- Active campaigns -->
    ${data.activeCampaigns?.length > 0 ? `
    <div style="margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Active campaigns</div>
      ${data.activeCampaigns.map(camp => `
        <div style="padding:6px 8px;background:#F5F5F4;border-radius:6px;margin-bottom:4px;font-size:11px;display:flex;justify-content:space-between;">
          <span style="font-weight:600;">${esc(camp.name)}</span>
          <span style="color:#737373;">${camp.open_rate ? `${camp.open_rate}% open` : camp.status || ''}</span>
        </div>
      `).join('')}
    </div>` : ''}

    <!-- Recent emails -->
    ${data.recentEmails?.length > 0 ? `
    <div style="margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recent emails</div>
      ${data.recentEmails.map(e => `
        <div style="padding:4px 0;border-bottom:1px solid #F5F5F4;display:flex;align-items:center;gap:6px;font-size:11px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${e.sentiment === 'positive' ? '#16A34A' : e.sentiment === 'negative' ? '#DC2626' : '#9CA3AF'};flex-shrink:0;"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.subject)}</span>
          <span style="color:#737373;flex-shrink:0;">${e.sent_at ? new Date(e.sent_at).toLocaleDateString() : ''}</span>
        </div>
      `).join('')}
    </div>` : ''}

    <!-- 4. Notes -->
    <div style="margin-bottom:14px;">
      <div style="font-weight:700;font-size:11px;color:#737373;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Notes</div>
      <div id="baakalai-notes-list">
        ${(data.notes || []).length > 0 ? data.notes.map(n => `
          <div style="padding:6px 8px;background:#F5F5F4;border-radius:6px;margin-bottom:4px;font-size:11px;line-height:1.4;">
            <div>${esc(n.text)}</div>
            <div style="color:#737373;font-size:9px;margin-top:2px;">${n.author || ''} · ${n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ''}</div>
          </div>
        `).join('') : '<div style="color:#737373;font-size:11px;">No notes yet.</div>'}
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input id="baakalai-note-input" type="text" placeholder="Add a note..." style="flex:1;padding:6px 10px;border:1px solid #E5E5E3;border-radius:6px;font-size:11px;">
        <button id="baakalai-note-save" style="padding:6px 12px;border-radius:6px;border:1px solid #6E57FA;background:#fff;color:#6E57FA;font-size:11px;font-weight:600;cursor:pointer;">Add</button>
      </div>
    </div>

    <!-- Open in Baakalai -->
    <a href="https://app.baakal.ai/clients" target="_blank" style="display:block;text-align:center;padding:8px;border-radius:8px;border:1px solid #E5E5E3;color:#737373;font-size:11px;text-decoration:none;font-weight:600;">
      Open in Baakalai →
    </a>
  `;

  // Wire up events
  wireUpPanelEvents(c.id, data.notes || []);
}

function wireUpPanelEvents(contactId, existingNotes) {
  // Quick email toggle
  const emailBtn = document.getElementById('baakalai-quick-email');
  const emailForm = document.getElementById('baakalai-email-form');
  if (emailBtn && emailForm) {
    emailBtn.onclick = () => { emailForm.style.display = emailForm.style.display === 'none' ? 'block' : 'none'; emailBtn.style.display = 'none'; };
    document.getElementById('baakalai-cancel-email')?.addEventListener('click', () => { emailForm.style.display = 'none'; emailBtn.style.display = 'block'; });
    document.getElementById('baakalai-send-email')?.addEventListener('click', async () => {
      const subject = document.getElementById('baakalai-email-subject')?.value;
      const body = document.getElementById('baakalai-email-body')?.value;
      const msg = document.getElementById('baakalai-email-msg');
      if (!subject || !body) { if (msg) msg.innerHTML = '<span style="color:#DC2626;">Subject and body required</span>'; return; }

      const sendBtn = document.getElementById('baakalai-send-email');
      sendBtn.disabled = true; sendBtn.textContent = 'Sending...';

      try {
        const result = await apiFetch('/ext/quick-email', {
          method: 'POST',
          body: JSON.stringify({ contactId, subject, body }),
        });
        if (result?.success) {
          if (msg) msg.innerHTML = '<span style="color:#16A34A;">✅ Sent!</span>';
          setTimeout(() => { emailForm.style.display = 'none'; emailBtn.style.display = 'block'; emailBtn.textContent = '✅ Email sent'; }, 1500);
        } else {
          throw new Error(result?.error || 'Failed');
        }
      } catch (err) {
        if (msg) msg.innerHTML = `<span style="color:#DC2626;">${err.message}</span>`;
        sendBtn.disabled = false; sendBtn.textContent = 'Send';
      }
    });
  }

  // Notes
  const noteInput = document.getElementById('baakalai-note-input');
  const noteSave = document.getElementById('baakalai-note-save');
  if (noteInput && noteSave) {
    const saveNote = async () => {
      const text = noteInput.value.trim();
      if (!text) return;
      noteSave.disabled = true; noteSave.textContent = '...';

      try {
        const result = await apiFetch(`/ext/contact/${contactId}/note`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        if (result?.ok) {
          noteInput.value = '';
          const list = document.getElementById('baakalai-notes-list');
          if (list) {
            const noteEl = document.createElement('div');
            noteEl.style.cssText = 'padding:6px 8px;background:#EDE9FE;border-radius:6px;margin-bottom:4px;font-size:11px;line-height:1.4;';
            noteEl.innerHTML = `<div>${esc(text)}</div><div style="color:#737373;font-size:9px;margin-top:2px;">Just now</div>`;
            list.prepend(noteEl);
          }
        }
      } catch { /* ignore */ }
      noteSave.disabled = false; noteSave.textContent = 'Add';
    };
    noteSave.onclick = saveNote;
    noteInput.onkeydown = (e) => { if (e.key === 'Enter') saveNote(); };
  }
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── Start ──

init();
