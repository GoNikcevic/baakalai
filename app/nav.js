/* ═══════════════════════════════════════════════════
   BAKAL — Navigation, Modals & Creator Form
   ═══════════════════════════════════════════════════ */

/* ═══ Reco filter toggles ═══ */
document.querySelectorAll('.reco-filter').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.reco-filter').forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    const filterText = this.textContent.replace(/\d+/g, '').trim();
    const cards = document.querySelectorAll('.reco-card');

    cards.forEach(card => {
      const badge = card.querySelector('.reco-priority-badge');
      const campaign = card.querySelector('.reco-card-campaign')?.textContent || '';
      const badgeText = badge?.textContent.trim() || '';
      let show = true;

      if (filterText === 'Toutes') {
        show = true;
      } else if (filterText === 'Critiques') {
        show = card.classList.contains('priority-critical');
      } else if (filterText === 'Importantes') {
        show = card.classList.contains('priority-important');
      } else if (filterText === 'Suggestions') {
        show = card.classList.contains('priority-suggestion');
      } else if (filterText === 'Appliquées') {
        show = card.classList.contains('priority-applied') || badgeText === 'Appliquée';
      } else {
        // Campaign name filter
        show = campaign.includes(filterText);
      }

      card.style.display = show ? 'block' : 'none';
    });
  });
});

/* ═══ Modals ═══ */
function toggleCreator() {
  document.getElementById('creatorModal').classList.toggle('show');
  // Reset footer to default state when opening
  if (document.getElementById('creatorModal').classList.contains('show')) {
    resetCreatorFooter();
    populateProjectSelector();
  }
}

function toggleInspiration() {
  // Close creator modal and redirect to chat with a pre-filled inspiration request
  toggleCreator();
  resetCreatorForm();
  showPage('chat');

  // Wait for chat to initialize, then send a pre-filled message
  setTimeout(() => {
    const input = document.getElementById('chatInput');
    if (input) {
      const message = 'Aide-moi à créer une campagne. Propose-moi une cible et un angle basés sur ce qui fonctionne le mieux.';
      input.value = message;
      if (typeof autoResizeChatInput === 'function') autoResizeChatInput(input);
      // Auto-send the message
      if (typeof sendChatMessage === 'function') sendChatMessage();
    }
  }, 300);
}

/* ═══ Section navigation (dashboard — single view, campaigns detail) ═══ */
function showSection(name) {
  ['overview', 'campaigns'].forEach(s => {
    const el = document.getElementById('section-' + s);
    if (el) el.style.display = s === name ? 'block' : 'none';
  });
  if (name === 'campaigns') backToCampaignsList();
}

/* ═══ Page-level navigation ═══ */
function showPage(page, section) {
  const dashEls = ['section-overview','section-campaigns'];
  const dashHeader = document.querySelector('.main > .page-header');
  const allPages = ['page-chat','page-copyeditor','page-recos','page-profil','page-settings','page-refinement'];

  // Hide all standalone pages
  allPages.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Helper: hide dashboard elements
  function hideDash() {
    dashHeader.style.display = 'none';
    dashEls.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  }

  if (page === 'chat') {
    hideDash();
    document.getElementById('page-chat').style.display = 'block';
    if (typeof initChat === 'function') initChat();
  } else if (page === 'copyeditor') {
    hideDash();
    document.getElementById('page-copyeditor').style.display = 'block';
    if (typeof initCopyEditor === 'function') initCopyEditor();
  } else if (page === 'refinement') {
    hideDash();
    document.getElementById('page-refinement').style.display = 'block';
    if (typeof initVarGenerator === 'function') initVarGenerator();
  } else if (page === 'profil') {
    hideDash();
    document.getElementById('page-profil').style.display = 'block';
  } else if (page === 'settings') {
    hideDash();
    document.getElementById('page-settings').style.display = 'block';
  } else {
    // Dashboard — show header + overview (single view, no tabs)
    dashHeader.style.display = 'flex';
    showSection(section || 'overview');
  }

  // Update active nav item
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    const text = item.textContent;
    if (page === 'chat' && text.includes('Assistant')) item.classList.add('active');
    if (page === 'copyeditor' && text.includes('Copy')) item.classList.add('active');
    if (page === 'dashboard' && text.includes('Dashboard')) item.classList.add('active');
    if (page === 'refinement' && text.includes('Refinement')) item.classList.add('active');
    if (page === 'profil' && text.includes('Profil')) item.classList.add('active');
    if (page === 'settings' && text.includes('Paramètres')) item.classList.add('active');
    if (page === 'dashboard' && section === 'campaigns' && text.includes('Campagnes') && !text.includes('Dashboard')) item.classList.add('active');
  });

  // Update mobile nav active state
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.remove('active');
    const txt = btn.textContent.trim();
    if (page === 'chat' && txt.includes('Chat')) btn.classList.add('active');
    if (page === 'dashboard' && txt.includes('Dashboard')) btn.classList.add('active');
    if (page === 'copyeditor' && txt.includes('Copy')) btn.classList.add('active');
    if (page === 'refinement' && txt.includes('Refine')) btn.classList.add('active');
    if (page === 'settings' && txt.includes('Config')) btn.classList.add('active');
  });
}

/* ═══ Project Creator ═══ */
function toggleProjectCreator() {
  document.getElementById('projectCreatorModal').classList.toggle('show');
  if (document.getElementById('projectCreatorModal').classList.contains('show')) {
    // Reset footer
    document.getElementById('projectCreatorFooter').innerHTML = `
      <button class="btn btn-ghost" onclick="toggleProjectCreator()">Annuler</button>
      <button class="btn btn-primary" onclick="createProject()">📁 Créer le projet</button>
    `;
    // Pre-fill client from profile if available
    const profile = JSON.parse(localStorage.getItem('bakal_profile') || '{}');
    const clientInput = document.getElementById('project-creator-client');
    if (clientInput && !clientInput.value && profile.company) {
      clientInput.value = profile.company;
    }
  }
}

async function createProject() {
  const name = document.getElementById('project-creator-name').value.trim();
  const client = document.getElementById('project-creator-client').value.trim();
  const description = document.getElementById('project-creator-desc').value.trim();
  const color = document.getElementById('project-creator-color').value;

  if (!name) {
    const input = document.getElementById('project-creator-name');
    input.style.boxShadow = '0 0 0 2px var(--danger)';
    input.placeholder = 'Veuillez nommer votre projet';
    input.focus();
    input.addEventListener('input', function handler() {
      input.style.boxShadow = '';
      input.placeholder = 'Ex: FormaPro Consulting — Q1 2026';
      input.removeEventListener('input', handler);
    });
    return;
  }

  const id = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Persist to backend
  let backendId = null;
  if (typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const res = await BakalAPI.request('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, client, description, color }),
      });
      backendId = res.id;
    } catch (err) {
      console.warn('Backend project create failed:', err.message);
      if (typeof showToast === 'function') showToast('Erreur serveur — projet sauvé localement', 'warning');
    }
  }

  const today = new Date();
  const projectId = backendId ? String(backendId) : id;

  if (typeof BAKAL !== 'undefined') {
    BAKAL.projects[projectId] = {
      id: projectId,
      name,
      client: client || name,
      description: description || '',
      color,
      createdDate: today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
      campaignIds: [],
      files: []
    };
    initFromData();
    populateProjectSelector();
  }

  // Success feedback
  const footer = document.getElementById('projectCreatorFooter');
  footer.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex:1;">
      <span style="font-size:18px;">✅</span>
      <div>
        <div style="font-weight:600;font-size:14px;">Projet « ${name} » créé</div>
        <div style="font-size:12px;color:var(--text-muted);">${client || 'Pas de client'} · ${description || 'Pas de description'}</div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="toggleProjectCreator(); document.getElementById('project-creator-name').value=''; document.getElementById('project-creator-client').value=''; document.getElementById('project-creator-desc').value='';">Fermer</button>
  `;

  // Announce in chat
  if (typeof announceChatEvent === 'function') {
    announceChatEvent(`📁 Projet « ${name} » créé${client ? ` pour ${client}` : ''}.`);
  }
}

function populateProjectSelector() {
  const sel = document.getElementById('creator-project');
  if (!sel || typeof BAKAL === 'undefined') return;
  const projects = Object.values(BAKAL.projects || {});
  sel.innerHTML = '<option value="">— Aucun projet —</option>'
    + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

/* ═══ Creator form ═══ */
function getCreatorFormValues() {
  return {
    name:     document.getElementById('creator-name').value.trim(),
    projectId: document.getElementById('creator-project').value || null,
    sector:   document.getElementById('creator-sector').value,
    position: document.getElementById('creator-position').value,
    size:     document.getElementById('creator-size').value,
    zone:     document.getElementById('creator-zone').value,
    tone:     document.getElementById('creator-tone').value,
    channel:  document.getElementById('creator-channel').value,
    angle:    document.getElementById('creator-angle').value,
    volume:   document.getElementById('creator-volume').value
  };
}

function resetCreatorForm() {
  document.getElementById('creator-name').value = '';
  document.getElementById('creator-sector').selectedIndex = 0;
  document.getElementById('creator-position').selectedIndex = 0;
  document.getElementById('creator-size').selectedIndex = 0;
  document.getElementById('creator-zone').selectedIndex = 0;
  document.getElementById('creator-tone').selectedIndex = 0;
  document.getElementById('creator-channel').selectedIndex = 0;
  document.getElementById('creator-angle').selectedIndex = 0;
  document.getElementById('creator-volume').selectedIndex = 0;
}

function resetCreatorFooter() {
  const footer = document.getElementById('creatorFooter');
  footer.innerHTML = `
    <button class="btn btn-ghost" onclick="toggleCreator()">Annuler</button>
    <button class="btn btn-primary" onclick="createCampaign()">🚀 Créer la campagne</button>
  `;
}

async function createCampaign() {
  const values = getCreatorFormValues();

  // Validate name
  if (!values.name) {
    const nameInput = document.getElementById('creator-name');
    nameInput.style.boxShadow = '0 0 0 2px var(--danger)';
    nameInput.placeholder = 'Veuillez nommer votre campagne';
    nameInput.focus();
    nameInput.addEventListener('input', function handler() {
      nameInput.style.boxShadow = '';
      nameInput.placeholder = 'Ex: DRH PME Lyon — Mars 2026';
      nameInput.removeEventListener('input', handler);
    });
    return;
  }

  // Generate a slug ID from the campaign name
  const id = values.name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Map channel value to data format
  const channelMap = {
    'Email uniquement': { channel: 'email', label: '✉️ Email', color: 'var(--blue)' },
    'LinkedIn uniquement': { channel: 'linkedin', label: '💼 LinkedIn', color: 'var(--purple)' },
    'Email + LinkedIn': { channel: 'multi', label: '📧+💼 Multi', color: 'var(--orange)' }
  };
  const ch = channelMap[values.channel] || channelMap['Email + LinkedIn'];

  // Resolve client name from project or profile (never hardcode)
  let clientName = '';
  if (values.projectId && typeof BAKAL !== 'undefined' && BAKAL.projects[values.projectId]) {
    clientName = BAKAL.projects[values.projectId].client || BAKAL.projects[values.projectId].name;
  }
  if (!clientName) {
    const profile = JSON.parse(localStorage.getItem('bakal_profile') || '{}');
    clientName = profile.company || '';
  }

  // Persist to backend if available
  let backendId = null;
  let backendError = false;
  if (typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const created = await BakalAPI.createCampaign(values);
      backendId = created.id;
    } catch (err) {
      console.warn('Backend create failed:', err.message);
      backendError = true;
    }
  }

  // Add campaign to BAKAL data layer
  if (typeof BAKAL !== 'undefined') {
    const today = new Date();
    const dateStr = today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

    BAKAL.campaigns[backendId || id] = {
      _backendId: backendId,
      id: backendId ? String(backendId) : id,
      name: values.name,
      projectId: values.projectId || null,
      client: clientName,
      status: 'prep',
      channel: ch.channel,
      channelLabel: ch.label,
      channelColor: ch.color,
      sector: values.sector,
      sectorShort: values.sector.split(' ')[0],
      position: values.position,
      size: values.size,
      angle: values.angle,
      zone: values.zone,
      tone: values.tone,
      formality: 'Vous',
      length: 'Standard',
      cta: 'Question ouverte',
      volume: { sent: 0, planned: values.volume === 'Agressif (~200/semaine)' ? 200 : values.volume === 'Modéré (~50/semaine)' ? 50 : 100 },
      iteration: 0,
      startDate: dateStr,
      lemlistRef: null,
      nextAction: null,
      kpis: { contacts: 0, openRate: null, replyRate: null, interested: null, meetings: null },
      sequence: [],
      diagnostics: [],
      prepChecklist: [
        { icon: '⬜', title: 'Paramètres de campagne configurés', desc: 'Cible, canal, angle, ton — tout est défini', status: 'Fait', statusColor: 'success', done: true },
        { icon: '⬜', title: 'Séquences à générer par Claude', desc: 'En attente de génération IA', status: 'À faire', statusColor: 'text-muted', done: false },
        { icon: '⬜', title: 'Liste de prospects à importer', desc: 'Import Lemlist en attente', status: 'À faire', statusColor: 'text-muted', done: false },
        { icon: '⬜', title: 'Validation par le client', desc: 'Après génération des séquences', status: 'À faire', statusColor: 'text-muted', done: false },
        { icon: '⬜', title: 'Déploiement sur Lemlist', desc: 'Automatique après validation', status: 'À faire', statusColor: 'text-muted', done: false }
      ],
      history: [],
      info: {
        createdDate: today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
        period: dateStr,
        copyDesc: values.tone + ' · Vous · ' + values.angle + ' · FR',
        channelsDesc: values.channel,
        launchEstimate: 'Non planifié'
      }
    };

    // Link campaign to project
    if (values.projectId && BAKAL.projects[values.projectId]) {
      const proj = BAKAL.projects[values.projectId];
      if (!proj.campaignIds) proj.campaignIds = [];
      proj.campaignIds.push(backendId ? String(backendId) : id);
    }

    // Re-render all sections (handles empty→populated transition)
    initFromData();
  }

  // Show success/warning state in footer
  const footer = document.getElementById('creatorFooter');
  const projectLabel = values.projectId && BAKAL.projects[values.projectId] ? ` → ${BAKAL.projects[values.projectId].name}` : '';
  const icon = backendError ? '⚠️' : '✅';
  const warningLine = backendError ? '<div style="font-size:11px;color:var(--orange);margin-top:2px;">Sauvegarde serveur échouée — données locales uniquement</div>' : '';
  footer.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex:1;">
      <span style="font-size:18px;">${icon}</span>
      <div>
        <div style="font-weight:600;font-size:14px;">Campagne « ${values.name} » créée${projectLabel}</div>
        <div style="font-size:12px;color:var(--text-muted);">${values.channel} · ${values.sector} · ${values.angle} · ${values.zone}</div>
        ${warningLine}
      </div>
    </div>
    <button class="btn btn-primary" onclick="toggleCreator(); resetCreatorForm();">Fermer</button>
  `;
}
