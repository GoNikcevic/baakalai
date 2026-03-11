/* ═══════════════════════════════════════════════════
   BAKAL — Pages & Global Actions
   Handles Profil, Settings, Exports, and global buttons
   ═══════════════════════════════════════════════════ */

/* ═══ Profile Page — Save ═══ */
async function saveProfile() {
  const data = {
    company: document.getElementById('profil-company')?.value,
    sector: document.getElementById('profil-sector')?.value,
    website: document.getElementById('profil-website')?.value,
    team_size: document.getElementById('profil-team-size')?.value,
    description: document.getElementById('profil-description')?.value,
    value_prop: document.getElementById('profil-value-prop')?.value,
    social_proof: document.getElementById('profil-social-proof')?.value,
    pain_points: document.getElementById('profil-pain-points')?.value,
    objections: document.getElementById('profil-objections')?.value,
    persona_primary: document.getElementById('profil-persona-primary')?.value,
    persona_secondary: document.getElementById('profil-persona-secondary')?.value,
    target_sectors: document.getElementById('profil-target-sectors')?.value,
    target_size: document.getElementById('profil-target-size')?.value,
    target_zones: document.getElementById('profil-target-zones')?.value,
    default_tone: document.getElementById('profil-default-tone')?.value,
    default_formality: document.getElementById('profil-default-formality')?.value,
    avoid_words: document.getElementById('profil-avoid-words')?.value,
    signature_phrases: document.getElementById('profil-signature-phrases')?.value,
  };

  // Also keep in localStorage as fallback
  localStorage.setItem('bakal_profile', JSON.stringify(data));

  const btn = document.querySelector('#page-profil .btn-primary');
  const original = btn.innerHTML;

  // Save to backend
  try {
    const token = localStorage.getItem('bakal_token');
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Save failed');
  } catch {
    // Backend not available — localStorage fallback already done
  }

  btn.innerHTML = '✅ Enregistré';
  btn.style.background = 'var(--success)';
  setTimeout(() => {
    btn.innerHTML = original;
    btn.style.background = '';
  }, 2000);
}

async function loadProfile() {
  // Try backend first
  try {
    const token = localStorage.getItem('bakal_token');
    const res = await fetch('/api/profile', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const { profile } = await res.json();
      if (profile) {
        populateProfileForm(profile);
        return;
      }
    }
  } catch { /* backend not available */ }

  // Fallback to localStorage
  const saved = localStorage.getItem('bakal_profile');
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    // Remap camelCase keys to snake_case for the form populator
    populateProfileForm({
      company: data.company, sector: data.sector, website: data.website,
      team_size: data.team_size || data.teamSize,
      description: data.description, value_prop: data.value_prop || data.valueProp,
      social_proof: data.social_proof || data.socialProof,
      pain_points: data.pain_points || data.painPoints,
      objections: data.objections,
      persona_primary: data.persona_primary || data.personaPrimary,
      persona_secondary: data.persona_secondary || data.personaSecondary,
      target_sectors: data.target_sectors || data.targetSectors,
      target_size: data.target_size || data.targetSize,
      target_zones: data.target_zones || data.targetZones,
      default_tone: data.default_tone || data.defaultTone,
      default_formality: data.default_formality || data.defaultFormality,
      avoid_words: data.avoid_words || data.avoidWords,
      signature_phrases: data.signature_phrases || data.signaturePhrases,
    });
  } catch { /* ignore parse errors */ }
}

function populateProfileForm(data) {
  const textFields = {
    'profil-company': data.company,
    'profil-sector': data.sector,
    'profil-website': data.website,
    'profil-description': data.description,
    'profil-value-prop': data.value_prop,
    'profil-social-proof': data.social_proof,
    'profil-pain-points': data.pain_points,
    'profil-objections': data.objections,
    'profil-persona-primary': data.persona_primary,
    'profil-persona-secondary': data.persona_secondary,
    'profil-target-sectors': data.target_sectors,
    'profil-target-size': data.target_size,
    'profil-target-zones': data.target_zones,
    'profil-avoid-words': data.avoid_words,
    'profil-signature-phrases': data.signature_phrases,
  };
  Object.entries(textFields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  });

  const selectFields = {
    'profil-team-size': data.team_size,
    'profil-default-tone': data.default_tone,
    'profil-default-formality': data.default_formality,
  };
  Object.entries(selectFields).forEach(([id, val]) => {
    if (!val) return;
    const sel = document.getElementById(id);
    if (!sel) return;
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].text === val || sel.options[i].value === val) {
        sel.selectedIndex = i;
        break;
      }
    }
  });
}

/* ═══ Settings Page — Save ═══ */
async function saveSettings() {
  const btn = document.querySelector('#page-settings .btn-primary');
  const original = btn.innerHTML;

  // Collect API keys from inputs
  const apiKeys = {
    // ── Core ──
    lemlistKey: document.getElementById('settings-lemlist-key')?.value?.trim(),
    notionToken: document.getElementById('settings-notion-token')?.value?.trim(),
    claudeKey: document.getElementById('settings-claude-key')?.value?.trim(),
    // ── CRM ──
    hubspotKey: document.getElementById('settings-hubspot-key')?.value?.trim(),
    pipedriveKey: document.getElementById('settings-pipedrive-key')?.value?.trim(),
    salesforceKey: document.getElementById('settings-salesforce-key')?.value?.trim(),
    folkKey: document.getElementById('settings-folk-key')?.value?.trim(),
    // ── Enrichment ──
    dropcontactKey: document.getElementById('settings-dropcontact-key')?.value?.trim(),
    apolloKey: document.getElementById('settings-apollo-key')?.value?.trim(),
    hunterKey: document.getElementById('settings-hunter-key')?.value?.trim(),
    kasprKey: document.getElementById('settings-kaspr-key')?.value?.trim(),
    lushaKey: document.getElementById('settings-lusha-key')?.value?.trim(),
    snovKey: document.getElementById('settings-snov-key')?.value?.trim(),
    // ── Outreach ──
    instantlyKey: document.getElementById('settings-instantly-key')?.value?.trim(),
    lgmKey: document.getElementById('settings-lgm-key')?.value?.trim(),
    waalaxyKey: document.getElementById('settings-waalaxy-key')?.value?.trim(),
    // ── LinkedIn / Scraping ──
    phantombusterKey: document.getElementById('settings-phantombuster-key')?.value?.trim(),
    captaindataKey: document.getElementById('settings-captaindata-key')?.value?.trim(),
    // ── Calendar ──
    calendlyKey: document.getElementById('settings-calendly-key')?.value?.trim(),
    calcomKey: document.getElementById('settings-calcom-key')?.value?.trim(),
    // ── Deliverability ──
    mailreachKey: document.getElementById('settings-mailreach-key')?.value?.trim(),
    warmboxKey: document.getElementById('settings-warmbox-key')?.value?.trim(),
  };

  // Collect non-sensitive settings (these stay in localStorage)
  const prefs = {
    lemlistDailyLimit: document.getElementById('settings-lemlist-daily-limit')?.value,
    lemlistSendWindow: document.getElementById('settings-lemlist-send-window')?.value,
    lemlistSendDays: document.getElementById('settings-lemlist-send-days')?.value,
    linkedinDelay: document.getElementById('settings-linkedin-delay')?.value,
    claudeModel: document.getElementById('settings-claude-model')?.value,
    claudeValidation: document.getElementById('settings-claude-validation')?.value,
    notifEmail: document.getElementById('settings-notif-email')?.value,
  };
  localStorage.setItem('bakal_settings_prefs', JSON.stringify(prefs));

  // Send API keys to backend (encrypted storage) — only non-empty values
  const keysToSave = {};
  let hasKeys = false;
  for (const [field, value] of Object.entries(apiKeys)) {
    if (value) {
      keysToSave[field] = value;
      hasKeys = true;
    }
  }

  if (hasKeys && typeof BakalAPI !== 'undefined') {
    try {
      btn.innerHTML = '🔐 Chiffrement...';
      const result = await BakalAPI.saveKeys(keysToSave);
      if (result.errors && result.errors.length > 0) {
        btn.innerHTML = '⚠️ ' + result.errors[0];
        btn.style.background = 'var(--warning, #e6a700)';
        setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 3000);
        return;
      }
      // Clear plaintext from inputs — show masked version instead
      await loadSettingsKeys();
    } catch (err) {
      btn.innerHTML = '❌ Erreur serveur';
      btn.style.background = 'var(--error, #e53935)';
      setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 3000);
      return;
    }
  }

  btn.innerHTML = '✅ Enregistré';
  btn.style.background = 'var(--success)';
  setTimeout(() => { btn.innerHTML = original; btn.style.background = ''; }, 2000);
}

/* ═══ Settings Page — Load saved keys from backend ═══ */
async function loadSettingsKeys() {
  if (typeof BakalAPI === 'undefined') return;
  try {
    const { keys } = await BakalAPI.getKeys();
    const fieldMap = {
      lemlistKey: { inputId: 'settings-lemlist-key', statusId: 'status-lemlist' },
      notionToken: { inputId: 'settings-notion-token', statusId: 'status-notion' },
      claudeKey: { inputId: 'settings-claude-key', statusId: 'status-claude' },
      hubspotKey: { inputId: 'settings-hubspot-key', statusId: 'status-hubspot' },
      pipedriveKey: { inputId: 'settings-pipedrive-key', statusId: 'status-pipedrive' },
      salesforceKey: { inputId: 'settings-salesforce-key', statusId: 'status-salesforce' },
      folkKey: { inputId: 'settings-folk-key', statusId: 'status-folk' },
      dropcontactKey: { inputId: 'settings-dropcontact-key', statusId: 'status-dropcontact' },
      apolloKey: { inputId: 'settings-apollo-key', statusId: 'status-apollo' },
      hunterKey: { inputId: 'settings-hunter-key', statusId: 'status-hunter' },
      kasprKey: { inputId: 'settings-kaspr-key', statusId: 'status-kaspr' },
      lushaKey: { inputId: 'settings-lusha-key', statusId: 'status-lusha' },
      snovKey: { inputId: 'settings-snov-key', statusId: 'status-snov' },
      instantlyKey: { inputId: 'settings-instantly-key', statusId: 'status-instantly' },
      lgmKey: { inputId: 'settings-lgm-key', statusId: 'status-lgm' },
      waalaxyKey: { inputId: 'settings-waalaxy-key', statusId: 'status-waalaxy' },
      phantombusterKey: { inputId: 'settings-phantombuster-key', statusId: 'status-phantombuster' },
      captaindataKey: { inputId: 'settings-captaindata-key', statusId: 'status-captaindata' },
      calendlyKey: { inputId: 'settings-calendly-key', statusId: 'status-calendly' },
      calcomKey: { inputId: 'settings-calcom-key', statusId: 'status-calcom' },
      mailreachKey: { inputId: 'settings-mailreach-key', statusId: 'status-mailreach' },
      warmboxKey: { inputId: 'settings-warmbox-key', statusId: 'status-warmbox' },
    };

    for (const [field, info] of Object.entries(keys)) {
      const ids = fieldMap[field];
      if (!ids) continue;

      const input = document.getElementById(ids.inputId);
      const status = document.getElementById(ids.statusId);
      if (!input || !status) continue;

      if (info.configured) {
        input.value = '';
        input.placeholder = info.masked;
        status.textContent = 'Configuré (chiffré)';
        status.className = 'input-status connected';
        status.style.color = '';
      } else {
        input.placeholder = input.dataset.originalPlaceholder || input.placeholder;
        status.textContent = 'Non configuré';
        status.className = 'input-status';
        status.style.color = '';
      }
    }
    // Sync catalog card dots
    if (typeof updateApiCatalogDots === 'function') setTimeout(updateApiCatalogDots, 100);
  } catch { /* backend not available */ }
}

/* ═══ Settings Page — Load preferences from localStorage ═══ */
function loadSettingsPrefs() {
  const saved = localStorage.getItem('bakal_settings_prefs');
  if (!saved) return;
  try {
    const prefs = JSON.parse(saved);
    const selects = {
      'settings-lemlist-daily-limit': prefs.lemlistDailyLimit,
      'settings-lemlist-send-window': prefs.lemlistSendWindow,
      'settings-lemlist-send-days': prefs.lemlistSendDays,
      'settings-linkedin-delay': prefs.linkedinDelay,
      'settings-claude-model': prefs.claudeModel,
      'settings-claude-validation': prefs.claudeValidation,
    };
    for (const [id, val] of Object.entries(selects)) {
      if (!val) continue;
      const el = document.getElementById(id);
      if (el) {
        for (let i = 0; i < el.options.length; i++) {
          if (el.options[i].text === val || el.options[i].value === val) {
            el.selectedIndex = i;
            break;
          }
        }
      }
    }
    if (prefs.notifEmail) {
      const el = document.getElementById('settings-notif-email');
      if (el) el.value = prefs.notifEmail;
    }
  } catch { /* ignore */ }
}

async function testApiConnections() {
  const statusMap = {
    lemlistKey: 'status-lemlist',
    notionToken: 'status-notion',
    claudeKey: 'status-claude',
    hubspotKey: 'status-hubspot',
    pipedriveKey: 'status-pipedrive',
    salesforceKey: 'status-salesforce',
    folkKey: 'status-folk',
    dropcontactKey: 'status-dropcontact',
    apolloKey: 'status-apollo',
    hunterKey: 'status-hunter',
    kasprKey: 'status-kaspr',
    lushaKey: 'status-lusha',
    snovKey: 'status-snov',
    instantlyKey: 'status-instantly',
    lgmKey: 'status-lgm',
    waalaxyKey: 'status-waalaxy',
    phantombusterKey: 'status-phantombuster',
    captaindataKey: 'status-captaindata',
    calendlyKey: 'status-calendly',
    calcomKey: 'status-calcom',
    mailreachKey: 'status-mailreach',
    warmboxKey: 'status-warmbox',
  };

  // Show testing state for all
  for (const statusId of Object.values(statusMap)) {
    const el = document.getElementById(statusId);
    if (el) {
      el.textContent = 'Test en cours...';
      el.className = 'input-status';
      el.style.color = 'var(--text-secondary)';
    }
  }

  // Try real backend connectivity test
  if (typeof BakalAPI !== 'undefined') {
    try {
      const { results } = await BakalAPI.testKeys();

      for (const [field, result] of Object.entries(results)) {
        const statusId = statusMap[field];
        if (!statusId) continue;
        const el = document.getElementById(statusId);
        if (!el) continue;

        if (result.status === 'connected') {
          el.textContent = 'Connecté';
          el.className = 'input-status connected';
        } else if (result.status === 'invalid') {
          el.textContent = 'Clé invalide';
          el.className = 'input-status error';
        } else if (result.status === 'not_configured') {
          el.textContent = 'Non configuré';
          el.className = 'input-status';
        } else {
          el.textContent = result.message || 'Erreur';
          el.className = 'input-status error';
        }
        el.style.color = '';
      }
      // Sync connection status cards & catalog dots
      if (typeof updateSettingsConnectionStatus === 'function') {
        setTimeout(updateSettingsConnectionStatus, 200);
      }
      if (typeof updateApiCatalogDots === 'function') {
        setTimeout(updateApiCatalogDots, 300);
      }
      return;
    } catch { /* backend not available, fall through */ }
  }

  // Offline fallback — basic format validation on input values
  const localChecks = [
    { id: 'settings-lemlist-key', statusId: 'status-lemlist', check: v => v.length > 10 },
    { id: 'settings-notion-token', statusId: 'status-notion', check: v => v.startsWith('ntn_') || v.startsWith('secret_') },
    { id: 'settings-claude-key', statusId: 'status-claude', check: v => v.startsWith('sk-ant-') },
    { id: 'settings-hubspot-key', statusId: 'status-hubspot', check: v => v.startsWith('pat-') || v.length > 20 },
    { id: 'settings-pipedrive-key', statusId: 'status-pipedrive', check: v => v.length > 10 },
    { id: 'settings-salesforce-key', statusId: 'status-salesforce', check: v => v.length > 10 },
    { id: 'settings-folk-key', statusId: 'status-folk', check: v => v.length > 10 },
    { id: 'settings-dropcontact-key', statusId: 'status-dropcontact', check: v => v.length > 10 },
    { id: 'settings-apollo-key', statusId: 'status-apollo', check: v => v.length > 10 },
    { id: 'settings-hunter-key', statusId: 'status-hunter', check: v => v.length > 10 },
    { id: 'settings-kaspr-key', statusId: 'status-kaspr', check: v => v.length > 10 },
    { id: 'settings-lusha-key', statusId: 'status-lusha', check: v => v.length > 10 },
    { id: 'settings-snov-key', statusId: 'status-snov', check: v => v.length > 10 },
    { id: 'settings-instantly-key', statusId: 'status-instantly', check: v => v.length > 10 },
    { id: 'settings-lgm-key', statusId: 'status-lgm', check: v => v.length > 10 },
    { id: 'settings-waalaxy-key', statusId: 'status-waalaxy', check: v => v.length > 10 },
    { id: 'settings-phantombuster-key', statusId: 'status-phantombuster', check: v => v.length > 10 },
    { id: 'settings-captaindata-key', statusId: 'status-captaindata', check: v => v.length > 10 },
    { id: 'settings-calendly-key', statusId: 'status-calendly', check: v => v.length > 10 },
    { id: 'settings-calcom-key', statusId: 'status-calcom', check: v => v.length > 10 },
    { id: 'settings-mailreach-key', statusId: 'status-mailreach', check: v => v.length > 10 },
    { id: 'settings-warmbox-key', statusId: 'status-warmbox', check: v => v.length > 10 },
  ];

  for (const c of localChecks) {
    const input = document.getElementById(c.id);
    const status = document.getElementById(c.statusId);
    const value = input?.value?.trim();
    if (!status) continue;

    if (!value) {
      status.textContent = 'Non connecté';
      status.className = 'input-status';
    } else if (c.check(value)) {
      status.textContent = 'Format OK';
      status.className = 'input-status connected';
    } else {
      status.textContent = 'Format invalide';
      status.className = 'input-status error';
    }
    status.style.color = '';
  }

  // Sync connection status cards & catalog dots
  if (typeof updateSettingsConnectionStatus === 'function') {
    setTimeout(updateSettingsConnectionStatus, 500);
  }
  if (typeof updateApiCatalogDots === 'function') {
    setTimeout(updateApiCatalogDots, 600);
  }
}

/* ═══ Dashboard Export ═══ */
function exportDashboardReport() {
  if (typeof BAKAL === 'undefined') return;

  const rows = [['Campagne', 'Canal', 'Statut', 'Prospects', 'Open%', 'Reply%', 'Intéressés', 'RDV']];
  Object.values(BAKAL.campaigns).forEach(c => {
    rows.push([
      c.name, c.channel, c.status, c.kpis?.contacts ?? 0,
      c.kpis?.openRate ?? '', c.kpis?.replyRate ?? '',
      c.kpis?.interested ?? '', c.kpis?.meetings ?? ''
    ]);
  });

  downloadCSV(rows, 'bakal_rapport_dashboard.csv');
}

/* ═══ Copy Editor — Export all sequences ═══ */
function exportAllSequences() {
  const rows = [['Campagne', 'Step', 'Type', 'Timing', 'Objet', 'Corps']];
  Object.entries(editorCampaigns).forEach(([key, c]) => {
    c.touchpoints.forEach(tp => {
      const body = tp.body.replace(/<[^>]*>/g, '').replace(/\n/g, ' ');
      const subject = tp.subject ? tp.subject.replace(/<[^>]*>/g, '') : '';
      rows.push([c.name, tp.id, tp.type, tp.timing, subject, body]);
    });
  });

  downloadCSV(rows, 'bakal_sequences_export.csv');
}

/* ═══ Copy Editor — Generate new sequence (simulated) ═══ */
function generateNewSequence() {
  const main = document.getElementById('editor-main-content');
  if (!main) return;

  // Show generation overlay on the editor
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(10,11,15,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10;border-radius:12px;';
  overlay.innerHTML = `
    <div style="font-size:32px;margin-bottom:16px;">🤖</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Claude génère votre séquence...</div>
    <div style="font-size:13px;color:var(--text-muted);">Analyse du profil entreprise et des données cross-campagne</div>
    <div style="margin-top:24px;width:200px;height:4px;background:var(--bg-elevated);border-radius:2px;overflow:hidden;">
      <div style="width:0%;height:100%;background:var(--text-muted);border-radius:2px;transition:width 2s linear;" id="gen-progress"></div>
    </div>
  `;
  main.style.position = 'relative';
  main.appendChild(overlay);

  // Animate progress
  requestAnimationFrame(() => {
    const bar = document.getElementById('gen-progress');
    if (bar) bar.style.width = '100%';
  });

  // Remove after simulation
  setTimeout(() => {
    overlay.innerHTML = `
      <div style="font-size:32px;margin-bottom:16px;">✅</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;color:var(--success);">Séquence générée</div>
      <div style="font-size:13px;color:var(--text-muted);">Vérifiez le résultat et sauvegardez quand vous êtes satisfait</div>
    `;
    setTimeout(() => {
      overlay.style.transition = 'opacity 0.3s';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }, 1500);
  }, 2500);
}

/* ═══ Recommendations — Re-run analysis (simulated) ═══ */
function rerunAnalysis() {
  const subtitle = document.querySelector('.reco-page-subtitle');
  if (subtitle) {
    subtitle.textContent = 'Claude analyse vos campagnes... Veuillez patienter.';
    subtitle.style.color = 'var(--text-secondary)';

    setTimeout(() => {
      subtitle.textContent = 'Claude analyse vos campagnes et propose des optimisations · Mis à jour à l\'instant';
      subtitle.style.color = '';
    }, 3000);
  }
}

/* ═══ Campaign List — Filter toggle ═══ */
function filterCampaignsList() {
  const listView = document.getElementById('campaigns-list-view');
  if (!listView) return;

  let panel = listView.querySelector('.filter-panel');
  if (panel) { panel.remove(); return; }

  panel = document.createElement('div');
  panel.className = 'filter-panel';
  panel.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin:16px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;';
  panel.innerHTML = `
    <span style="font-size:12px;color:var(--text-muted);font-weight:600;">Filtrer :</span>
    <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="filterByStatus('active')">Actives</button>
    <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="filterByStatus('prep')">En préparation</button>
    <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="filterByStatus('')">Toutes</button>
    <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;margin-left:auto;" onclick="this.closest('.filter-panel').remove()">✕</button>
  `;

  const list = listView.querySelector('.campaigns-list');
  if (list) list.before(panel);
}

function filterByStatus(status) {
  const rows = document.querySelectorAll('.campaigns-list .campaign-row, .campaigns-list [onclick*="showCampaignDetail"]');
  rows.forEach(row => {
    if (!status) {
      row.style.display = '';
      return;
    }
    // Check if the row contains the matching status badge
    const badge = row.querySelector('.status-badge');
    if (!badge) { row.style.display = ''; return; }
    const isActive = badge.classList.contains('status-active');
    const isPrep = badge.classList.contains('status-prep');

    if (status === 'active') row.style.display = isActive ? '' : 'none';
    else if (status === 'prep') row.style.display = isPrep ? '' : 'none';
    else row.style.display = '';
  });
}

/* ═══ Campaign List — Sort toggle ═══ */
let sortAscending = false;
function sortCampaignsList() {
  const list = document.querySelector('.campaigns-list');
  if (!list) return;

  const rows = Array.from(list.children);
  rows.sort((a, b) => {
    // Extract reply rate from the row text
    const getReply = (el) => {
      const text = el.textContent;
      const match = text.match(/(\d+\.?\d*)%/g);
      return match && match.length >= 2 ? parseFloat(match[1]) : 0;
    };
    const diff = getReply(b) - getReply(a);
    return sortAscending ? -diff : diff;
  });

  sortAscending = !sortAscending;
  rows.forEach(r => list.appendChild(r));
}

/* ═══ CSV download helper ═══ */
function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════
   THEME — Light/Dark mode with localStorage persistence
   ═══════════════════════════════════════════════════ */

function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Update the toggle switch in settings
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    const current = document.documentElement.getAttribute('data-theme');
    toggle.classList.toggle('on', current === 'light');
  }
}

function setTheme(theme) {
  localStorage.setItem('bakal-theme', theme);
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'light' ? 'dark' : 'light');
}

function initTheme() {
  const saved = localStorage.getItem('bakal-theme') || 'dark';
  applyTheme(saved);

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('bakal-theme') === 'system') {
      applyTheme('system');
    }
  });
}

/* ═══════════════════════════════════════════════
   Documents Upload
   ═══════════════════════════════════════════════ */

function initDocDropzone() {
  const dropzone = document.getElementById('docDropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      handleDocUpload(e.dataTransfer.files);
    }
  });
}

async function handleDocUpload(files) {
  if (!files || files.length === 0) return;

  const progress = document.getElementById('docUploadProgress');
  if (progress) progress.style.display = 'block';

  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  try {
    const token = localStorage.getItem('bakal_token');
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed (${res.status})`);
    }

    const data = await res.json();
    if (typeof showToast === 'function') {
      showToast(`${data.uploaded.length} document(s) uploaded`, 'success');
    }
    loadDocuments();
  } catch (err) {
    console.error('Upload error:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Upload failed', 'error');
    }
  } finally {
    if (progress) progress.style.display = 'none';
    // Reset file input
    const input = document.getElementById('docFileInput');
    if (input) input.value = '';
  }
}

async function loadDocuments() {
  const list = document.getElementById('docList');
  const count = document.getElementById('docCount');
  if (!list) return;

  try {
    const token = localStorage.getItem('bakal_token');
    const res = await fetch('/api/documents', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Could not load documents</div>';
      return;
    }

    const data = await res.json();
    const docs = data.documents || [];

    if (count) count.textContent = `${docs.length} document${docs.length !== 1 ? 's' : ''}`;

    if (docs.length === 0) {
      list.innerHTML = '';
      return;
    }

    const icons = {
      'application/pdf': '📕',
      'text/plain': '📝',
      'text/csv': '📊',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📘',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📙',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📗',
    };

    list.innerHTML = docs.map(doc => {
      const icon = icons[doc.mime_type] || (doc.mime_type?.startsWith('image/') ? '🖼️' : '📄');
      const size = doc.file_size < 1024 * 1024
        ? `${(doc.file_size / 1024).toFixed(0)} KB`
        : `${(doc.file_size / (1024 * 1024)).toFixed(1)} MB`;
      const date = new Date(doc.created_at).toLocaleDateString();
      return `<div class="doc-item">
        <div class="doc-icon">${icon}</div>
        <div class="doc-info">
          <div class="doc-name" title="${doc.original_name}">${doc.original_name}</div>
          <div class="doc-meta">${size} — ${date}</div>
        </div>
        <button class="doc-delete" onclick="deleteDocument(${doc.id})" title="Delete">✕</button>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Load documents error:', err);
  }
}

async function deleteDocument(id) {
  if (!confirm('Delete this document?')) return;

  try {
    const token = localStorage.getItem('bakal_token');
    const res = await fetch(`/api/documents/${id}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });

    if (res.ok) {
      if (typeof showToast === 'function') showToast('Document deleted', 'success');
      loadDocuments();
    }
  } catch (err) {
    console.error('Delete error:', err);
  }
}

/* ═══════════════════════════════════════════════
   API Catalog — Card toggle, filter, search
   ═══════════════════════════════════════════════ */

let apiCatFilterActive = 'all';

function toggleApiCard(card) {
  card.classList.toggle('open');
}

function toggleMoreApis() {
  const section = document.getElementById('apiExtendedSection');
  const label = document.getElementById('apiShowMoreLabel');
  const chevron = document.getElementById('apiShowMoreChevron');
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : '';
  label.textContent = isOpen ? 'Voir plus d\'intégrations' : 'Masquer les intégrations';
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

function setApiCatFilter(cat, btn) {
  apiCatFilterActive = cat;
  document.querySelectorAll('.api-cat-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterApiCatalog();
}

function filterApiCatalog() {
  const query = (document.getElementById('apiCatalogSearchExtended')?.value || '').toLowerCase();
  const cards = document.querySelectorAll('#apiCatalogGridExtended .api-card');
  let visible = 0;

  cards.forEach(card => {
    const cat = card.dataset.cat;
    const name = card.querySelector('.api-card-name')?.textContent?.toLowerCase() || '';
    const desc = card.querySelector('.api-card-desc')?.textContent?.toLowerCase() || '';

    const matchesCat = apiCatFilterActive === 'all' || cat === apiCatFilterActive;
    const matchesSearch = !query || name.includes(query) || desc.includes(query);

    if (matchesCat && matchesSearch) {
      card.style.display = '';
      visible++;
    } else {
      card.style.display = 'none';
    }
  });

  const countEl = document.getElementById('apiCatalogCount');
  const visibleBase = document.querySelectorAll('#apiCatalogGrid .api-card').length;
  if (countEl) countEl.textContent = `${visible + visibleBase} intégration${visible + visibleBase !== 1 ? 's' : ''}`;
}

function updateApiCatalogDots() {
  // Sync status-dot colors with status text
  const dotMap = {
    'status-lemlist': 'dot-lemlist', 'status-claude': 'dot-claude', 'status-notion': 'dot-notion',
    'status-hubspot': 'dot-hubspot', 'status-pipedrive': 'dot-pipedrive', 'status-salesforce': 'dot-salesforce',
    'status-folk': 'dot-folk', 'status-dropcontact': 'dot-dropcontact', 'status-apollo': 'dot-apollo',
    'status-hunter': 'dot-hunter', 'status-kaspr': 'dot-kaspr', 'status-lusha': 'dot-lusha',
    'status-snov': 'dot-snov', 'status-instantly': 'dot-instantly', 'status-lgm': 'dot-lgm',
    'status-waalaxy': 'dot-waalaxy', 'status-phantombuster': 'dot-phantombuster',
    'status-captaindata': 'dot-captaindata', 'status-calendly': 'dot-calendly',
    'status-calcom': 'dot-calcom', 'status-mailreach': 'dot-mailreach', 'status-warmbox': 'dot-warmbox',
  };

  for (const [statusId, dotId] of Object.entries(dotMap)) {
    const status = document.getElementById(statusId);
    const dot = document.getElementById(dotId);
    if (!status || !dot) continue;

    const card = dot.closest('.api-card');
    if (status.classList.contains('connected')) {
      dot.classList.add('online');
      dot.classList.remove('error');
      if (card) card.classList.add('connected');
    } else if (status.classList.contains('error')) {
      dot.classList.add('error');
      dot.classList.remove('online');
      if (card) card.classList.remove('connected');
    } else {
      dot.classList.remove('online', 'error');
      if (card) card.classList.remove('connected');
    }
  }
}

/* ═══════════════════════════════════════════════
   Onboarding Wizard
   ═══════════════════════════════════════════════ */

function shouldShowWizard() {
  return !localStorage.getItem('bakal_onboarding_done');
}

function wizardGoTo(step) {
  // Update step visibility
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`wizardStep${i}`);
    if (el) el.classList.toggle('active', i === step);
  }
  // Update dots
  const dots = document.querySelectorAll('#wizardDots .wizard-step-dot');
  dots.forEach((dot, idx) => {
    dot.classList.remove('active', 'done');
    if (idx + 1 === step) dot.classList.add('active');
    else if (idx + 1 < step) dot.classList.add('done');
  });
}

function wizardHandleFiles(files) {
  if (!files || files.length === 0) return;
  const statusEl = document.getElementById('wizardUploadStatus');
  if (statusEl) statusEl.textContent = `Uploading ${files.length} file(s)...`;

  // Reuse the main upload handler
  handleDocUpload(files).then(() => {
    if (statusEl) statusEl.textContent = `${files.length} document(s) uploaded successfully`;
    // Reset file input
    const input = document.getElementById('wizardFileInput');
    if (input) input.value = '';
  }).catch(() => {
    if (statusEl) statusEl.textContent = 'Upload failed — try again or skip';
  });
}

async function wizardSaveKeysAndNext() {
  // Essential keys
  const lemlist = document.getElementById('wizard-lemlist-key')?.value?.trim();
  const claude = document.getElementById('wizard-claude-key')?.value?.trim();
  const notion = document.getElementById('wizard-notion-key')?.value?.trim();

  // Optional keys
  const instantly = document.getElementById('wizard-instantly-key')?.value?.trim();
  const openai = document.getElementById('wizard-openai-key')?.value?.trim();
  const hubspot = document.getElementById('wizard-hubspot-key')?.value?.trim();
  const pipedrive = document.getElementById('wizard-pipedrive-key')?.value?.trim();
  const dropcontact = document.getElementById('wizard-dropcontact-key')?.value?.trim();
  const apollo = document.getElementById('wizard-apollo-key')?.value?.trim();
  const phantom = document.getElementById('wizard-phantom-key')?.value?.trim();
  const n8n = document.getElementById('wizard-n8n-key')?.value?.trim();

  // Copy essential values to the main settings inputs
  if (lemlist) {
    const el = document.getElementById('settings-lemlist-key');
    if (el) el.value = lemlist;
  }
  if (claude) {
    const el = document.getElementById('settings-claude-key');
    if (el) el.value = claude;
  }
  if (notion) {
    const el = document.getElementById('settings-notion-token');
    if (el) el.value = notion;
  }

  // Build keys payload (essential + optional)
  const keysToSave = {};
  if (lemlist) keysToSave.lemlistKey = lemlist;
  if (claude) keysToSave.claudeKey = claude;
  if (notion) keysToSave.notionToken = notion;
  if (instantly) keysToSave.instantlyKey = instantly;
  if (openai) keysToSave.openaiKey = openai;
  if (hubspot) keysToSave.hubspotKey = hubspot;
  if (pipedrive) keysToSave.pipedriveKey = pipedrive;
  if (dropcontact) keysToSave.dropcontactKey = dropcontact;
  if (apollo) keysToSave.apolloKey = apollo;
  if (phantom) keysToSave.phantomKey = phantom;
  if (n8n) keysToSave.n8nKey = n8n;

  if (Object.keys(keysToSave).length > 0 && typeof BakalAPI !== 'undefined') {
    try {
      await BakalAPI.saveKeys(keysToSave);
      await loadSettingsKeys();
      if (typeof showToast === 'function') showToast(`${Object.keys(keysToSave).length} clé(s) sauvegardée(s)`, 'success');
    } catch (err) {
      console.error('Wizard key save failed:', err);
      if (typeof showToast === 'function') showToast('Erreur lors de la sauvegarde des clés — réessayez dans Paramètres', 'error');
    }
  }

  wizardGoTo(3);
}

function wizardFinish() {
  localStorage.setItem('bakal_onboarding_done', '1');
  const overlay = document.getElementById('wizardOverlay');
  if (overlay) {
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
  }
  // Navigate to chat (default page)
  if (typeof showPage === 'function') showPage('chat');
}

function initWizardDropzone() {
  const dz = document.getElementById('wizardDropzone');
  if (!dz) return;
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = 'var(--border-light)'; });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.style.borderColor = 'var(--border-light)';
    if (e.dataTransfer.files.length) wizardHandleFiles(e.dataTransfer.files);
  });
}

/* ═══════════════════════════════════════════════
   Supabase Database — Settings
   ═══════════════════════════════════════════════ */

function loadSupabaseSettings() {
  if (typeof BakalSupabase === 'undefined') return;
  try {
    const config = JSON.parse(localStorage.getItem('bakal_supabase_config') || '{}');
    const urlInput = document.getElementById('settings-supabase-url');
    const keyInput = document.getElementById('settings-supabase-anon-key');
    if (urlInput && config.url) urlInput.value = config.url;
    if (keyInput && config.anonKey) keyInput.placeholder = config.anonKey.slice(0, 20) + '...';

    updateSupabaseStatus();
  } catch { /* ignore */ }
}

function saveSupabaseConfig() {
  const url = document.getElementById('settings-supabase-url')?.value?.trim();
  const anonKey = document.getElementById('settings-supabase-anon-key')?.value?.trim();

  if (!url || !anonKey) {
    if (typeof showToast === 'function') showToast('URL et clé anon requises', 'error');
    return;
  }

  if (typeof BakalSupabase !== 'undefined') {
    BakalSupabase.configure(url, anonKey);
  }

  // Clear the plaintext key from the input
  document.getElementById('settings-supabase-anon-key').value = '';
  document.getElementById('settings-supabase-anon-key').placeholder = anonKey.slice(0, 20) + '...';

  updateSupabaseStatus();
  if (typeof showToast === 'function') showToast('Connexion Supabase enregistrée', 'success');
}

function clearSupabaseConfig() {
  localStorage.removeItem('bakal_supabase_config');
  const urlInput = document.getElementById('settings-supabase-url');
  const keyInput = document.getElementById('settings-supabase-anon-key');
  if (urlInput) urlInput.value = '';
  if (keyInput) { keyInput.value = ''; keyInput.placeholder = 'eyJhbGciOi...'; }
  updateSupabaseStatus();
  if (typeof showToast === 'function') showToast('Connexion Supabase supprimée', 'success');
}

async function testSupabaseConnection() {
  const status = document.getElementById('supabase-status');
  if (!status) return;

  status.textContent = 'Test en cours...';
  status.style.color = 'var(--text-secondary)';

  if (typeof BakalSupabase === 'undefined' || !BakalSupabase.isReady()) {
    status.textContent = 'Non configuré';
    status.style.color = 'var(--text-muted)';
    return;
  }

  const ok = await BakalSupabase.checkHealth();
  if (ok) {
    status.textContent = 'Connecté';
    status.style.color = 'var(--success)';
  } else {
    status.textContent = 'Connexion échouée';
    status.style.color = 'var(--danger)';
  }
}

function updateSupabaseStatus() {
  const status = document.getElementById('supabase-status');
  if (!status) return;

  if (typeof BakalSupabase !== 'undefined' && BakalSupabase.isReady()) {
    status.textContent = 'Configuré';
    status.style.color = 'var(--success)';
  } else {
    status.textContent = 'Non configuré';
    status.style.color = 'var(--text-muted)';
  }
}

/* ═══ Init — Load saved data on page load ═══ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadProfile();
  loadSettingsPrefs();
  loadSettingsKeys();
  loadSupabaseSettings();
  initDocDropzone();
  loadDocuments();
  filterApiCatalog();
  const moreCount = document.getElementById('apiMoreCount');
  const extendedCards = document.querySelectorAll('#apiCatalogGridExtended .api-card');
  if (moreCount) moreCount.textContent = extendedCards.length;

  // Show onboarding wizard for first-time users
  if (shouldShowWizard()) {
    const overlay = document.getElementById('wizardOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      initWizardDropzone();
    }
  }
});
