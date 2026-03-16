/* ═══════════════════════════════════════════════════
   BAKAL — Chat Interface
   Conversational campaign builder powered by Claude
   ═══════════════════════════════════════════════════ */

let _chatThreadId = null;
let _chatThreads = [];
let _chatSending = false;

/* ═══ Thread management ═══ */

async function loadChatThreads() {
  if (typeof BakalAPI === 'undefined' || !_backendAvailable) return;
  try {
    const data = await BakalAPI.fetchChatThreads();
    _chatThreads = data.threads || [];
    renderChatThreadList();
  } catch {
    _chatThreads = [];
    renderChatThreadList();
  }
}

async function newChatThread() {
  if (typeof BakalAPI === 'undefined' || !_backendAvailable) {
    // Offline mode — just reset the UI
    _chatThreadId = null;
    showChatWelcome();
    return;
  }
  try {
    const thread = await BakalAPI.createChatThread();
    _chatThreadId = thread.id;
    await loadChatThreads();
    showChatWelcome();
  } catch (err) {
    console.warn('Failed to create thread:', err.message);
    _chatThreadId = null;
    showChatWelcome();
  }
}

async function selectChatThread(threadId) {
  _chatThreadId = threadId;
  renderChatThreadList();

  if (typeof BakalAPI === 'undefined' || !_backendAvailable) return;
  try {
    const data = await BakalAPI.fetchChatMessages(threadId);
    const messages = data.messages || [];
    if (messages.length === 0) {
      showChatWelcome();
    } else {
      showChatMessages();
      const inner = document.getElementById('chatMessagesInner');
      inner.innerHTML = '';
      messages.forEach(m => {
        const metadata = m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : null;
        appendMessage(m.role, m.content, metadata, false);
      });
      scrollChatToBottom();
    }
  } catch (err) {
    console.warn('Failed to load thread messages:', err.message);
  }
}

async function deleteChatThread(threadId, e) {
  e.stopPropagation();
  if (typeof BakalAPI === 'undefined' || !_backendAvailable) return;
  try {
    await BakalAPI.deleteChatThread(threadId);
    if (_chatThreadId === threadId) {
      _chatThreadId = null;
      showChatWelcome();
    }
    await loadChatThreads();
  } catch (err) {
    console.warn('Failed to delete thread:', err.message);
  }
}

function renderChatThreadList() {
  const list = document.getElementById('chatThreadList');
  if (!list) return;

  if (_chatThreads.length === 0) {
    list.innerHTML = '<div style="padding:20px 12px;text-align:center;font-size:12px;color:var(--text-muted);">Aucune conversation</div>';
    return;
  }

  list.innerHTML = _chatThreads.map(t => {
    const active = t.id === _chatThreadId ? ' active' : '';
    const date = new Date(t.updated_at || t.created_at);
    const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return `<div class="chat-thread-item${active}" onclick="selectChatThread(${t.id})">
      <span class="thread-title">${escapeHtml(t.title)}</span>
      <span class="thread-date">${dateStr}</span>
      <button class="chat-thread-delete" onclick="deleteChatThread(${t.id}, event)" title="Supprimer">×</button>
    </div>`;
  }).join('');
}

/* ═══ Display helpers ═══ */

function showChatWelcome() {
  document.getElementById('chatWelcome').style.display = 'flex';
  document.getElementById('chatMessages').style.display = 'none';
  document.getElementById('chatMessagesInner').innerHTML = '';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').focus();
  renderWelcomeSuggestions();
}

function renderWelcomeSuggestions() {
  const container = document.getElementById('chatWelcomeSuggestions');
  if (!container) return;
  const suggestions = typeof getWelcomeSuggestions === 'function'
    ? getWelcomeSuggestions()
    : ['Cibler des DAF en Île-de-France', 'Optimiser ma campagne', 'Quel angle pour le secteur tech ?'];
  container.innerHTML = suggestions.map(s =>
    `<button class="chat-suggestion" onclick="sendSuggestion(this)">${s}</button>`
  ).join('');
}

function showChatMessages() {
  document.getElementById('chatWelcome').style.display = 'none';
  document.getElementById('chatMessages').style.display = 'flex';
}

function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

/* ═══ Message rendering ═══ */

function appendMessage(role, content, metadata, animate = true, files = []) {
  showChatMessages();
  const inner = document.getElementById('chatMessagesInner');

  const avatar = role === 'assistant' ? 'b' : '~';
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Format the content
  let formattedContent = content;
  if (role === 'assistant') {
    // Remove JSON code blocks from display (they become action cards)
    formattedContent = formattedContent.replace(/```json\s*[\s\S]*?```/g, '').trim();
    formattedContent = formatMarkdown(formattedContent);
  } else {
    formattedContent = escapeHtml(formattedContent);
  }

  let actionCardHtml = '';
  if (metadata && metadata.action === 'create_campaign' && metadata.campaign) {
    actionCardHtml = renderActionCard(metadata.campaign);
  }

  // Remove previous inline suggestions
  const prevSuggestions = inner.querySelectorAll('.chat-inline-suggestions');
  prevSuggestions.forEach(el => el.remove());

  // Build inline suggestions for assistant messages
  let suggestionsHtml = '';
  if (role === 'assistant' && animate && typeof getSuggestionsForContext === 'function') {
    const suggestions = getSuggestionsForContext(metadata);
    if (suggestions && suggestions.length > 0) {
      const chips = suggestions.map(s =>
        `<button class="chat-inline-chip" onclick="sendChatMessage('${escapeHtml(s.replace(/'/g, "\\'"))}')">${escapeHtml(s)}</button>`
      ).join('');
      suggestionsHtml = `<div class="chat-inline-suggestions">${chips}</div>`;
    }
  }

  const filesHtml = (files && files.length > 0) ? buildFilesHtml(files) : '';

  const msgHtml = `
    <div class="chat-msg ${role}"${animate ? ' style="animation:chatFadeIn 0.25s ease"' : ''}>
      <div class="chat-msg-avatar">${avatar}</div>
      <div class="chat-msg-body">
        <div class="chat-msg-content">${formattedContent}${filesHtml}</div>
        ${actionCardHtml}
        <div class="chat-msg-time">${timeStr}</div>
      </div>
    </div>${suggestionsHtml}`;

  inner.insertAdjacentHTML('beforeend', msgHtml);
  scrollChatToBottom();
}

function renderActionCard(campaign) {
  const params = [campaign.sector, campaign.position, campaign.size, campaign.channel, campaign.angle, campaign.zone]
    .filter(Boolean)
    .map(p => `<span class="chat-action-param">${escapeHtml(p)}</span>`)
    .join('');

  let stepsHtml = '';
  if (campaign.sequence && campaign.sequence.length > 0) {
    stepsHtml = campaign.sequence.map(s =>
      `<div class="chat-action-step">
        <div class="chat-action-step-dot ${s.type}"></div>
        <span>${escapeHtml(s.step)} — ${escapeHtml(s.label || s.type)}</span>
        <span style="color:var(--text-muted);margin-left:auto;">${escapeHtml(s.timing || '')}</span>
      </div>`
    ).join('');
    stepsHtml = `<div class="chat-action-sequence">${stepsHtml}</div>`;
  }

  // Store campaign data for the button
  const campaignJson = escapeHtml(JSON.stringify(campaign));

  return `
    <div class="chat-action-card">
      <div class="chat-action-title">Campagne prête : ${escapeHtml(campaign.name)}</div>
      <div class="chat-action-params">${params}</div>
      ${stepsHtml}
      <div class="chat-action-buttons">
        <button class="chat-action-btn primary" onclick='createCampaignFromChat(${campaignJson})'>Créer et voir la séquence →</button>
        <button class="chat-action-btn ghost" onclick="sendChatMessage('Peux-tu ajuster cette campagne ?')">Modifier</button>
      </div>
    </div>`;
}

/* ═══ Typing indicator ═══ */

function showTypingIndicator() {
  const inner = document.getElementById('chatMessagesInner');
  inner.insertAdjacentHTML('beforeend', `
    <div class="chat-typing" id="chatTyping">
      <div class="chat-msg-avatar" style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;background:var(--bg-elevated);color:var(--text-secondary);border:1px solid var(--border);">b</div>
      <div class="chat-typing-dots">
        <div class="chat-typing-dot"></div>
        <div class="chat-typing-dot"></div>
        <div class="chat-typing-dot"></div>
      </div>
    </div>`);
  scrollChatToBottom();
}

function hideTypingIndicator() {
  document.getElementById('chatTyping')?.remove();
}

/* ═══ Streaming message display ═══ */

async function streamMessage(content, metadata) {
  showChatMessages();
  const inner = document.getElementById('chatMessagesInner');

  // Remove previous inline suggestions
  const prevSuggestions = inner.querySelectorAll('.chat-inline-suggestions');
  prevSuggestions.forEach(el => el.remove());

  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Build action card if present
  let actionCardHtml = '';
  if (metadata && metadata.action === 'create_campaign' && metadata.campaign) {
    actionCardHtml = renderActionCard(metadata.campaign);
  }

  // Create the message shell with empty content
  const msgId = 'stream-' + Date.now();
  const msgHtml = `
    <div class="chat-msg assistant" style="animation:chatFadeIn 0.25s ease" id="${msgId}">
      <div class="chat-msg-avatar">b</div>
      <div class="chat-msg-body">
        <div class="chat-msg-content" id="${msgId}-content"></div>
        <div id="${msgId}-action" style="display:none;">${actionCardHtml}</div>
        <div class="chat-msg-time">${timeStr}</div>
      </div>
    </div>`;
  inner.insertAdjacentHTML('beforeend', msgHtml);
  scrollChatToBottom();

  const contentEl = document.getElementById(`${msgId}-content`);
  if (!contentEl) return;

  // Strip JSON blocks for display (action cards handle them)
  let displayContent = content.replace(/```json\s*[\s\S]*?```/g, '').trim();

  // Stream by chunks (groups of words for natural feel)
  const words = displayContent.split(/(\s+)/);
  let buffer = '';
  const chunkSize = 3; // words per chunk
  const baseDelay = 18; // ms per chunk

  for (let i = 0; i < words.length; i++) {
    buffer += words[i];
    if (i % chunkSize === chunkSize - 1 || i === words.length - 1) {
      contentEl.innerHTML = formatMarkdown(buffer);
      scrollChatToBottom();
      await new Promise(r => setTimeout(r, baseDelay + Math.random() * 12));
    }
  }

  // Show action card
  const actionEl = document.getElementById(`${msgId}-action`);
  if (actionEl && actionCardHtml) {
    actionEl.style.display = '';
  }

  // Add inline suggestions
  if (typeof getSuggestionsForContext === 'function') {
    const suggestions = getSuggestionsForContext(metadata);
    if (suggestions && suggestions.length > 0) {
      const chips = suggestions.map(s =>
        `<button class="chat-inline-chip" onclick="sendChatMessage('${escapeHtml(s.replace(/'/g, "\\'"))}')">${escapeHtml(s)}</button>`
      ).join('');
      inner.insertAdjacentHTML('beforeend', `<div class="chat-inline-suggestions">${chips}</div>`);
    }
  }

  scrollChatToBottom();
}

/* ═══ Send messages ═══ */

async function sendChatMessage(overrideText) {
  if (_chatSending) return;

  const input = document.getElementById('chatInput');
  const text = overrideText || input.value.trim();
  const attachedFiles = overrideText ? [] : [..._chatAttachedFiles];
  if (!text && attachedFiles.length === 0) return;

  // Clear input and attached files
  if (!overrideText) {
    input.value = '';
    autoResizeChatInput(input);
    _chatAttachedFiles = [];
    renderChatFilePreview();
  }

  // If no thread, create one first
  if (!_chatThreadId && typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const thread = await BakalAPI.createChatThread(text.slice(0, 60));
      _chatThreadId = thread.id;
      await loadChatThreads();
    } catch (err) {
      console.warn('Failed to create thread:', err.message);
    }
  }

  // Show user message with files
  appendMessage('user', text || 'Fichier(s) joint(s)', null, true, attachedFiles);
  showTypingIndicator();
  _chatSending = true;
  updateSendButton();

  // Try backend
  if (_chatThreadId && typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const fileNames = attachedFiles.map(f => f.name);
      const data = await BakalAPI.sendChatMessage(
        _chatThreadId,
        text || '',
        fileNames.length > 0 ? fileNames : undefined
      );
      hideTypingIndicator();
      appendMessage('assistant', data.message.content, data.message.metadata);
      // Refresh thread list (title may have changed)
      loadChatThreads();
    } catch (err) {
      hideTypingIndicator();
      appendMessage('assistant', 'Désolé, je ne peux pas répondre pour le moment. Vérifiez que le backend est démarré et que la clé API Claude est configurée.\n\n`' + err.message + '`');
    }
  } else {
    // Offline fallback — simulate response
    setTimeout(() => {
      hideTypingIndicator();
      appendMessage('assistant', 'Le backend n\'est pas connecté. Démarrez le serveur avec `cd backend && node server.js` pour activer l\'assistant IA.\n\nEn attendant, vous pouvez explorer le dashboard et les autres pages.');
    }, 800);
  }

  _chatSending = false;
  updateSendButton();
  input.focus();
}

function sendSuggestion(btn) {
  sendChatMessage(btn.textContent);
}

/* ═══ Campaign creation from chat ═══ */

async function createCampaignFromChat(campaignData) {
  // Create via backend if available
  if (_chatThreadId && typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const result = await BakalAPI.createCampaignFromChat(_chatThreadId, campaignData);

      // Add to local BAKAL data
      if (typeof BAKAL !== 'undefined' && result.campaign) {
        const id = String(result.campaign.id);
        BAKAL.campaigns[id] = {
          _backendId: result.campaign.id,
          id: id,
          name: campaignData.name,
          client: campaignData.client || 'Mon entreprise',
          status: 'prep',
          channel: campaignData.channel || 'email',
          channelLabel: campaignData.channel === 'linkedin' ? '💼 LinkedIn' : campaignData.channel === 'multi' ? '📧+💼 Multi' : '✉️ Email',
          channelColor: campaignData.channel === 'linkedin' ? 'var(--purple)' : campaignData.channel === 'multi' ? 'var(--orange)' : 'var(--blue)',
          sector: campaignData.sector || '',
          sectorShort: (campaignData.sector || '').split(' ')[0],
          position: campaignData.position || '',
          size: campaignData.size || '',
          angle: campaignData.angle || '',
          zone: campaignData.zone || '',
          tone: campaignData.tone || 'Pro décontracté',
          formality: 'Vous',
          length: 'Standard',
          cta: '',
          volume: { sent: 0, planned: 100 },
          iteration: 0,
          startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
          lemlistRef: null,
          nextAction: null,
          kpis: { contacts: 0, openRate: null, replyRate: null, interested: null, meetings: null },
          sequence: (campaignData.sequence || []).map(s => ({
            id: s.step, type: s.type, label: s.label || '', timing: s.timing || '',
            subType: '', subject: s.subject || null, body: s.body || '', stats: null,
          })),
          diagnostics: [],
          history: [],
          prepChecklist: [],
          info: { period: '', copyDesc: '', channelsDesc: '', launchEstimate: '' },
        };
        if (typeof initFromData === 'function') initFromData();
      }

      // Navigate to copy editor
      appendMessage('assistant', `Campagne **"${campaignData.name}"** créée avec succès ! Vous allez être redirigé vers l'éditeur de séquences.`);
      setTimeout(() => {
        showPage('copyeditor');
      }, 1200);
      return;
    } catch (err) {
      appendMessage('assistant', 'Erreur lors de la création : `' + err.message + '`. Essayez de créer la campagne manuellement.');
      return;
    }
  }

  // Offline fallback
  appendMessage('assistant', 'Le backend n\'est pas connecté. Vous pouvez créer cette campagne manuellement via le bouton **+ Nouvelle campagne** du dashboard.');
}

/* ═══ Input handling ═══ */

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function autoResizeChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function updateSendButton() {
  const btn = document.getElementById('chatSendBtn');
  if (btn) btn.disabled = _chatSending;
}

/* ═══ Action button starters ═══ */

function startChatAction(action) {
  const prompts = {
    create: 'Je veux créer une nouvelle campagne de prospection. Guide-moi étape par étape.',
    optimize: 'Je veux optimiser une de mes campagnes existantes qui sous-performe. Quelles campagnes puis-je améliorer ?',
    analyze: 'Peux-tu analyser les performances de mes campagnes actives et me donner un diagnostic ?',
  };
  const text = prompts[action];
  if (text) sendChatMessage(text);
}

/* ═══ AI status check ═══ */

async function updateAiStatus() {
  const badge = document.getElementById('aiStatusBadge');
  if (!badge) return;
  if (typeof BakalAPI !== 'undefined' && _backendAvailable) {
    badge.className = 'ai-status';
    badge.innerHTML = '<span class="ai-pulse"></span>Online';
  } else {
    badge.className = 'ai-status offline';
    badge.innerHTML = '<span class="ai-pulse"></span>Offline';
  }
}

/* ═══ User dropdown ═══ */

function toggleUserDropdown() {
  const dd = document.getElementById('userDropdown');
  const card = document.getElementById('userCard');
  dd.classList.toggle('open');
  card.classList.toggle('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const footer = document.querySelector('.sidebar-footer');
  if (footer && !footer.contains(e.target)) {
    const dd = document.getElementById('userDropdown');
    const card = document.getElementById('userCard');
    if (dd) dd.classList.remove('open');
    if (card) card.classList.remove('open');
  }
});

/* ═══ Sidebar campaign toggle ═══ */

function toggleSidebarCampaigns(e) {
  e.stopPropagation();
  const toggle = document.getElementById('campaignsToggle');
  const list = document.getElementById('sidebarCampaignList');
  if (!toggle || !list) return;
  const isOpen = toggle.classList.toggle('open');
  list.classList.toggle('open', isOpen);
  // Clicking the text (not just chevron) also navigates to campaigns
  if (isOpen) showPage('dashboard', 'campaigns');
}

/* ═══ Sidebar campaign list ═══ */

function renderSidebarCampaigns() {
  const container = document.getElementById('sidebarCampaignList');
  if (!container) return;
  if (typeof BAKAL === 'undefined' || !BAKAL.campaigns) {
    container.innerHTML = '';
    return;
  }
  const campaigns = Object.values(BAKAL.campaigns);
  const projects = Object.values(BAKAL.projects || {});
  if (campaigns.length === 0 && projects.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  if (projects.length > 0) {
    projects.forEach(p => {
      const pCampaigns = campaigns.filter(c => c.projectId === p.id);
      const shortName = p.name.length > 20 ? p.name.slice(0, 20) + '…' : p.name;
      html += '<div class="nav-project-group">';
      html += '<div class="nav-project-label" onclick="showPage(\'dashboard\',\'campaigns\')">';
      html += '<span class="nav-project-dot" style="background:' + p.color + '"></span>' + shortName;
      html += '</div>';
      pCampaigns.slice(0, 4).forEach(c => {
        const cName = (c.name || c.id);
        const cShort = cName.length > 20 ? cName.slice(0, 20) + '…' : cName;
        html += '<div class="nav-campaign-item" onclick="showPage(\'dashboard\',\'campaigns\')">' + cShort + '</div>';
      });
      html += '</div>';
    });
    // Orphan campaigns
    const orphans = campaigns.filter(c => !c.projectId);
    orphans.slice(0, 3).forEach(c => {
      const name = (c.name || c.id);
      const shortName = name.length > 22 ? name.slice(0, 22) + '…' : name;
      html += '<div class="nav-campaign-item" onclick="showPage(\'dashboard\',\'campaigns\')">' + shortName + '</div>';
    });
  } else {
    // Fallback: flat list
    campaigns.slice(0, 6).forEach(c => {
      const name = c.name || c.id;
      const shortName = name.length > 22 ? name.slice(0, 22) + '…' : name;
      html += '<div class="nav-campaign-item" onclick="showPage(\'dashboard\',\'campaigns\')">' + shortName + '</div>';
    });
  }
  container.innerHTML = html;
}

/* ═══ Stack status check ═══ */

async function updateStackStatus() {
  // Claude API status
  const claudeDot = document.getElementById('stackClaude');
  if (claudeDot && typeof BakalAPI !== 'undefined' && _backendAvailable) {
    try {
      const health = await BakalAPI.request('/health');
      const services = health.services || {};
      claudeDot.className = services.claude ? 'stack-dot online' : 'stack-dot offline';
    } catch {
      claudeDot.className = 'stack-dot offline';
    }
  }
  // N8N status — pending until we have real check
  const n8nDot = document.getElementById('stackN8n');
  if (n8nDot) n8nDot.className = 'stack-dot pending';
}

/* ═══ Init ═══ */

function initChat() {
  loadChatThreads();
  // Auto-select latest thread or show welcome
  if (_chatThreads.length > 0 && !_chatThreadId) {
    selectChatThread(_chatThreads[0].id);
  } else {
    showChatWelcome();
  }
  document.getElementById('chatInput')?.focus();
  updateAiStatus();
  renderSidebarCampaigns();
  updateStackStatus();
}

/* ═══ Formatting helpers ═══ */

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  // Bullet lists
  html = html.replace(/(?:^|<br>)- (.+?)(?=<br>|<\/p>|$)/g, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Numbered lists
  html = html.replace(/(?:^|<br>)\d+\. (.+?)(?=<br>|<\/p>|$)/g, '<li>$1</li>');

  return '<p>' + html + '</p>';
}

/* ═══ Chat File Attachments ═══ */

let _chatAttachedFiles = [];
const CHAT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
const CHAT_ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.md', '.txt', '.png', '.jpg', '.jpeg', '.svg', '.xlsx', '.csv'];

function handleChatFileSelect(e) {
  const files = Array.from(e.target.files);
  addChatFiles(files);
  e.target.value = '';
}

function addChatFiles(files) {
  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!CHAT_ALLOWED_EXTENSIONS.includes(ext)) {
      appendMessage('assistant', `Le fichier **${escapeHtml(file.name)}** n'est pas supporté. Formats acceptés : ${CHAT_ALLOWED_EXTENSIONS.join(', ')}`);
      continue;
    }
    if (file.size > CHAT_MAX_FILE_SIZE) {
      appendMessage('assistant', `Le fichier **${escapeHtml(file.name)}** dépasse la limite de 10 Mo.`);
      continue;
    }
    if (_chatAttachedFiles.some(f => f.name === file.name && f.size === file.size)) continue;
    _chatAttachedFiles.push(file);
  }
  renderChatFilePreview();
}

function removeChatFile(index) {
  _chatAttachedFiles.splice(index, 1);
  renderChatFilePreview();
}

function renderChatFilePreview() {
  const container = document.getElementById('chatFilesPreview');
  if (!container) return;
  if (_chatAttachedFiles.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = _chatAttachedFiles.map((f, i) => {
    const icon = getFileIcon(f.name);
    const size = formatFileSize(f.size);
    return `<div class="chat-file-chip">
      <span>${icon}</span>
      <span class="chat-file-chip-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span style="color:var(--text-muted);font-size:11px;">${size}</span>
      <span class="chat-file-chip-remove" onclick="removeChatFile(${i})">×</span>
    </div>`;
  }).join('');
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf: '📄', docx: '📝', doc: '📝', md: '📋', txt: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', svg: '🖼', xlsx: '📊', csv: '📊' };
  return icons[ext] || '📎';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

/* ── Drag & drop on chat area ── */

function initChatDragDrop() {
  const chatMain = document.querySelector('.chat-main');
  if (!chatMain) return;
  let dragCounter = 0;

  chatMain.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    document.getElementById('chatDropOverlay').style.display = 'flex';
  });

  chatMain.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.getElementById('chatDropOverlay').style.display = 'none';
    }
  });

  chatMain.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  chatMain.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.getElementById('chatDropOverlay').style.display = 'none';
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addChatFiles(files);
  });
}

/* ── Show files in sent message ── */

function buildFilesHtml(files) {
  if (!files || files.length === 0) return '';
  const chips = files.map(f =>
    `<div class="chat-msg-file">${getFileIcon(f.name)} <span>${escapeHtml(f.name)}</span> <span style="color:var(--text-muted);font-size:11px;">${formatFileSize(f.size)}</span></div>`
  ).join('');
  return `<div class="chat-msg-files">${chips}</div>`;
}

// Patch initChat to set up drag & drop
const _origInitChat = initChat;
initChat = function() {
  _origInitChat();
  initChatDragDrop();
};
