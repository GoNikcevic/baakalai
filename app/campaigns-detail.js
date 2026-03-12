/* ═══════════════════════════════════════════════════
   BAKAL — Campaign Detail Views (data-driven)
   Renders from BAKAL.campaigns in campaigns-data.js
   ═══════════════════════════════════════════════════ */

/* ═══ Navigation ═══ */
async function showCampaignDetail(id) {
  document.getElementById('campaigns-list-view').style.display = 'none';

  // Hide all detail containers, show the requested one
  document.querySelectorAll('.campaign-detail').forEach(el => {
    el.style.display = 'none';
  });

  let detailEl = document.getElementById('detail-' + id);
  if (!detailEl) {
    // Dynamically create the container if it doesn't exist yet
    detailEl = document.createElement('div');
    detailEl.id = 'detail-' + id;
    detailEl.className = 'campaign-detail';
    document.getElementById('section-campaigns').appendChild(detailEl);
  }

  // Try fetching full detail (touchpoints, diagnostics, versions) from Supabase
  if (typeof BakalAPI !== 'undefined') {
    try {
      detailEl.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted);">Chargement...</div>';
      detailEl.style.display = 'block';

      const fullCampaign = await BakalAPI.fetchCampaignDetail(id);
      if (fullCampaign) {
        // Update BAKAL cache with full data
        BAKAL.campaigns[id] = fullCampaign;
      }
    } catch {
      // Fallback to existing BAKAL data
    }
  }

  detailEl.innerHTML = renderCampaignDetail(id);
  detailEl.style.display = 'block';
}

function backToCampaignsList() {
  document.getElementById('campaigns-list-view').style.display = 'block';
  document.querySelectorAll('.campaign-detail').forEach(el => {
    el.style.display = 'none';
  });
}

/* ═══ Helpers ═══ */
function kpi(value, label, pct, color) {
  return `<div class="campaign-kpi">
    <div class="campaign-kpi-value" style="color:${color}">${value}</div>
    <div class="campaign-kpi-label">${label}</div>
    <div class="campaign-kpi-bar"><div class="campaign-kpi-fill" style="width:${pct}%;background:${color};"></div></div>
  </div>`;
}

function modItem(ver, title, desc, resultClass, resultText, date) {
  return `<div class="mod-item">
    <div class="mod-version">${ver}</div>
    <div class="mod-content">
      <div class="mod-title">${title}</div>
      <div class="mod-desc">${desc}</div>
      <div class="mod-result ${resultClass}">${resultText}</div>
    </div>
    <div class="mod-date">${date}</div>
  </div>`;
}

function diagBlock(color, title, text) {
  return `<div style="background:var(--bg-elevated);border-radius:8px;padding:14px;border-left:3px solid var(--${color});">
    <div style="font-size:12px;font-weight:600;color:var(--${color});margin-bottom:4px;">${title}</div>
    <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${text}</div>
  </div>`;
}

function infoRow(label, content) {
  return `<div>
    <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${label}</div>
    <div style="font-size:14px;">${content}</div>
  </div>`;
}

function checkItem(icon, title, desc, status, statusColor, highlight) {
  const bg = highlight ? 'background:var(--warning-bg);border:1px solid rgba(255,170,0,0.2);' : 'background:var(--bg-elevated);';
  return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;${bg}border-radius:8px;">
    <span style="color:var(--${statusColor});font-size:18px;">${icon}</span>
    <div style="flex:1;">
      <div style="font-size:14px;font-weight:500;${statusColor === 'text-muted' ? 'color:var(--text-muted);' : ''}">${title}</div>
      <div style="font-size:12px;color:var(--text-muted);">${desc}</div>
    </div>
    <span style="font-size:12px;color:var(--${statusColor});font-weight:600;">${status}</span>
  </div>`;
}

/* ═══ Step renderer ═══ */
function renderStep(s, fade) {
  const hasStats = s.stats !== null;

  function stat(value, label, color, pct, barColor) {
    return `<div class="step-stat">
      <div class="step-stat-value" style="color:${color}">${value}</div>
      <div class="step-stat-label">${label}</div>
      ${pct !== undefined ? `<div class="step-stat-bar"><div class="step-stat-fill" style="width:${pct}%;background:${barColor || color};"></div></div>` : ''}
    </div>`;
  }

  let stats = '';
  if (!hasStats) {
    stats = stat('—', 'Pas encore lancé', 'var(--text-muted)') +
            stat('—', '', 'var(--text-muted)') +
            stat('—', '', 'var(--text-muted)');
  } else if (s.type === 'linkedin' && s.stats.accept !== undefined) {
    stats = stat(s.stats.accept + '%', 'Acceptation', 'var(--success)', s.stats.accept) +
            stat('—', '—', 'var(--text-muted)') +
            stat('0%', 'Ignore', 'var(--text-muted)', 0);
  } else if (s.type === 'linkedin') {
    stats = stat(s.stats.reply + '%', 'Réponse', s.stats.reply >= 8 ? 'var(--success)' : 'var(--warning)', s.stats.reply * 10) +
            stat(s.stats.interested || '—', s.stats.interested ? 'Intéressés' : '—', 'var(--warning)') +
            stat(s.stats.stop + '%', 'Stop', 'var(--text-muted)', s.stats.stop * 10, 'var(--danger)');
  } else {
    stats = stat(s.stats.open + '%', 'Ouverture', s.stats.open >= 50 ? 'var(--success)' : 'var(--warning)', s.stats.open) +
            stat(s.stats.reply + '%', 'Réponse', 'var(--blue)', s.stats.reply * 10) +
            stat(s.stats.stop + '%', 'Stop', 'var(--text-muted)', s.stats.stop * 10, 'var(--danger)');
  }

  const subjectHtml = s.subject ? `<div class="step-subject">Objet : ${s.subject}</div>` : '';
  const typeLabel = s.type === 'linkedin' ? s.label + ' — ' + s.subType : s.label + ' — ' + s.subType;

  return `<div class="sequence-step"${fade ? ' style="opacity:0.5;"' : ''}>
    <div class="step-indicator"><div class="step-dot ${s.type}">${s.id}</div><div class="step-label">${s.timing}</div></div>
    <div class="step-content">${subjectHtml}<div class="step-type">${typeLabel}</div><div class="step-preview">${s.body}</div></div>
    ${stats}
  </div>`;
}


/* ═══════════════════════════════════════════
   MAIN RENDER — Campaign Detail
   ═══════════════════════════════════════════ */
function renderCampaignDetail(id) {
  const c = BAKAL.campaigns[id];
  if (!c) return '<p>Campagne introuvable.</p>';

  if (c.status === 'prep') return renderPrepCampaign(c);
  return renderActiveCampaign(c);
}

/* ═══ Active campaign ═══ */
function renderActiveCampaign(c) {
  const isLinkedin = c.channel === 'linkedin';
  const iterColor = c.iteration >= 3 ? 'var(--success)' : 'var(--warning)';

  // Tags
  const tags = [
    c.channelLabel, c.sector, c.size, c.angle, c.zone,
    `<span class="campaign-tag" style="border-color:${iterColor};color:${iterColor};">Itération ${c.iteration}</span>`
  ].map(t => t.startsWith('<span') ? t : `<span class="campaign-tag">${t}</span>`).join('');

  // KPIs
  let kpisHtml;
  if (isLinkedin) {
    kpisHtml = `
      ${kpi(c.kpis.contacts, 'Prospects contactés', c.volume.sent / c.volume.planned * 100, 'var(--accent)')}
      ${kpi(c.kpis.acceptRate + '%', "Taux d'acceptation", c.kpis.acceptRate, 'var(--success)')}
      ${kpi(c.kpis.replyRate + '%', 'Taux de réponse', c.kpis.replyRate * 10, c.kpis.replyRate >= 8 ? 'var(--blue)' : 'var(--warning)')}
      ${kpi(c.kpis.interested, 'Intéressés', c.kpis.interested * 10, 'var(--warning)')}
      ${kpi(c.kpis.meetings, 'RDV obtenus', c.kpis.meetings > 0 ? c.kpis.meetings / 6 * 100 : 0, 'var(--text-secondary)')}`;
  } else {
    kpisHtml = `
      ${kpi(c.kpis.contacts, 'Prospects contactés', c.volume.sent / c.volume.planned * 100, 'var(--accent)')}
      ${kpi(c.kpis.openRate + '%', "Taux d'ouverture", c.kpis.openRate, 'var(--success)')}
      ${kpi(c.kpis.replyRate + '%', 'Taux de réponse', c.kpis.replyRate * 10, 'var(--blue)')}
      ${kpi(c.kpis.interested, 'Intéressés', c.kpis.interested * 10, 'var(--warning)')}
      ${kpi(c.kpis.meetings, 'RDV obtenus', c.kpis.meetings > 0 ? c.kpis.meetings / 6 * 100 : 0, 'var(--text-secondary)')}`;
  }

  // Sequence
  const channelIcon = isLinkedin ? '💼' : '📧';
  const channelName = isLinkedin ? 'LinkedIn' : 'email';
  const seqDays = c.sequence.map(s => s.timing).join(', ');
  const duration = c.sequence.length > 1
    ? parseInt(c.sequence[c.sequence.length - 1].timing.replace('J+', ''))
    : 0;

  const stepsHtml = c.sequence.map(s => renderStep(s, false)).join('');

  // Diagnostics
  const diagHtml = c.diagnostics.map(d => diagBlock(d.level, d.title, d.text)).join('');

  // History
  const histHtml = c.history.map(h => modItem(h.version, h.title, h.desc, h.result, h.resultText, h.date)).join('');

  // Next action
  let nextActionHtml = '';
  if (c.nextAction) {
    const actionBg = c.nextAction.type === 'testing' ? 'var(--accent-glow)' : 'var(--warning-bg)';
    const actionBorder = c.nextAction.type === 'testing' ? 'var(--border)' : 'var(--border)';
    const actionColor = c.nextAction.type === 'testing' ? 'var(--text-primary)' : 'var(--warning)';
    const actionIcon = c.nextAction.type === 'testing' ? '🧬' : '⚡';
    nextActionHtml = `<div>
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Prochaine action</div>
      <div style="background:${actionBg};border:1px solid ${actionBorder};border-radius:8px;padding:10px 14px;font-size:13px;color:${actionColor};">${actionIcon} ${c.nextAction.text}</div>
    </div>`;
  }

  // Volume bar
  const volumePct = Math.round(c.volume.sent / c.volume.planned * 100);
  const barColor = isLinkedin ? 'var(--purple)' : 'var(--accent)';

  return `
    <button class="campaign-detail-back" onclick="backToCampaignsList()">← Retour aux campagnes</button>
    <div class="campaign-detail-header">
      <div>
        <div class="campaign-detail-title">${c.name}</div>
        <div class="campaign-detail-tags">${tags}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" style="font-size:12px;padding:8px 14px;" onclick="togglePauseCampaign('${c.id}', this)">⏸ Pause</button>
        <button class="btn btn-ghost" style="font-size:12px;padding:8px 14px;" onclick="exportCampaign('${c.id}')">📥 Exporter</button>
        <button class="btn btn-primary" style="font-size:12px;padding:8px 14px;" onclick="launchABTest('${c.id}')">🧬 Lancer un test A/B</button>
      </div>
    </div>

    <div class="campaign-kpis">${kpisHtml}</div>

    <div class="sequence-card">
      <div class="sequence-header">
        <div class="sequence-title">${channelIcon} Séquence ${channelName} — ${c.sequence.length} touchpoints</div>
        <div style="font-size:12px;color:var(--text-muted);">Durée : ${duration} jours · ${seqDays}</div>
      </div>
      <div class="sequence-steps">${stepsHtml}</div>
    </div>

    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:24px;">
      <div style="font-size:15px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px;">🤖 Diagnostic par étape — Claude</div>
      <div style="display:flex;flex-direction:column;gap:12px;">${diagHtml}</div>
    </div>

    <div class="section-grid" style="grid-template-columns:1fr 1fr;">
      <div class="card">
        <div class="card-header"><div class="card-title">📜 Historique des modifications</div></div>
        <div class="card-body"><div class="mod-history">${histHtml}</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">ℹ️ Informations campagne</div></div>
        <div class="card-body"><div style="display:flex;flex-direction:column;gap:16px;">
          ${infoRow('Client', '<strong>' + c.client + '</strong>')}
          ${infoRow('Période', c.info.period)}
          <div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Volume envoyé</div>
            <div style="font-size:14px;">${c.volume.sent} / ${c.volume.planned} prospects prévus</div>
            <div style="width:100%;height:6px;background:var(--bg-elevated);border-radius:3px;margin-top:6px;overflow:hidden;">
              <div style="width:${volumePct}%;height:100%;background:${barColor};border-radius:3px;"></div>
            </div>
          </div>
          ${infoRow('Copy', '<span style="font-size:13px;color:var(--text-secondary);">' + c.info.copyDesc + '</span>')}
          ${c.lemlistRef ? infoRow('Source Lemlist', '<span style="font-family:\'JetBrains Mono\',monospace;font-size:12px;background:var(--bg-elevated);padding:2px 8px;border-radius:4px;">' + c.lemlistRef + '</span>') : ''}
          ${nextActionHtml}
        </div></div>
      </div>
    </div>`;
}


/* ═══ Prep campaign (checklist) ═══ */
function renderPrepCampaign(c) {
  // Tags
  const tags = [
    `<span class="campaign-tag">${c.channelLabel.replace('📧+💼', '📧+💼 Multi-canal')}</span>`,
    `<span class="campaign-tag">${c.sector}</span>`,
    `<span class="campaign-tag">${c.size}</span>`,
    `<span class="campaign-tag">${c.angle}</span>`,
    `<span class="campaign-tag">${c.zone}</span>`,
    `<span class="campaign-tag" style="border-color:var(--warning);color:var(--warning);">En préparation</span>`
  ].join('');

  // Checklist
  const checklistHtml = c.prepChecklist.map(ch =>
    checkItem(ch.icon, ch.title, ch.desc, ch.status, ch.statusColor, ch.highlight || false)
  ).join('');

  // Sequence preview
  const stepsHtml = c.sequence.map((s, i) => renderStep(s, i >= 3)).join('');
  const emailCount = c.sequence.filter(s => s.type === 'email').length;
  const linkedinCount = c.sequence.filter(s => s.type === 'linkedin').length;

  // Pre-launch AI recommendation
  let recoHtml = '';
  if (c.preLaunchReco) {
    recoHtml = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:24px;">
      <div style="font-size:15px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px;">🤖 Recommandation pré-lancement — Claude</div>
      <div style="background:var(--bg-elevated);border-radius:8px;padding:16px;border-left:3px solid var(--accent);line-height:1.65;">
        <div style="font-size:13px;color:var(--text-secondary);">${c.preLaunchReco.text}</div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn btn-success" style="font-size:12px;padding:8px 14px;" onclick="applyPreLaunchReco('${c.id}', this)">✅ Appliquer la suggestion</button>
          <button class="btn btn-ghost" style="font-size:12px;padding:8px 14px;" onclick="dismissPreLaunchReco(this)">❌ Garder tel quel</button>
        </div>
      </div>
    </div>`;
  }

  // Info grid
  const infoHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;">
      ${infoRow('Client', '<strong>' + c.client + '</strong>')}
      ${infoRow('Créée le', c.info.createdDate || c.startDate)}
      ${infoRow('Volume prévu', c.info.volumeDesc || c.volume.planned + ' prospects')}
      ${infoRow('Copy', '<span style="font-size:13px;color:var(--text-secondary);">' + c.info.copyDesc + '</span>')}
      ${infoRow('Canaux', '<span style="font-size:13px;color:var(--text-secondary);">' + (c.info.channelsDesc || 'Email + LinkedIn') + '</span>')}
      ${infoRow('Lancement estimé', '<span style="font-weight:600;color:var(--warning);">' + (c.info.launchEstimate || 'Non planifié') + '</span>')}
    </div>`;

  return `
    <button class="campaign-detail-back" onclick="backToCampaignsList()">← Retour aux campagnes</button>
    <div class="campaign-detail-header">
      <div>
        <div class="campaign-detail-title">${c.name}</div>
        <div class="campaign-detail-tags">${tags}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" style="font-size:12px;padding:8px 14px;" onclick="editPrepCampaign('${c.id}')">✏️ Modifier</button>
        <button class="btn btn-success" style="font-size:12px;padding:8px 14px;" onclick="launchPrepCampaign('${c.id}')">🚀 Lancer la campagne</button>
      </div>
    </div>

    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:24px;">
      <div style="font-size:15px;font-weight:600;margin-bottom:20px;display:flex;align-items:center;gap:8px;">📋 Checklist de préparation</div>
      <div style="display:flex;flex-direction:column;gap:12px;">${checklistHtml}</div>
    </div>

    <div class="sequence-card">
      <div class="sequence-header">
        <div class="sequence-title">👁️ Aperçu des séquences — En attente de validation</div>
        <div style="font-size:12px;color:var(--text-muted);">${c.sequence.length} touchpoints · Email (${emailCount}) + LinkedIn (${linkedinCount})</div>
      </div>
      <div class="sequence-steps">${stepsHtml}</div>
    </div>

    ${recoHtml}

    <div class="card">
      <div class="card-header"><div class="card-title">ℹ️ Informations campagne</div></div>
      <div class="card-body">${infoHtml}</div>
    </div>`;
}


/* ═══════════════════════════════════════════
   ACTION HANDLERS
   ═══════════════════════════════════════════ */

/* ═══ Active campaign: Pause/Resume ═══ */
function togglePauseCampaign(id, btn) {
  const c = BAKAL.campaigns[id];
  if (!c) return;

  if (c.status === 'active') {
    c.status = 'paused';
    btn.innerHTML = '▶️ Reprendre';
    btn.style.borderColor = 'var(--success)';
    btn.style.color = 'var(--success)';
    // Dim the KPI section
    const detail = document.getElementById('detail-' + id);
    if (detail) {
      detail.querySelector('.campaign-kpis').style.opacity = '0.5';
      detail.querySelector('.sequence-card').style.opacity = '0.5';
    }
  } else {
    c.status = 'active';
    btn.innerHTML = '⏸ Pause';
    btn.style.borderColor = '';
    btn.style.color = '';
    const detail = document.getElementById('detail-' + id);
    if (detail) {
      detail.querySelector('.campaign-kpis').style.opacity = '1';
      detail.querySelector('.sequence-card').style.opacity = '1';
    }
  }
}

/* ═══ Active campaign: Export to CSV ═══ */
function exportCampaign(id) {
  const c = BAKAL.campaigns[id];
  if (!c) return;

  // Build CSV content
  const rows = [['Touchpoint', 'Type', 'Timing', 'Subject', 'Body', 'Open%', 'Reply%']];
  c.sequence.forEach(s => {
    const body = s.body.replace(/<[^>]*>/g, '').replace(/\n/g, ' ');
    const subject = s.subject ? s.subject.replace(/<[^>]*>/g, '') : '';
    rows.push([
      s.id, s.type, s.timing, subject, body,
      s.stats?.open ?? '', s.stats?.reply ?? ''
    ]);
  });

  const csv = rows.map(r => r.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.name.replace(/[^a-zA-Z0-9]/g, '_')}_export.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══ Active campaign: Launch A/B test ═══ */
function launchABTest(id) {
  const c = BAKAL.campaigns[id];
  if (!c) return;

  const detail = document.getElementById('detail-' + id);
  if (!detail) return;

  // Show inline A/B test dialog
  const header = detail.querySelector('.campaign-detail-header');
  let panel = detail.querySelector('.ab-test-panel');
  if (panel) { panel.remove(); return; }

  panel = document.createElement('div');
  panel.className = 'ab-test-panel';
  panel.style.cssText = 'background:var(--bg-card);border:1px solid var(--accent);border-radius:12px;padding:24px;margin:16px 0;';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-size:15px;font-weight:600;">🧬 Configurer un test A/B</div>
      <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="this.closest('.ab-test-panel').remove()">✕ Fermer</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Touchpoint à tester</div>
        <select class="form-select" id="ab-step-select">
          ${c.sequence.map(s => `<option value="${s.id}">${s.id} — ${s.label}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Répartition</div>
        <select class="form-select">
          <option>50/50 (recommandé)</option>
          <option>70/30</option>
          <option>80/20</option>
        </select>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">
      Claude va générer une variante B automatiquement basée sur les données cross-campagne.
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" style="font-size:12px;padding:8px 14px;" onclick="confirmABTest('${id}', this)">🧬 Lancer le test</button>
      <button class="btn btn-ghost" style="font-size:12px;padding:8px 14px;" onclick="this.closest('.ab-test-panel').remove()">Annuler</button>
    </div>
  `;
  header.after(panel);
}

function confirmABTest(id, btn) {
  const panel = btn.closest('.ab-test-panel');
  const step = panel.querySelector('#ab-step-select').value;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
      <span style="font-size:20px;">🧬</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--success);">Test A/B lancé sur ${step}</div>
        <div style="font-size:12px;color:var(--text-muted);">Régénération en cours par Claude · Résultats estimés dans 5-7 jours</div>
      </div>
    </div>
  `;
  panel.style.borderColor = 'var(--success)';
  setTimeout(() => { panel.style.transition = 'opacity 0.5s'; panel.style.opacity = '0.6'; }, 3000);
}

/* ═══ Prep campaign: Edit parameters ═══ */
function editPrepCampaign(id) {
  const c = BAKAL.campaigns[id];
  if (!c) return;

  const detail = document.getElementById('detail-' + id);
  const checklist = detail.querySelector('div[style*="Checklist"]')?.parentElement;
  if (!checklist) return;

  let panel = detail.querySelector('.edit-params-panel');
  if (panel) { panel.remove(); return; }

  panel = document.createElement('div');
  panel.className = 'edit-params-panel';
  panel.style.cssText = 'background:var(--bg-card);border:1px solid var(--accent);border-radius:12px;padding:24px;margin:16px 0;';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-size:15px;font-weight:600;">✏️ Modifier les paramètres</div>
      <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;" onclick="this.closest('.edit-params-panel').remove()">✕ Fermer</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px;">
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Secteur</div>
        <input class="form-input" value="${c.sector}" id="edit-sector-${id}">
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Angle</div>
        <select class="form-select" id="edit-angle-${id}">
          ${['Douleur client','Preuve sociale','Offre directe','Contenu éducatif'].map(a => `<option${a === c.angle ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Ton</div>
        <select class="form-select" id="edit-tone-${id}">
          ${['Pro décontracté','Formel & Corporate','Direct & punchy'].map(t => `<option${t === c.tone ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <button class="btn btn-primary" style="font-size:12px;padding:8px 14px;" onclick="savePrepEdits('${id}')">💾 Sauvegarder</button>
  `;
  checklist.before(panel);
}

function savePrepEdits(id) {
  const c = BAKAL.campaigns[id];
  c.sector = document.getElementById('edit-sector-' + id).value;
  c.sectorShort = c.sector.split(' ')[0];
  c.angle = document.getElementById('edit-angle-' + id).value;
  c.tone = document.getElementById('edit-tone-' + id).value;
  c.info.copyDesc = c.tone + ' · ' + c.formality + ' · ' + c.angle + ' · FR';
  showCampaignDetail(id);
}

/* ═══ Prep campaign: Launch ═══ */
function launchPrepCampaign(id) {
  const c = BAKAL.campaigns[id];
  if (!c) return;

  // Check if sequences exist
  if (!c.sequence || c.sequence.length === 0) {
    const detail = document.getElementById('detail-' + id);
    const header = detail.querySelector('.campaign-detail-header');
    let alert = detail.querySelector('.launch-alert');
    if (alert) { alert.remove(); return; }

    alert = document.createElement('div');
    alert.className = 'launch-alert';
    alert.style.cssText = 'background:var(--danger-bg);border:1px solid rgba(255,107,107,0.3);border-radius:12px;padding:16px;margin:16px 0;display:flex;align-items:center;gap:12px;';
    alert.innerHTML = `
      <span style="font-size:18px;">⚠️</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--danger);">Impossible de lancer — séquences manquantes</div>
        <div style="font-size:12px;color:var(--text-muted);">Générez d'abord les séquences via Claude depuis l'éditeur Copy & Séquences.</div>
      </div>
      <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;margin-left:auto;" onclick="this.closest('.launch-alert').remove()">✕</button>
    `;
    header.after(alert);
    return;
  }

  // Check all checklist items
  const notDone = c.prepChecklist.filter(ch => !ch.done);
  if (notDone.length > 1) {
    // More than just "Déploiement" left
    const detail = document.getElementById('detail-' + id);
    const header = detail.querySelector('.campaign-detail-header');
    let alert = detail.querySelector('.launch-alert');
    if (alert) alert.remove();

    alert = document.createElement('div');
    alert.className = 'launch-alert';
    alert.style.cssText = 'background:var(--warning-bg);border:1px solid rgba(255,170,0,0.3);border-radius:12px;padding:16px;margin:16px 0;display:flex;align-items:center;gap:12px;';
    alert.innerHTML = `
      <span style="font-size:18px;">⏳</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--warning);">Étapes de préparation incomplètes</div>
        <div style="font-size:12px;color:var(--text-muted);">${notDone.length} étape(s) restante(s) : ${notDone.map(n => n.title).join(', ')}</div>
      </div>
      <button class="btn btn-ghost" style="font-size:11px;padding:6px 12px;margin-left:auto;" onclick="this.closest('.launch-alert').remove()">✕</button>
    `;
    header.after(alert);
    return;
  }

  // Launch!
  c.status = 'active';
  c.startDate = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  c.iteration = 1;
  c.kpis = { contacts: 0, openRate: 0, replyRate: 0, interested: 0, meetings: 0, stops: 0 };
  c.prepChecklist.forEach(ch => { ch.done = true; ch.status = 'Fait'; ch.statusColor = 'success'; ch.icon = '✅'; });
  if (typeof initFromData === 'function') initFromData();
  showCampaignDetail(id);
}

/* ═══ Pre-launch reco: Apply / Dismiss ═══ */
function applyPreLaunchReco(id, btn) {
  const recoBlock = btn.closest('div[style*="border-left:3px"]');
  if (!recoBlock) return;

  recoBlock.style.borderLeftColor = 'var(--success)';
  const actions = recoBlock.querySelector('div[style*="display:flex;gap:8px"]');
  if (actions) {
    actions.innerHTML = '<div style="font-size:12px;color:var(--success);font-weight:600;">✅ Suggestion appliquée — sera intégrée dans la génération des séquences</div>';
  }
}

function dismissPreLaunchReco(btn) {
  const recoBlock = btn.closest('div[style*="border-left:3px"]');
  if (!recoBlock) return;

  recoBlock.style.transition = 'opacity 0.3s';
  recoBlock.style.opacity = '0.4';
  const actions = recoBlock.querySelector('div[style*="display:flex;gap:8px"]');
  if (actions) {
    actions.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Suggestion ignorée</div>';
  }
}
