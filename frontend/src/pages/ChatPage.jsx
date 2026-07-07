/* ===============================================================================
   BAKAL — Chat Page (React)
   Conversational campaign builder powered by Claude.
   Ported from /app/chat.js — full React hooks implementation.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useSocket } from '../context/SocketContext';
import api, { request } from '../services/api-client';
import { sanitizeHtml } from '../services/sanitize';
import Confetti from '../components/Confetti';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { useT, useI18n } from '../i18n';

/* ─── Helpers ─── */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function getDefaultSuggestions(lang) {
  return lang === 'en'
    ? ['🎯 Create a prospecting campaign', '📡 Scan for buying signals', '🔍 Analyze my CRM health', '📊 Show my campaign performance']
    : ['🎯 Cr\u00e9er une campagne de prospection', '📡 Scanner les signaux d\'achat', '🔍 Analyser la sant\u00e9 de mon CRM', '📊 Voir les performances de mes campagnes'];
}

function getOnboardingSuggestions(lang) {
  return lang === 'en'
    ? ['📄 Help me set up my profile', '🎯 Create my first campaign', '❓ How does baakalai work?', '🧠 Help me define my ICP']
    : ['📄 Aide-moi \u00e0 configurer mon profil', '🎯 Cr\u00e9er ma premi\u00e8re campagne', '❓ Comment fonctionne baakalai ?', '🧠 Aide-moi \u00e0 d\u00e9finir mon ICP'];
}

function getReturningSuggestions(lang) {
  return lang === 'en'
    ? ['🎯 Create a new campaign', '⚡ Activate stagnant deals', '🔍 Scan my CRM health', '📊 Analyze my performance']
    : ['🎯 Nouvelle campagne', '⚡ Relancer les deals stagnants', '🔍 Scanner la santé de mon CRM', '📊 Analyser mes performances'];
}

function getActionPrompts(lang) {
  if (lang === 'en') return {
    create: 'I want to create a new prospecting campaign. Guide me step by step.',
    refine: 'I want to refine one of my underperforming campaigns. Which ones can I improve?',
    analyze: 'Can you analyze the performance of my active campaigns and give me a diagnostic?',
    setup_profile: 'I just signed up. Help me set up my company profile to personalize my campaigns.',
    explore: 'Explain baakalai\'s features and how to get the most out of the platform.',
    create_from_insights: 'You\'ve analyzed my previous campaigns and identified patterns that work. Create a new refined campaign based on these insights and cross-campaign memory. Suggest the best angle, tone and sequence based on what worked.',
  };
  return {
    create: 'Je veux cr\u00E9er une nouvelle campagne de prospection. Guide-moi \u00E9tape par \u00E9tape.',
    refine: 'Je veux affiner une de mes campagnes existantes qui sous-performe. Quelles campagnes puis-je am\u00E9liorer ?',
    analyze: 'Peux-tu analyser les performances de mes campagnes actives et me donner un diagnostic ?',
    setup_profile: 'Je viens de m\'inscrire. Aide-moi \u00E0 configurer mon profil entreprise pour personnaliser mes campagnes.',
    explore: 'Explique-moi les fonctionnalit\u00E9s de baakalai et comment tirer le meilleur parti de la plateforme.',
    create_from_insights: 'Tu as analys\u00E9 mes campagnes pr\u00E9c\u00E9dentes et identifi\u00E9 des patterns qui fonctionnent. Cr\u00E9e-moi une nouvelle campagne affin\u00E9e en t\'appuyant sur ces insights et la m\u00E9moire cross-campagne.',
  };
}

function getCampaignTemplates(t) {
  return [
    { label: t('chat.templateSaas'), desc: t('chat.templateSaasDesc'), prompt: 'Create a B2B SaaS prospecting campaign. Target: CTO and VP Engineering at startups/scale-ups 50-500 employees. Channel: multi (email + LinkedIn). Tone: professional but casual. Angle: ROI and time saved. Generate the full sequence.' },
    { label: t('chat.templateMeeting'), desc: t('chat.templateMeetingDesc'), prompt: 'Create a short email campaign (3 touchpoints) to book a 15-minute meeting. Direct and concise tone. Each email under 5 lines. CTA is always a time slot proposal. Use my profile info to personalize.' },
    { label: t('chat.templateReactivation'), desc: t('chat.templateReactivationDesc'), prompt: 'Create an email reactivation sequence for existing clients who haven\'t been contacted in 3+ months. Warm tone, not salesy. Goal: re-establish contact and propose a check-in. 3 touchpoints spaced 7 days apart.' },
    { label: t('chat.templateRecruiting'), desc: t('chat.templateRecruitingDesc'), prompt: 'Create a multi-channel sequence (LinkedIn + email) to recruit tech profiles. Start with a personalized LinkedIn invite (max 300 chars), then a LinkedIn message, then an email. Tone: informal, appreciative. No corporate HR tone.' },
    { label: t('chat.templatePartnership'), desc: t('chat.templatePartnershipDesc'), prompt: 'Create an email sequence to propose a partnership or collaboration with complementary companies. Tone: peer-to-peer, not salesy. Goal: an exploratory call. 3 emails spaced 5 days apart. Highlight mutual benefit.' },
  ];
}

/* ─── Sub-components ─── */

function AiStatusBadge({ online }) {
  return (
    <div className={`ai-status${online ? '' : ' offline'}`}>
      <span className="ai-pulse"></span>
      {online ? 'Online' : 'Offline'}
    </div>
  );
}

function ThreadList({ threads, currentThreadId, onSelect, onDelete, onNew }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  return (
    <div className="chat-thread-list" id="chatThreadList">
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: '12px', padding: '8px 12px' }}
          onClick={onNew}
        >
          + {en ? 'New conversation' : 'Nouvelle conversation'}
        </button>
      </div>
      {threads.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
          {en ? 'No conversations' : 'Aucune conversation'}
        </div>
      ) : (
        threads.map((t) => {
          const active = t.id === currentThreadId ? ' active' : '';
          const date = new Date(t.updated_at || t.created_at);
          const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          return (
            <div
              key={t.id}
              className={`chat-thread-item${active}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="thread-title">{t.title}</span>
              <span className="thread-date">{dateStr}</span>
              <button
                className="chat-thread-delete"
                onClick={(e) => onDelete(t.id, e)}
                title={en ? 'Delete' : 'Supprimer'}
              >
                x
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function ActionCard({ metadata, onCreateCampaign, onModify, onActionExecute, onPreview }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const action = metadata?.action;

  // Create campaign card
  if (action === 'create_campaign' && metadata.campaign) {
    return <CreateCampaignCard campaign={metadata.campaign} onCreateCampaign={onCreateCampaign} onModify={onModify} onPreview={onPreview} />;
  }

  // Update campaign card
  if (action === 'update_campaign') {
    const changes = metadata.changes || {};
    const changeList = Object.entries(changes).map(([k, v]) => `${k}: ${v}`);
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">{en ? 'Edit: ' : 'Modifier : '}{metadata.campaignName || ''}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '8px 0' }}>
          {changeList.map((c, i) => <div key={i}>{c}</div>)}
        </div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            {en ? 'Apply changes' : 'Appliquer les modifications'}
          </button>
          <button className="chat-action-btn ghost" onClick={onModify}>
            {en ? 'Edit' : 'Modifier'}
          </button>
        </div>
      </div>
    );
  }

  // Analyze campaign card
  if (action === 'analyze_campaign') {
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">{en ? 'Analyze: ' : 'Analyser : '}{metadata.campaignName || ''}</div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            {en ? 'Run analysis' : 'Lancer l\'analyse'}
          </button>
        </div>
      </div>
    );
  }

  // Regenerate touchpoints card
  if (action === 'regenerate_touchpoints') {
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">{en ? 'Regenerate: ' : 'Régénérer : '}{metadata.campaignName || ''}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '8px 0' }}>
          Touchpoints: {(metadata.steps || []).join(', ')}
        </div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            {en ? 'Regenerate touchpoints' : 'Régénérer les touchpoints'}
          </button>
          <button className="chat-action-btn ghost" onClick={onModify}>
            {en ? 'Edit' : 'Modifier'}
          </button>
        </div>
      </div>
    );
  }

  // Show diagnostic card
  if (action === 'show_diagnostic') {
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">{en ? 'Diagnostic: ' : 'Diagnostic : '}{metadata.campaignName || ''}</div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            {en ? 'View full diagnostic' : 'Voir le diagnostic complet'}
          </button>
        </div>
      </div>
    );
  }

  // Search prospects card (dispatches to chosen source)
  if (action === 'search_prospects') {
    return <ProspectSearchCard metadata={metadata} onActionExecute={onActionExecute} />;
  }

  // Choose prospect source card (when multiple outreach tools configured)
  if (action === 'choose_prospect_source') {
    return <ChooseSourceCard metadata={metadata} onActionExecute={onActionExecute} />;
  }

  // Add manually pasted/CSV prospects (when the user drops a list in chat)
  if (action === 'add_prospects_manual') {
    return <AddProspectsManualCard metadata={metadata} onActionExecute={onActionExecute} />;
  }

  // Deep web search for contacts at specific companies
  if (action === 'web_search_prospects') {
    return <WebSearchProspectsCard metadata={metadata} onActionExecute={onActionExecute} />;
  }

  // CRM / Activation actions
  if (action === 'send_email') {
    return <SendEmailCard metadata={metadata} />;
  }
  if (action === 'scan_crm') {
    return <CrmActionCard metadata={metadata} actionType="scan_crm" label={en ? 'Scan CRM' : 'Scanner le CRM'} icon={'\uD83D\uDD0D'} />;
  }
  if (action === 'run_nurture') {
    return <CrmActionCard metadata={metadata} actionType="run_nurture" label={en ? 'Run activation' : 'Lancer l\'activation'} icon={'\u26A1'} />;
  }
  if (action === 'import_crm') {
    return <CrmActionCard metadata={metadata} actionType="import_crm" label={en ? 'Import from CRM' : 'Importer depuis le CRM'} icon={'\u2B07\uFE0F'} />;
  }
  if (action === 'clean_crm') {
    return <CrmActionCard metadata={metadata} actionType="clean_crm" label={en ? 'Clean CRM data' : 'Nettoyer le CRM'} icon={'\uD83E\uDDF9'} />;
  }
  if (action === 'list_clients') {
    return <ListClientsCard metadata={metadata} />;
  }
  if (action === 'create_trigger') {
    return <CreateTriggerCard metadata={metadata} />;
  }
  if (action === 'toggle_autopilot') {
    return <ToggleAutopilotCard metadata={metadata} />;
  }
  if (action === 'search_signals') {
    return <SignalSearchCard metadata={metadata} />;
  }
  if (action === 'send_newsletter') {
    return <NewsletterCard metadata={metadata} />;
  }

  return null;
}

function WebSearchProspectsCard({ metadata, onActionExecute }) {
  const { campaigns } = useApp();
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [searching, setSearching] = useState(false);
  const [contacts, setContacts] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [stats, setStats] = useState(null);

  const companies = metadata.companies || [];
  const titles = metadata.titles || [];

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    try {
      const data = await api.webSearchProspects({
        companies,
        titles,
        location: metadata.location || 'France',
        limit: metadata.limit || 50,
      });
      const list = data.contacts || [];
      setContacts(list);
      setSelected(new Set(list.map(c => c.id)));
      setStats({
        searched: data.companiesSearched,
        withResults: data.companiesWithResults,
        without: data.companiesWithoutResults || [],
        errors: data.errors || [],
      });
    } catch (err) {
      setError(err.message || t('prospectGen.searchFailed'));
    }
    setSearching(false);
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveToCampaign = async (campaignBackendId) => {
    setSaving(true);
    setError(null);
    try {
      const chosen = (contacts || []).filter(c => selected.has(c.id));
      const r = await api.addProspectsToCampaign(campaignBackendId, chosen);
      setSavedCount(r.created || 0);
      setShowCampaignPicker(false);
    } catch (err) {
      setError(err.message || t('prospectGen.saveFailed'));
    }
    setSaving(false);
  };

  const handleSaveClick = () => {
    if (metadata.campaignId) saveToCampaign(metadata.campaignId);
    else setShowCampaignPicker(true);
  };

  const pickableCampaigns = Object.values(campaigns || {})
    .filter(c => c.status === 'prep')
    .map(c => ({ id: c._backendId || c.id, name: c.name }));

  return (
    <div className="chat-action-card">
      <div className="chat-action-title">{'\uD83C\uDF10'} {t('chat.webSearch')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 8px' }}>
        {companies.length} {en ? (companies.length > 1 ? 'companies' : 'company') : `entreprise${companies.length > 1 ? 's' : ''}`} :&nbsp;
        {companies.slice(0, 5).join(', ')}{companies.length > 5 ? `, +${companies.length - 5}...` : ''}
      </div>
      <div className="chat-action-params">
        {titles.map((ti, i) => <span key={i} className="chat-action-param">{ti}</span>)}
      </div>

      {!contacts && (
        <div className="chat-action-buttons" style={{ marginTop: 8 }}>
          <button
            className="chat-action-btn primary"
            onClick={handleSearch}
            disabled={searching}
          >
            {searching
              ? t('chat.webSearching', { count: companies.length })
              : `\uD83D\uDD0D ${t('chat.launchWebSearch', { count: companies.length })}`}
          </button>
        </div>
      )}

      {stats && (
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          marginTop: 8,
          padding: '8px 10px',
          background: 'var(--bg-elevated)',
          borderRadius: 6,
          lineHeight: 1.6,
        }}>
          {t('chat.companiesAnalyzed', { searched: stats.searched, withResults: stats.withResults })}
          {stats.without.length > 0 && (
            <span> {'\u00B7'} {t('chat.noResults')} {stats.without.slice(0, 5).join(', ')}{stats.without.length > 5 ? '...' : ''}</span>
          )}
          {stats.errors && stats.errors.length > 0 && (
            <div style={{ marginTop: 4, color: 'var(--danger, #dc2626)' }}>
              {t('chat.errors')} {stats.errors.map(e => `${e.company}: ${e.error}`).join(' | ')}
            </div>
          )}
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {t('chat.contactsFound', { count: contacts.length, selected: selected.size })}
          </div>
          <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {contacts.map(c => (
              <div
                key={c.id}
                onClick={() => toggleSelect(c.id)}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  background: selected.has(c.id) ? 'var(--bg-elevated)' : 'transparent',
                }}
              >
                <input type="checkbox" checked={selected.has(c.id)} readOnly />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {c.name}
                    {c.linkedinUrl && (
                      <a
                        href={c.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ marginLeft: 6, fontSize: 10, color: 'var(--blue, #0077b5)' }}
                      >
                        LinkedIn
                      </a>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {c.title} {'\u00B7'} {c.company}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {savedCount > 0 ? (
            <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
              {t('chat.savedToCampaign', { count: savedCount })}
            </div>
          ) : showCampaignPicker ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                {t('chat.chooseCampaign')}
              </div>
              {pickableCampaigns.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('chat.noPrepCampaigns')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pickableCampaigns.map(c => (
                    <button
                      key={c.id}
                      className="chat-action-btn ghost"
                      onClick={() => saveToCampaign(c.id)}
                      disabled={saving}
                      style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12 }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="chat-action-buttons" style={{ marginTop: 10 }}>
              <button
                className="chat-action-btn primary"
                onClick={handleSaveClick}
                disabled={saving || selected.size === 0}
              >
                {saving ? t('prospectGen.adding') : `+ ${t('chat.addToCampaign', { count: selected.size })}`}
              </button>
            </div>
          )}
        </div>
      )}

      {contacts && contacts.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {t('chat.noContactsWeb')}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function ChooseSourceCard({ metadata, onActionExecute }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const sources = metadata.sources || [];
  return (
    <div className="chat-action-card">
      <div className="chat-action-title">{en ? '🎯 Which tool to use for the list?' : '🎯 Quel outil utiliser pour générer la liste ?'}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 12px' }}>
        {en ? 'You have multiple outreach tools connected. Which one should generate the prospect list?' : 'Tu as plusieurs outils d\'outreach connectés. Lequel doit générer la liste de prospects ?'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {sources.map(s => (
          <button
            key={s.provider}
            className="chat-action-btn primary"
            onClick={() => onActionExecute && onActionExecute({
              action: 'search_prospects',
              source: s.provider,
              ...(metadata.pending_criteria || {}),
            })}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddProspectsManualCard({ metadata, onActionExecute }) {
  const { campaigns } = useApp();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);

  // Normalize Claude's raw contacts array into the shape the backend expects.
  // Dedup by lowercased email. Drop entries without an email.
  const contacts = (() => {
    const raw = Array.isArray(metadata.contacts) ? metadata.contacts : [];
    const seen = new Set();
    const out = [];
    for (const c of raw) {
      const email = (c.email || '').trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || '';
      out.push({
        id: `chat_${key}`,
        email,
        name,
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        company: c.company || '',
        title: c.title || '',
        linkedinUrl: c.linkedinUrl || null,
      });
    }
    return out;
  })();

  const saveToCampaign = async (campaignBackendId) => {
    setSaving(true);
    setError(null);
    try {
      const r = await api.addProspectsToCampaign(campaignBackendId, contacts);
      setSavedCount(r.created || 0);
      setShowCampaignPicker(false);
    } catch (err) {
      setError(err.message || t('prospectGen.saveFailed'));
    }
    setSaving(false);
  };

  const handleSaveClick = () => {
    if (metadata.campaignId) {
      saveToCampaign(metadata.campaignId);
    } else {
      setShowCampaignPicker(true);
    }
  };

  const pickableCampaigns = Object.values(campaigns || {})
    .filter(c => c.status === 'prep')
    .map(c => ({
      id: c._backendId || c.id,
      name: c.name,
      sector: c.sector,
      size: c.size,
    }));

  return (
    <div className="chat-action-card">
      <div className="chat-action-title">{'\uD83D\uDCCB'} {t('chat.addProspectsList')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
        {t('chat.contactsDetected', { count: contacts.length, plural: contacts.length > 1 ? 's' : '', pluralDetected: contacts.length > 1 ? 's' : '' })}
        {metadata.campaignName && <> {'\u00B7'} {t('chat.destination')} <strong>{metadata.campaignName}</strong></>}
      </div>

      {contacts.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--danger, #dc2626)' }}>
          {t('chat.noValidContacts')}
        </div>
      )}

      {contacts.length > 0 && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          maxHeight: 220,
          overflow: 'auto',
          marginBottom: 10,
        }}>
          {contacts.slice(0, 8).map((c, i) => (
            <div key={c.id} style={{
              padding: '6px 10px',
              borderBottom: i < Math.min(7, contacts.length - 1) ? '1px solid var(--border)' : 'none',
              fontSize: 11,
              display: 'grid',
              gridTemplateColumns: '1.3fr 1fr 1.5fr',
              gap: 8,
            }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.name || '\u2014'}
              </div>
              <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title || '\u2014'}
              </div>
              <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.company || '\u2014'} {'\u00B7'} {c.email}
              </div>
            </div>
          ))}
          {contacts.length > 8 && (
            <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
              {t('chat.moreContacts', { count: contacts.length - 8 })}
            </div>
          )}
        </div>
      )}

      {savedCount > 0 ? (
        <div style={{ color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>
          {'\u2705'} {t('chat.prospectsAdded', { count: savedCount, plural: savedCount > 1 ? 's' : '', pluralAdded: savedCount > 1 ? 's' : '' })}
        </div>
      ) : showCampaignPicker ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {t('chat.chooseCampaignForCount', { count: contacts.length })}
          </div>
          {pickableCampaigns.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('chat.noPrepCampaignsCreate')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}>
              {pickableCampaigns.map(c => (
                <button
                  key={c.id}
                  className="chat-action-btn ghost"
                  onClick={() => saveToCampaign(c.id)}
                  disabled={saving}
                  style={{ textAlign: 'left', padding: '10px 12px' }}
                >
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {[c.sector, c.size].filter(Boolean).join(' \u00B7 ')}
                  </div>
                </button>
              ))}
            </div>
          )}
          <button
            className="chat-action-btn ghost"
            onClick={() => setShowCampaignPicker(false)}
            style={{ marginTop: 8, fontSize: 11 }}
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : contacts.length > 0 ? (
        <div className="chat-action-buttons">
          <button
            className="chat-action-btn primary"
            onClick={handleSaveClick}
            disabled={saving}
          >
            {saving
              ? t('prospectGen.adding')
              : metadata.campaignId
                ? `\u2795 ${t('chat.addCountToCampaign', { count: contacts.length })}`
                : `\u2795 ${t('chat.addCountChoose', { count: contacts.length })}`}
          </button>
        </div>
      ) : null}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 8 }}>
          {'\u26A0\uFE0F'} {error}
        </div>
      )}
    </div>
  );
}

function CreateCampaignCard({ campaign, onCreateCampaign, onModify, onPreview }) {
  const navigate = useNavigate();
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [createdId, setCreatedId] = useState(null);

  // Auto-open preview panel on mount
  useEffect(() => {
    if (onPreview && campaign) onPreview(campaign);
  }, []);

  const params = [campaign.sector, campaign.position, campaign.size, campaign.channel, campaign.angle, campaign.zone]
    .filter(Boolean)
    .map((p) => (
      <span key={p} className="chat-action-param">{p}</span>
    ));

  const steps = campaign.sequence && campaign.sequence.length > 0
    ? campaign.sequence.map((s) => (
        <div key={s.step} className="chat-action-step">
          <div className={`chat-action-step-dot ${s.type}`}></div>
          <span>{s.step} &mdash; {s.label || s.type}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{s.timing || ''}</span>
        </div>
      ))
    : null;

  const handleCreate = async () => {
    if (creating || created) return;
    setCreating(true);
    try {
      const result = await onCreateCampaign(campaign);
      setCreated(true);
      if (result && result.id) setCreatedId(String(result.id));
    } finally {
      setCreating(false);
    }
  };

  const handleViewCampaign = () => {
    if (createdId) navigate('/campaigns/' + createdId);
  };

  return (
    <div className="chat-action-card">
      <div className="chat-action-title">{t('chat.campaignReady', { name: campaign.name })}</div>
      <div className="chat-action-params">{params}</div>
      {steps && <div className="chat-action-sequence">{steps}</div>}
      <div className="chat-action-buttons">
        {!created ? (
          <>
            <button
              className="chat-action-btn primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? `\u23F3 ${t('chat.creating')}` : t('chat.createCampaign')}
            </button>
            <button className="chat-action-btn ghost" onClick={onModify} disabled={creating}>
              {t('chat.modify')}
            </button>
          </>
        ) : (
          <button
            className="chat-action-btn primary"
            onClick={handleViewCampaign}
            disabled={!createdId}
          >
            {'\u2705'} {t('chat.viewCampaign')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══ CRM / Activation Action Cards ═══ */

function SendEmailCard({ metadata }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [status, setStatus] = useState('ready'); // ready, sending, sent, error
  const [error, setError] = useState(null);

  const handleSend = async () => {
    setStatus('sending');
    try {
      await request('/nurture/send', {
        method: 'POST',
        body: JSON.stringify({
          to: metadata.to,
          toName: metadata.toName,
          subject: metadata.subject,
          body: metadata.body,
        }),
      });
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {'\u2709\uFE0F'} Email {'\u2192'} {metadata.toName || metadata.to}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        <strong>{en ? 'Subject:' : 'Objet :'}</strong> {metadata.subject}
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
        background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px',
        maxHeight: 120, overflow: 'hidden', marginBottom: 10, lineHeight: 1.5,
      }}>
        {metadata.body}
      </div>
      {status === 'ready' && (
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 16px' }} onClick={handleSend}>
          {en ? 'Send' : 'Envoyer'}
        </button>
      )}
      {status === 'sending' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{'\u23F3'} {en ? 'Sending...' : 'Envoi...'}</span>}
      {status === 'sent' && <span style={{ fontSize: 12, color: 'var(--success)' }}>{'\u2705'} {en ? 'Email sent!' : 'Email envoy\u00E9 !'}</span>}
      {status === 'error' && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{'\u274C'} {error}</span>}
    </div>
  );
}

function IssueRow({ issue, en }) {
  const [expanded, setExpanded] = useState(false);
  const severity = issue.severity === 'critical' || issue.severity === 'high' ? '\uD83D\uDD34'
    : issue.severity === 'warning' || issue.severity === 'medium' ? '\uD83D\uDFE1' : '\uD83D\uDFE2';
  const contacts = issue.contacts || [];
  const hasContacts = contacts.length > 0;
  const typeLabel = {
    invalid_email_format: en ? 'Invalid email format' : 'Format email invalide',
    invalid_email_domain: en ? 'Invalid email domain (no mail server)' : 'Domaine email invalide (pas de serveur mail)',
    invalid_email: en ? 'Invalid emails' : 'Emails invalides',
    duplicate_email: en ? 'Duplicate emails' : 'Emails en doublon',
    missing_email: en ? 'Missing emails' : 'Emails manquants',
    missing_name: en ? 'Missing names' : 'Noms manquants',
    format_name_caps: en ? 'Name formatting' : 'Format des noms',
  }[issue.type] || issue.message || issue.type;

  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{ display: 'flex', gap: 6, lineHeight: 1.5, cursor: hasContacts ? 'pointer' : 'default' }}
        onClick={() => hasContacts && setExpanded(!expanded)}
      >
        <span>{severity}</span>
        <span style={{ flex: 1 }}>{typeLabel} {issue.count > 1 ? `(${issue.count})` : ''}</span>
        {hasContacts && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{expanded ? '\u25B2' : '\u25BC'}</span>}
      </div>
      {expanded && contacts.length > 0 && (
        <div style={{ marginLeft: 22, marginTop: 4, marginBottom: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          {contacts.slice(0, 10).map((c, j) => (
            <div key={j} style={{ padding: '2px 0' }}>
              {c.name ? `${c.name} — ` : ''}<span style={{ color: 'var(--danger)' }}>{c.email}</span>
            </div>
          ))}
          {contacts.length > 10 && (
            <div style={{ fontStyle: 'italic', marginTop: 2 }}>+{contacts.length - 10} {en ? 'more' : 'de plus'}...</div>
          )}
        </div>
      )}
    </div>
  );
}

function CrmActionCard({ metadata, actionType, label, icon }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [status, setStatus] = useState('ready');
  const [result, setResult] = useState(null);

  const handleRun = async () => {
    setStatus('running');
    try {
      let endpoint;
      let body = {};
      if (actionType === 'scan_crm') {
        endpoint = '/crm/scan/' + (metadata.provider || 'auto');
        body = {};
      } else if (actionType === 'run_nurture') {
        endpoint = '/nurture/run';
        body = {};
      } else if (actionType === 'import_crm') {
        endpoint = '/crm/import/' + (metadata.provider || 'auto');
        body = {};
      } else if (actionType === 'clean_crm') {
        endpoint = '/crm/auto-clean';
      }
      const res = await request(endpoint, { method: 'POST', body: JSON.stringify(body) });
      setResult(res);
      setStatus('done');
    } catch (err) {
      setResult({ error: err.message });
      setStatus('error');
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        {icon} {label}
      </div>
      {status === 'ready' && (
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 16px' }} onClick={handleRun}>
          {en ? 'Execute' : 'Ex\u00E9cuter'}
        </button>
      )}
      {status === 'running' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{'\u23F3'} {en ? 'In progress...' : 'En cours...'}</span>}
      {status === 'done' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 8 }}>
            {'\u2705'} {en ? 'Done' : 'Termin\u00E9'}
            {result?.score != null && !result?.health && ` — ${en ? 'CRM Score' : 'Score CRM'}: ${result.score}/100`}
            {result?.imported != null && ` — ${result.imported} ${en ? 'contact(s) imported' : 'contact(s) import\u00E9(s)'}`}
            {result?.sent != null && ` — ${result.sent} ${en ? 'email(s) sent' : 'email(s) envoy\u00E9(s)'}, ${result.queued || 0} ${en ? 'pending' : 'en attente'}`}
            {result?.triggered != null && ` — ${result.triggered} trigger(s), ${result.sent || 0} ${en ? 'sent' : 'envoy\u00E9(s)'}, ${result.queued || 0} ${en ? 'pending' : 'en attente'}`}
            {result?.health?.score != null && ` — ${en ? 'Health' : 'Sant\u00E9'}: ${result.health.score}/100`}
            {result?.contacts?.total != null && ` — ${result.contacts.total} contacts`}
            {result?.autoFixed != null && ` — ${result.autoFixed} ${en ? 'fixed' : 'corrig\u00E9(s)'}, ${result.remainingManual || 0} ${en ? 'remaining' : 'restant(s)'}`}
            {result?.message && ` — ${result.message}`}
          </div>
          {/* Detailed results inline — from health scan or CRM scan */}
          {(result?.health?.issues?.length > 0 || result?.issues?.length > 0) && (
            <div style={{ fontSize: 12, marginTop: 6, padding: '10px 12px', background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {en ? 'Issues found' : 'Problèmes détectés'} ({(result?.health?.issues || result?.issues || []).length})
              </div>
              {(result?.health?.issues || result?.issues || []).slice(0, 8).map((issue, i) => (
                <IssueRow key={i} issue={issue} en={en} />
              ))}
              {(result?.health?.issues || result?.issues || []).length > 8 && (
                <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                  +{(result?.health?.issues || result?.issues || []).length - 8} {en ? 'more' : 'de plus'}...
                </div>
              )}
            </div>
          )}
          {/* Link to full analytics */}
          {(result?.score != null || result?.health?.score != null) && (
            <a href="/analytics" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none', display: 'inline-block', marginTop: 8 }}>
              {en ? 'View full analytics →' : 'Voir les analytics complètes →'}
            </a>
          )}
        </div>
      )}
      {status === 'error' && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{'\u274C'} {result?.error}</span>}
    </div>
  );
}

function CreateTriggerCard({ metadata }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [status, setStatus] = useState('ready');
  const [result, setResult] = useState(null);
  const threadId = metadata?._threadId || 'default';

  const handleCreate = async () => {
    setStatus('running');
    try {
      const res = await request(`/chat/threads/${threadId}/create-trigger`, {
        method: 'POST',
        body: JSON.stringify({
          name: metadata.name,
          triggerType: metadata.triggerType,
          actionType: metadata.actionType || 'email',
          days: metadata.days || 30,
          mode: metadata.mode || 'approval',
        }),
      });
      setResult(res);
      setStatus('done');
    } catch (err) {
      setResult({ error: err.message });
      setStatus('error');
    }
  };

  const actionLabel = (metadata.actionType || 'email').startsWith('linkedin_')
    ? 'LinkedIn ' + (metadata.actionType || '').replace('linkedin_', '')
    : 'Email';

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {'\u26A1'} {en ? 'Create trigger' : 'Créer un trigger'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        <strong>{metadata.name}</strong> — {metadata.triggerType?.replace(/_/g, ' ')} · {metadata.days || 30} {en ? 'days' : 'jours'} · {actionLabel} · {metadata.mode === 'auto' ? (en ? 'Automatic' : 'Automatique') : (en ? 'Approval' : 'Approbation')}
      </div>
      {status === 'ready' && (
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 16px' }} onClick={handleCreate}>
          {en ? 'Create trigger' : 'Créer le trigger'}
        </button>
      )}
      {status === 'running' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{'\u23F3'} {en ? 'Creating...' : 'Création...'}</span>}
      {status === 'done' && <span style={{ fontSize: 12, color: 'var(--success)' }}>{'\u2705'} {en ? 'Trigger created' : 'Trigger créé'}</span>}
      {status === 'error' && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{'\u274C'} {result?.error}</span>}
    </div>
  );
}

function ToggleAutopilotCard({ metadata }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [status, setStatus] = useState('ready');
  const threadId = metadata?._threadId || 'default';
  const enabling = metadata.enabled !== false;

  const handleToggle = async () => {
    setStatus('running');
    try {
      await request(`/chat/threads/${threadId}/toggle-autopilot`, {
        method: 'POST',
        body: JSON.stringify({ enabled: enabling }),
      });
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {'\uD83E\uDD16'} {enabling ? (en ? 'Enable Autopilot' : 'Activer l\'Autopilot') : (en ? 'Disable Autopilot' : 'Désactiver l\'Autopilot')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        {enabling
          ? (en ? 'AI will automatically respond to prospect replies (max 5 turns, 2-4h delay).' : 'L\'IA répondra automatiquement aux prospects (max 5 tours, délai 2-4h).')
          : (en ? 'Autopilot will be disabled. You will need to respond manually.' : 'L\'autopilot sera désactivé. Vous devrez répondre manuellement.')}
      </div>
      {status === 'ready' && (
        <button className={`btn ${enabling ? 'btn-success' : 'btn-outline'}`} style={{ fontSize: 12, padding: '6px 16px' }} onClick={handleToggle}>
          {enabling ? (en ? 'Enable' : 'Activer') : (en ? 'Disable' : 'Désactiver')}
        </button>
      )}
      {status === 'running' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{'\u23F3'}...</span>}
      {status === 'done' && <span style={{ fontSize: 12, color: 'var(--success)' }}>{'\u2705'} {enabling ? (en ? 'Autopilot enabled' : 'Autopilot activé') : (en ? 'Autopilot disabled' : 'Autopilot désactivé')}</span>}
      {status === 'error' && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{'\u274C'} {en ? 'Failed' : 'Échec'}</span>}
    </div>
  );
}

function ListClientsCard({ metadata }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [clients, setClients] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    request('/dashboard/opportunities')
      .then(data => {
        let opps = data.opportunities || [];
        if (metadata.filter === 'won') opps = opps.filter(o => o.status === 'won');
        else if (metadata.filter === 'stagnant' || metadata.filter === 'inactive') {
          const days = metadata.days || 30;
          const threshold = Date.now() - days * 86400000;
          opps = opps.filter(o => new Date(o.updated_at || o.created_at).getTime() < threshold);
        }
        setClients(opps);
      })
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }, [metadata.filter, metadata.days]);

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>{'\u23F3'} {en ? 'Loading...' : 'Chargement...'}</div>;
  if (!clients || clients.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>{en ? 'No clients found with this filter.' : 'Aucun client trouv\u00E9 avec ce filtre.'}</div>;
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        {'\uD83D\uDC65'} {clients.length} {en ? 'client(s) found' : 'client(s) trouv\u00E9(s)'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
        {clients.slice(0, 10).map(c => (
          <div key={c.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 10px', borderRadius: 6, background: 'var(--bg-elevated)', fontSize: 12,
          }}>
            <div>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              {c.company && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>@ {c.company}</span>}
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{c.email}</span>
          </div>
        ))}
        {clients.length > 10 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            +{clients.length - 10} {en ? 'more' : 'autres'}
          </div>
        )}
      </div>
    </div>
  );
}

function SignalSearchCard({ metadata }) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  const { lang } = useI18n();
  const en = lang === 'en';

  const handleScan = async () => {
    setScanning(true);
    try {
      // Create a temporary config and scan
      const config = await request('/signals/configs', {
        method: 'POST',
        body: JSON.stringify({
          name: `Chat scan ${new Date().toLocaleDateString()}`,
          signalTypes: metadata.keywords || ['funding', 'hiring', 'news'],
          targetSectors: metadata.sectors || [],
          targetTitles: metadata.titles || [],
          targetKeywords: metadata.keywords || metadata.sectors || [],
        }),
      });
      // Run the scan
      const report = await request('/signals/scan', { method: 'POST' });
      setResults(report);
    } catch { setResults({ error: true }); }
    setScanning(false);
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>📡</span>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{en ? 'Signal Search' : 'Recherche de signaux'}</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {metadata.sectors?.length > 0 && <span>{en ? 'Sectors' : 'Secteurs'}: {metadata.sectors.join(', ')} · </span>}
        {metadata.titles?.length > 0 && <span>{en ? 'Titles' : 'Titres'}: {metadata.titles.join(', ')} · </span>}
        {metadata.keywords?.length > 0 && <span>{en ? 'Keywords' : 'Mots-clés'}: {metadata.keywords.join(', ')}</span>}
      </div>
      {!results ? (
        <button className="btn btn-primary" style={{ fontSize: 12, width: '100%', justifyContent: 'center' }}
          onClick={handleScan} disabled={scanning}>
          {scanning ? (en ? 'Scanning...' : 'Scan en cours...') : (en ? '🔍 Scan for signals' : '🔍 Lancer le scan')}
        </button>
      ) : results.error ? (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>{en ? 'Scan failed' : 'Échec du scan'}</div>
      ) : (
        <div style={{ fontSize: 12 }}>
          <div style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 6 }}>
            ✅ {results.detected || 0} {en ? 'signals detected' : 'signaux détectés'}
          </div>
          <a href="/activation" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12 }}>
            {en ? 'View signals →' : 'Voir les signaux →'}
          </a>
        </div>
      )}
    </div>
  );
}

function NewsletterCard({ metadata }) {
  const [templates, setTemplates] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const { lang } = useI18n();
  const en = lang === 'en';

  useEffect(() => {
    request('/informz/templates').then(d => setTemplates(d.rows || [])).catch(() => setTemplates([]));
  }, []);

  const handleSend = async () => {
    setSending(true);
    try {
      const data = await request('/informz/send-from-template', {
        method: 'POST',
        body: JSON.stringify({
          templateId: selectedTemplate,
          prompt: metadata.topic || '',
        }),
      });
      setResult(data);
    } catch (err) { setResult({ error: err.message }); }
    setSending(false);
  };

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 12,
      padding: 16, marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>📨</span>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Newsletter</div>
      </div>
      {metadata.topic && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          {en ? 'Topic' : 'Sujet'}: {metadata.topic}
        </div>
      )}
      {templates === null ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'Loading templates...' : 'Chargement des templates...'}</div>
      ) : templates.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--warning)' }}>
          {en ? 'No Informz templates found. Connect Informz in Settings or create templates in Informz first.' : 'Aucun template Informz trouvé. Connectez Informz dans les Settings ou créez des templates dans Informz.'}
        </div>
      ) : !result ? (
        <>
          <select className="form-input" style={{ fontSize: 12, marginBottom: 8 }}
            value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)}>
            <option value="">{en ? '— Select a template —' : '— Choisir un template —'}</option>
            {templates.map((t, i) => (
              <option key={t.Id || i} value={t.Id || t.id || i}>{t.Name || t.name || `Template ${i + 1}`}</option>
            ))}
          </select>
          <button className="btn btn-primary" style={{ fontSize: 12, width: '100%', justifyContent: 'center' }}
            onClick={handleSend} disabled={sending || !selectedTemplate}>
            {sending ? '...' : (en ? '📨 Generate & send newsletter' : '📨 Générer et envoyer')}
          </button>
        </>
      ) : result.error ? (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>{result.error}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--success)' }}>✅ {en ? 'Newsletter sent!' : 'Newsletter envoyée !'}</div>
      )}
    </div>
  );
}

function ProspectSearchCard({ metadata, onActionExecute }) {
  const { campaigns } = useApp();
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [searching, setSearching] = useState(false);
  const [contacts, setContacts] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [fallback, setFallback] = useState(null);

  const criteriaSummary = [
    metadata.titles?.join(', '),
    metadata.companies?.length ? `${en ? 'Companies' : 'Entreprises'}: ${metadata.companies.join(', ')}` : null,
    metadata.sectors?.join(', '),
    metadata.companySizes?.join(', '),
    metadata.locations?.join(', '),
  ].filter(Boolean);

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    setDiagnostics(null);
    setFallback(null);
    try {
      const data = await api.searchProspects({
        source: metadata.source,
        titles: metadata.titles || [],
        companies: metadata.companies || [],
        sectors: metadata.sectors || [],
        locations: metadata.locations || [],
        companySizes: metadata.companySizes || [],
        limit: metadata.limit || 25,
      });
      const list = data.contacts || [];
      setContacts(list);
      setSelected(new Set(list.map(c => c.id)));
      if (data.diagnostics) setDiagnostics(data.diagnostics);
      if (data.fallback) setFallback(data.fallback);
    } catch (err) {
      setError(err.message || t('prospectGen.searchFailed'));
    }
    setSearching(false);
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveToCampaign = async (campaignBackendId) => {
    setSaving(true);
    setError(null);
    try {
      const chosen = contacts.filter(c => selected.has(c.id));
      const r = await api.addProspectsToCampaign(campaignBackendId, chosen);
      setSavedCount(r.created || 0);
      setShowCampaignPicker(false);
    } catch (err) {
      setError(err.message || t('prospectGen.saveFailed'));
    }
    setSaving(false);
  };

  const handleSaveClick = async () => {
    if (metadata.campaignId) {
      // Pre-linked campaign — save directly
      await saveToCampaign(metadata.campaignId);
    } else {
      // No campaign linked — show picker
      setShowCampaignPicker(true);
    }
  };

  // Build list of pickable campaigns (only prep campaigns make sense before launch)
  const pickableCampaigns = Object.values(campaigns || {})
    .filter(c => c.status === 'prep')
    .map(c => ({
      id: c._backendId || c.id,
      name: c.name,
      sector: c.sector,
      size: c.size,
    }));

  const sourceLabel = metadata.source
    ? metadata.source.charAt(0).toUpperCase() + metadata.source.slice(1)
    : 'Apollo';

  return (
    <div className="chat-action-card">
      <div className="chat-action-title">{'\uD83C\uDFAF'} {t('chat.prospectSearch', { source: sourceLabel })}</div>
      <div className="chat-action-params">
        {criteriaSummary.map((s, i) => (
          <span key={i} className="chat-action-param">{s}</span>
        ))}
      </div>

      {!contacts && (
        <div className="chat-action-buttons">
          <button
            className="chat-action-btn primary"
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? t('chat.searchingShort') : `\uD83D\uDD0D ${t('chat.launchSearch', { limit: metadata.limit || 25 })}`}
          </button>
        </div>
      )}

      {/* Fallback banner */}
      {fallback && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: 'rgba(251, 191, 36, 0.1)',
          border: '1px solid rgba(251, 191, 36, 0.35)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--warning, #d97706)',
          lineHeight: 1.5,
        }}
          dangerouslySetInnerHTML={{ __html: `\u26A0\uFE0F ${t('chat.fallbackBanner')}` }}
        />
      )}

      {/* Filter diagnostics */}
      {diagnostics && (diagnostics.dropped?.length > 0) && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--danger, #dc2626)',
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {'\u26A0\uFE0F'} {t('chat.diagnosticsTitle')}
          </div>
          <div>
            {t('chat.diagnosticsDropped')}&nbsp;
            <strong>{diagnostics.dropped.map(d => d.criterion).join(', ')}</strong>.
            &nbsp;{'\u00B7'}&nbsp; {t('chat.diagnosticsApplied')}&nbsp;
            {(diagnostics.applied?.length ?? 0) > 0
              ? <strong>{diagnostics.applied.map(a => a.criterion).join(', ')}</strong>
              : <strong>{t('chat.diagnosticsNone')}</strong>}.
          </div>
        </div>
      )}

      {contacts && contacts.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
          {t('chat.noContactsFound')}
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
            {t('chat.resultsAndSelected', { results: contacts.length, selected: selected.size })}
          </div>
          <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            {contacts.map(c => (
              <div
                key={c.id}
                onClick={() => toggleSelect(c.id)}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  background: selected.has(c.id) ? 'var(--bg-elevated)' : 'transparent',
                }}
              >
                <input type="checkbox" checked={selected.has(c.id)} readOnly />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {c.name} {!c.email && <span style={{ color: 'var(--warning)', fontSize: 10 }}>{t('common.noEmail')}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {c.title} {'\u00B7'} {c.company}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {savedCount > 0 ? (
            <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
              {'\u2705'} {t('chat.savedToCampaign', { count: savedCount })}
            </div>
          ) : showCampaignPicker ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                {t('chat.chooseCampaignForCount', { count: selected.size })}
              </div>
              {pickableCampaigns.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  {t('chat.noPrepCampaignsChat')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}>
                  {pickableCampaigns.map(c => (
                    <button
                      key={c.id}
                      className="chat-action-btn ghost"
                      onClick={() => saveToCampaign(c.id)}
                      disabled={saving}
                      style={{ textAlign: 'left', padding: '10px 12px' }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {[c.sector, c.size].filter(Boolean).join(' \u00B7 ')}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="chat-action-btn ghost"
                onClick={() => setShowCampaignPicker(false)}
                style={{ marginTop: 8, fontSize: 11 }}
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <div className="chat-action-buttons" style={{ marginTop: 10 }}>
              <button
                className="chat-action-btn primary"
                onClick={handleSaveClick}
                disabled={saving || selected.size === 0}
              >
                {saving ? t('prospectGen.adding') : metadata.campaignId
                  ? `\u2795 ${t('chat.addCountToCampaign', { count: selected.size })}`
                  : `\u2795 ${t('chat.addCountChoose', { count: selected.size })}`}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
          {'\u26A0\uFE0F'} {error}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="chat-typing" id="chatTyping">
      <div
        className="chat-msg-avatar"
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 600,
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        b
      </div>
      <div className="chat-typing-dots">
        <div className="chat-typing-dot"></div>
        <div className="chat-typing-dot"></div>
        <div className="chat-typing-dot"></div>
      </div>
    </div>
  );
}

function ChatMessage({ role, content, metadata, animate, isLast, onCreateCampaign, onSendMessage, onActionExecute, onPreview }) {
  const { lang } = useI18n();
  const avatar = role === 'assistant' ? 'b' : '~';
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let formattedContent = content;
  if (role === 'assistant') {
    // Remove JSON code blocks from display (they become action cards)
    formattedContent = formattedContent.replace(/```json\s*[\s\S]*?```/g, '').trim();
    formattedContent = formatMarkdown(formattedContent);
  } else {
    formattedContent = escapeHtml(formattedContent);
  }

  const hasActionCard = metadata && metadata.action;
  const quickReplies = metadata?.quick_replies;
  // Don't show quick replies if there's already an action card with buttons (avoid duplicate CTAs)
  const showQuickReplies = isLast && quickReplies && quickReplies.length > 0 && !hasActionCard;

  return (
    <div
      className={`chat-msg ${role}`}
      style={animate ? { animation: 'chatFadeIn 0.25s ease' } : undefined}
    >
      <div className="chat-msg-avatar">{avatar}</div>
      <div className="chat-msg-body">
        <div
          className="chat-msg-content"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(formattedContent) }}
        />
        {hasActionCard && (
          <ActionCard
            metadata={metadata}
            onCreateCampaign={onCreateCampaign}
            onModify={() => onSendMessage(lang === 'en' ? 'Can you adjust this campaign?' : 'Peux-tu ajuster cette campagne ?')}
            onActionExecute={onActionExecute}
            onPreview={onPreview}
          />
        )}
        {showQuickReplies && (
          <QuickReplies replies={quickReplies} onSend={onSendMessage} />
        )}
        <div className="chat-msg-time">{timeStr}</div>
      </div>
    </div>
  );
}

function StreamingMessage({ content, metadata, onCreateCampaign, onSendMessage, onActionExecute }) {
  const { lang } = useI18n();
  const [displayedContent, setDisplayedContent] = useState('');
  const [showAction, setShowAction] = useState(false);
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
    // Strip JSON blocks for display
    const displayText = content.replace(/```json\s*[\s\S]*?```/g, '').trim();
    const words = displayText.split(/(\s+)/);
    let buffer = '';
    let i = 0;
    const chunkSize = 3;
    const baseDelay = 18;

    const timer = setInterval(() => {
      if (i >= words.length) {
        clearInterval(timer);
        setShowAction(true);
        return;
      }
      buffer += words[i];
      if (i % chunkSize === chunkSize - 1 || i === words.length - 1) {
        setDisplayedContent(formatMarkdown(buffer));
      }
      i++;
    }, baseDelay + Math.random() * 12);

    return () => clearInterval(timer);
  }, [content]);

  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const hasActionCard = metadata && metadata.action;

  return (
    <div className="chat-msg assistant" style={{ animation: 'chatFadeIn 0.25s ease' }}>
      <div className="chat-msg-avatar">b</div>
      <div className="chat-msg-body">
        <div
          className="chat-msg-content"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayedContent) }}
        />
        {showAction && hasActionCard && (
          <ActionCard
            metadata={metadata}
            onCreateCampaign={onCreateCampaign}
            onModify={() => onSendMessage(lang === 'en' ? 'Can you adjust this campaign?' : 'Peux-tu ajuster cette campagne ?')}
            onActionExecute={onActionExecute}
            onPreview={onPreview}
          />
        )}
        {/* Quick replies after action card — only for non-campaign actions to avoid duplicate buttons */}
        {showAction && !hasActionCard && metadata?.quick_replies?.length > 0 && (
          <QuickReplies replies={metadata.quick_replies} onSend={onSendMessage} />
        )}
        <div className="chat-msg-time">{timeStr}</div>
      </div>
    </div>
  );
}

function QuickReplies({ replies, onSend, disabled }) {
  if (!replies || replies.length === 0) return null;
  return (
    <div className="chat-quick-replies">
      {replies.map((r, i) => {
        const type = r.type || 'option';
        return (
          <button
            key={i}
            className={`chat-quick-reply ${type}`}
            onClick={() => !disabled && onSend(r.value || r.label)}
            disabled={disabled}
          >
            {type === 'confirm' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function InlineSuggestions({ suggestions, onSend }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="chat-inline-suggestions">
      {suggestions.map((s) => (
        <button key={s} className="chat-inline-chip" onClick={() => onSend(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}

function WelcomeScreen({ suggestions, onSuggestionClick, onAction, userState }) {
  const { userName, campaignCount, hasProfile, activeCampaigns, topCampaign, insights } = userState || {};
  const t = useT();
  const { lang } = useI18n();

  let title = 'baakalai Assistant';
  let subtitle = t('chat.defaultSubtitle');
  let actions = [
    { key: 'create', label: t('chat.createFirst') },
    { key: 'refine', label: t('chat.refineCampaigns') },
    { key: 'analyze', label: t('chat.analyzePerf') },
  ];

  if (!hasProfile && campaignCount === 0) {
    title = userName ? `${t('chat.welcome')} ${userName}!` : `${t('chat.welcome')}!`;
    subtitle = lang === 'en'
      ? 'Start by setting up your company profile, then create your first prospecting campaign. I\'ll guide you step by step.'
      : 'Commencez par configurer votre profil entreprise, puis cr\u00E9ez votre premi\u00E8re campagne. Je vous guide \u00E9tape par \u00E9tape.';
    actions = [
      { key: 'setup_profile', label: t('chat.setupProfile') },
      { key: 'create', label: t('chat.createFirst') },
    ];
  } else if (hasProfile && campaignCount === 0) {
    title = userName ? t('chat.readyToProspect', { name: userName }) : (lang === 'en' ? 'Ready to prospect?' : 'Pr\u00EAt \u00E0 prospecter ?');
    subtitle = t('chat.chooseTemplate');
    actions = [];
    suggestions = [];
  } else if (campaignCount > 0 && activeCampaigns === 0) {
    title = userName ? (lang === 'en' ? `Welcome back, ${userName}!` : `Bon retour, ${userName} !`) : (lang === 'en' ? 'Welcome back!' : 'Bon retour !');
    subtitle = lang === 'en'
      ? `You have ${campaignCount} campaign${campaignCount > 1 ? 's' : ''} in preparation. Launch one or create a new one.`
      : `Vous avez ${campaignCount} campagne${campaignCount > 1 ? 's' : ''} en pr\u00E9paration. Lancez-en une ou cr\u00E9ez-en une nouvelle.`;
    actions = [
      { key: 'create', label: t('chat.newCampaign') },
      { key: 'analyze', label: t('chat.seeCampaigns') },
    ];
  } else if (activeCampaigns > 0) {
    title = userName ? t('chat.hello', { name: userName }) : (lang === 'en' ? 'Hello!' : 'Bonjour !');
    const topInfo = topCampaign
      ? (lang === 'en'
        ? ` "${topCampaign.name}" has a ${topCampaign.openRate || '\u2014'}% open rate.`
        : ` "${topCampaign.name}" a un taux d'ouverture de ${topCampaign.openRate || '\u2014'}%.`)
      : '';
    subtitle = lang === 'en'
      ? `${activeCampaigns} active campaign${activeCampaigns > 1 ? 's' : ''}.${topInfo} What can I do for you?`
      : `${activeCampaigns} campagne${activeCampaigns > 1 ? 's' : ''} active${activeCampaigns > 1 ? 's' : ''}.${topInfo} Que puis-je faire pour vous ?`;
    actions = [];
  }

  // Show top insights from memory analysis
  const topInsights = (insights || []).filter(r => r.level === 'success').slice(0, 2);

  return (
    <div className="chat-welcome" id="chatWelcome" style={{ display: 'flex' }}>
      <div className="chat-welcome-inner">
        <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: 16 }}>
          <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
          <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round"/>
          <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
          <circle cx="22" cy="26" r="7" fill="#C4B5FD"/>
          <circle cx="82" cy="30" r="8" fill="#9A84EB"/>
          <circle cx="30" cy="80" r="7" fill="#C4B5FD"/>
          <circle cx="50" cy="50" r="13" fill="#6E57FA"/>
        </svg>
        <h2 className="chat-welcome-title" style={{ marginBottom: 10 }}>{title}</h2>
        <p className="chat-welcome-text" style={{ marginBottom: 32, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 480 }}>{subtitle}</p>

        {/* Onboarding checklist — shown for new users */}
        {(!hasProfile || campaignCount === 0) && (
          <div style={{ maxWidth: 520, width: '100%', marginBottom: 16 }}>
            <OnboardingChecklist />
          </div>
        )}

        {/* Memory insights — shown when patterns exist */}
        {topInsights.length > 0 && (
          <div style={{
            background: 'var(--bg-elevated, var(--paper-2))',
            borderRadius: 12, padding: '14px 18px', marginBottom: 20,
            textAlign: 'left', maxWidth: 480, width: '100%',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
              {t('chat.insightsTitle')}
            </div>
            {topInsights.map((insight, i) => (
              <div key={i} style={{
                fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
                padding: '4px 0',
              }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(insight.text) }} />
            ))}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, marginTop: 8, padding: '5px 12px', color: 'var(--accent)' }}
              onClick={() => onAction('create_from_insights')}
            >
              {t('chat.createFromInsights')} →
            </button>
          </div>
        )}

        {/* Campaign templates — shown when user has profile but no/few campaigns */}
        {(hasProfile && campaignCount === 0) && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 10, marginBottom: 20, maxWidth: 640, width: '100%',
          }}>
            {getCampaignTemplates(t).map(tpl => (
              <button
                key={tpl.label}
                onClick={() => onSuggestionClick(tpl.prompt)}
                style={{
                  background: 'var(--paper)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)', padding: '14px 16px',
                  textAlign: 'left', cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--primary-softer)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--paper)'; }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{tpl.label}</div>
                <div style={{ fontSize: 11, color: 'var(--grey-500)', lineHeight: 1.4 }}>{tpl.desc}</div>
              </button>
            ))}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="chat-welcome-suggestions" id="chatWelcomeSuggestions" style={{ marginBottom: actions.length > 0 ? 16 : 0 }}>
            {suggestions.map((s) => (
              <button key={s} className="chat-suggestion" onClick={() => onSuggestionClick(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="chat-welcome-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {actions.map((a) => (
              <button key={a.key} className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => onAction(a.key)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Main Component ═══ */

export default function ChatPage() {
  const { backendAvailable, setCampaigns, campaigns, user, recommendations } = useApp();
  const { socket } = useSocket();
  const { lang } = useI18n();

  // Local state
  const [threads, setThreads] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  // Use a ref (not state) to track if stream already added the message.
  // State would cause stale-closure bugs: the HTTP callback captures the
  // old value even after onStreamEnd set it to true. Refs are always current.
  const streamedMessageAddedRef = useRef(false);
  const [showTyping, setShowTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [chatSidebarOpen, setChatSidebarOpen] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [campaignPreview, setCampaignPreview] = useState(null); // { campaign, edits }

  // Handle prefilled message from other pages (e.g. Memory Explorer "Apply")
  const location = useLocation();
  useEffect(() => {
    if (location.state?.prefillMessage) {
      setInputValue(location.state.prefillMessage);
      // Clear the state so it doesn't re-apply on re-render
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const messagesContainerRef = useRef(null);

  /* ─── File attachments state (must be before sendMessage which references them) ─── */
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  /* ─── Scroll to bottom ─── */
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  /* ─── Socket: join/leave thread rooms + receive messages ─── */
  useEffect(() => {
    if (!socket || !currentThreadId) return;

    socket.emit('chat:join', currentThreadId);

    const onMessage = (msg) => {
      // Avoid duplicating messages we already added from our own POST response
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, animate: true }];
      });
      scrollToBottom();
    };

    socket.on('chat:message', onMessage);

    return () => {
      socket.emit('chat:leave', currentThreadId);
      socket.off('chat:message', onMessage);
    };
  }, [socket, currentThreadId, scrollToBottom]);

  /* ─── Socket: real-time streaming from Claude ─── */
  useEffect(() => {
    if (!socket) return;

    const onChunk = (data) => {
      if (data.threadId === currentThreadId || !currentThreadId) {
        setStreamingContent(prev => prev + data.chunk);
        setIsStreaming(true);
        setShowTyping(false);
        scrollToBottom();
      }
    };

    const onStreamEnd = (data) => {
      setIsStreaming(false);
      // Add the complete message from stream-end and clear streaming content
      if (data && data.fullContent) {
        setMessages(prev => [...prev, {
          id: data.messageId || Date.now(),
          role: 'assistant',
          content: data.fullContent,
          metadata: data.metadata || null,
          animate: false,
        }]);
      }
      setStreamingContent('');
      streamedMessageAddedRef.current = true;
    };

    socket.on('chat:stream', onChunk);
    socket.on('chat:stream-end', onStreamEnd);

    return () => {
      socket.off('chat:stream', onChunk);
      socket.off('chat:stream-end', onStreamEnd);
    };
  }, [socket, currentThreadId, scrollToBottom]);

  /* ─── Load threads ─── */
  const loadThreads = useCallback(async () => {
    if (!backendAvailable) return;
    try {
      const data = await api.request('/chat/threads');
      setThreads(data.threads || []);
    } catch {
      setThreads([]);
    }
  }, [backendAvailable]);

  /* ─── Init ─── */
  useEffect(() => {
    loadThreads();
    if (inputRef.current) inputRef.current.focus();
  }, [loadThreads]);

  /* ─── Auto-select latest thread or show welcome ─── */
  useEffect(() => {
    if (threads.length > 0 && !currentThreadId) {
      // Don't auto-select; show welcome for fresh start
      setShowWelcome(true);
    }
  }, [threads, currentThreadId]);

  /* ─── New thread ─── */
  const newThread = useCallback(async () => {
    if (!backendAvailable) {
      setCurrentThreadId(null);
      setMessages([]);
      setShowWelcome(true);
      return;
    }
    try {
      const thread = await api.request('/chat/threads', {
        method: 'POST',
        body: JSON.stringify({ title: lang === 'en' ? 'New conversation' : 'Nouvelle conversation' }),
      });
      setCurrentThreadId(thread.id);
      await loadThreads();
      setMessages([]);
      setShowWelcome(true);
    } catch (err) {
      console.warn('Failed to create thread:', err.message);
      setCurrentThreadId(null);
      setMessages([]);
      setShowWelcome(true);
    }
    if (inputRef.current) inputRef.current.focus();
  }, [backendAvailable, loadThreads]);

  /* ─── Select thread ─── */
  const selectThread = useCallback(async (threadId) => {
    setCurrentThreadId(threadId);
    setStreamingContent('');
    setIsStreaming(false);

    if (!backendAvailable) return;
    try {
      const data = await api.request('/chat/threads/' + threadId + '/messages');
      const msgs = data.messages || [];
      if (msgs.length === 0) {
        setMessages([]);
        setShowWelcome(true);
      } else {
        setMessages(msgs.map((m) => ({
          id: m.id || Date.now() + Math.random(),
          role: m.role,
          content: m.content,
          metadata: m.metadata ? (typeof m.metadata === 'string' ? (() => { try { return JSON.parse(m.metadata); } catch { return null; } })() : m.metadata) : null,
          animate: false,
        })));
        setShowWelcome(false);
        scrollToBottom();
      }
    } catch (err) {
      console.warn('Failed to load thread messages:', err.message);
    }
  }, [backendAvailable, scrollToBottom]);

  /* ─── Delete thread ─── */
  const deleteThread = useCallback(async (threadId, e) => {
    e.stopPropagation();
    if (!backendAvailable) return;
    try {
      await api.request('/chat/threads/' + threadId, { method: 'DELETE' });
      if (currentThreadId === threadId) {
        setCurrentThreadId(null);
        setMessages([]);
        setShowWelcome(true);
      }
      await loadThreads();
    } catch (err) {
      console.warn('Failed to delete thread:', err.message);
    }
  }, [backendAvailable, currentThreadId, loadThreads]);

  /* ─── Get context suggestions ─── */
  const getSuggestions = useCallback((metadata) => {
    // Use Claude-generated quick replies if available
    if (metadata?.quick_replies && metadata.quick_replies.length > 0) {
      return metadata.quick_replies.map(qr => typeof qr === 'string' ? qr : (qr.value || qr.label || qr));
    }
    // Fallback to action-based suggestions
    const en = lang === 'en';
    if (!metadata || !metadata.action) {
      return en ? ['Create a campaign', 'View my stats', 'Refine my sequences'] : ['Cr\u00E9er une campagne', 'Voir mes stats', 'Affiner mes s\u00E9quences'];
    }
    if (metadata.action === 'create_campaign') {
      return en ? ['Edit settings', 'Add a LinkedIn touchpoint', 'Change the tone'] : ['Modifier les param\u00E8tres', 'Ajouter un touchpoint LinkedIn', 'Changer le ton'];
    }
    if (metadata.action === 'update_campaign') {
      return en ? ['View campaign', 'Run analysis', 'Other changes'] : ['Voir la campagne', 'Lancer une analyse', 'Autre modification'];
    }
    if (metadata.action === 'analyze_campaign' || metadata.action === 'show_diagnostic') {
      return en ? ['Regenerate weak touchpoints', 'Compare with other campaigns', 'Suggest refinements'] : ['R\u00E9g\u00E9n\u00E9rer les touchpoints faibles', 'Comparer avec les autres campagnes', 'Proposer des affinages'];
    }
    if (metadata.action === 'regenerate_touchpoints') {
      return en ? ['View new versions', 'Deploy changes', 'Change approach'] : ['Voir les nouvelles versions', 'D\u00E9ployer les modifications', 'Modifier l\'approche'];
    }
    if (metadata.action === 'scan_crm' || metadata.action === 'clean_crm') {
      return en ? ['Fix all issues', 'Import contacts', 'Create a trigger', 'Enable autopilot'] : ['Corriger tous les probl\u00E8mes', 'Importer les contacts', 'Cr\u00E9er un trigger', 'Activer l\'autopilot'];
    }
    if (metadata.action === 'import_crm') {
      return en ? ['Scan CRM health', 'Create activation trigger', 'Show imported contacts'] : ['Scanner la sant\u00E9 CRM', 'Cr\u00E9er un trigger d\'activation', 'Voir les contacts import\u00E9s'];
    }
    if (metadata.action === 'create_trigger') {
      return en ? ['Create another trigger', 'Run activation now', 'Enable autopilot'] : ['Cr\u00E9er un autre trigger', 'Lancer l\'activation maintenant', 'Activer l\'autopilot'];
    }
    if (metadata.action === 'toggle_autopilot') {
      return en ? ['Show autopilot queue', 'Create a trigger', 'Scan CRM'] : ['Voir la file autopilot', 'Cr\u00E9er un trigger', 'Scanner le CRM'];
    }
    if (metadata.action === 'run_nurture') {
      return en ? ['View sent emails', 'Check pending approvals', 'Scan CRM health'] : ['Voir les emails envoy\u00E9s', 'V\u00E9rifier les approbations', 'Scanner la sant\u00E9 CRM'];
    }
    if (metadata.action === 'send_email') {
      return en ? ['Send another email', 'Create a follow-up trigger', 'View client profile'] : ['Envoyer un autre email', 'Cr\u00E9er un trigger de suivi', 'Voir le profil client'];
    }
    if (metadata.action === 'list_clients') {
      return en ? ['Export this list', 'Create trigger for these clients', 'Run churn scoring'] : ['Exporter cette liste', 'Cr\u00E9er un trigger pour ces clients', 'Lancer le scoring churn'];
    }
    return en ? ['Create a campaign', 'Scan my CRM', 'Enable autopilot'] : ['Cr\u00E9er une campagne', 'Scanner mon CRM', 'Activer l\'autopilot'];
  }, []);

  /* ─── Create campaign from chat ─── */
  const createCampaignFromChat = useCallback(async (campaignData) => {
    if (currentThreadId && backendAvailable) {
      try {
        const result = await api.request('/chat/threads/' + currentThreadId + '/create-campaign', {
          method: 'POST',
          body: JSON.stringify({ campaign: campaignData }),
        });

        if (result.campaign) {
          const id = String(result.campaign.id);
          const newCampaign = {
            _backendId: result.campaign.id,
            id,
            name: campaignData.name,
            client: campaignData.client || 'Mon entreprise',
            status: 'prep',
            channel: campaignData.channel || 'email',
            channelLabel: campaignData.channel === 'linkedin' ? 'LinkedIn' : campaignData.channel === 'multi' ? 'Multi' : 'Email',
            channelColor: campaignData.channel === 'linkedin' ? 'var(--purple)' : campaignData.channel === 'multi' ? 'var(--orange)' : 'var(--blue)',
            sector: campaignData.sector || '',
            sectorShort: (campaignData.sector || '').split(' ')[0],
            position: campaignData.position || '',
            size: campaignData.size || '',
            angle: campaignData.angle || '',
            zone: campaignData.zone || '',
            tone: campaignData.tone || 'Pro decontracte',
            formality: 'Vous',
            length: 'Standard',
            cta: '',
            volume: { sent: 0, planned: 0 },
            iteration: 0,
            startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
            lemlistRef: null,
            nextAction: null,
            kpis: { contacts: 0, openRate: null, replyRate: null, interested: null, meetings: null },
            sequence: (campaignData.sequence || []).map((s) => ({
              id: s.step, type: s.type, label: s.label || '', timing: s.timing || '',
              subType: '', subject: s.subject || null, body: s.body || '', stats: null,
            })),
            diagnostics: [],
            history: [],
            prepChecklist: [],
            info: { period: '', copyDesc: '', channelsDesc: '', launchEstimate: '' },
          };

          setCampaigns((prev) => ({ ...prev, [id]: newCampaign }));
        }

        // Add success message
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'assistant',
            content: lang === 'en'
              ? `Campaign **"${campaignData.name}"** created successfully! Click **View campaign** above to add prospects and launch the sequence to Lemlist.`
              : `Campagne **"${campaignData.name}"** créée avec succès ! Clique sur **Voir la campagne** ci-dessus pour ajouter des prospects et lancer la séquence vers Lemlist.`,
            metadata: null,
            animate: true,
          },
        ]);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
        scrollToBottom();

        // Return the created campaign ID so the CreateCampaignCard can
        // show a "Voir la campagne" shortcut button.
        return { id: result.campaign.id };
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'assistant',
            content: lang === 'en'
              ? 'Error creating campaign: `' + err.message + '`. Try creating it manually.'
              : 'Erreur lors de la création : `' + err.message + '`. Essayez de créer la campagne manuellement.',
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      }
    } else {
      // Offline fallback
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          content: lang === 'en'
            ? 'The backend is not connected. You can create this campaign manually via the **+ New campaign** button on the dashboard.'
            : 'Le backend n\'est pas connecté. Vous pouvez créer cette campagne manuellement via le bouton **+ Nouvelle campagne** du dashboard.',
          metadata: null,
          animate: true,
        },
      ]);
      scrollToBottom();
    }
  }, [currentThreadId, backendAvailable, setCampaigns, scrollToBottom]);

  /* ─── Send message ─── */
  const sendMessage = useCallback(async (overrideText) => {
    if (sending) return;

    const text = overrideText || inputValue.trim();
    if (!text && attachedFiles.length === 0) return;

    // Upload attached files first (if any)
    let uploadedFiles = [];
    if (attachedFiles.length > 0 && backendAvailable) {
      setUploadingFiles(true);
      try {
        // Tag chat uploads as 'chat_attachment' so they don't pollute the profile docs section
        const result = await api.uploadFiles(attachedFiles, { source: 'chat' });
        uploadedFiles = result.uploaded || [];
        setAttachedFiles([]);
      } catch (err) {
        console.warn('File upload failed:', err.message);
      }
      setUploadingFiles(false);
    }

    // Build message text including file references
    let messageText = text || '';
    if (uploadedFiles.length > 0) {
      const fileNames = uploadedFiles.map(f => f.originalName).join(', ');
      const fileNote = lang === 'en' ? `\n\n[Attached files: ${fileNames}]` : `\n\n[Fichiers joints : ${fileNames}]`;
      messageText = (messageText + fileNote).trim();
    }

    if (!messageText) return;

    // Clear input
    if (!overrideText) {
      setInputValue('');
    }

    setShowWelcome(false);
    setStreamingContent('');
    setIsStreaming(false);
    streamedMessageAddedRef.current = false;

    let threadId = currentThreadId;

    // If no thread, create one first
    if (!threadId && backendAvailable) {
      try {
        const thread = await api.request('/chat/threads', {
          method: 'POST',
          body: JSON.stringify({ title: messageText.slice(0, 60) }),
        });
        threadId = thread.id;
        setCurrentThreadId(threadId);
        loadThreads();
      } catch (err) {
        console.warn('Failed to create thread:', err.message);
      }
    }

    // Add user message
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: messageText,
      metadata: null,
      animate: true,
    };
    setMessages((prev) => [...prev, userMsg]);
    scrollToBottom();

    // Show typing indicator
    setShowTyping(true);
    setSending(true);

    // Try backend
    if (threadId && backendAvailable) {
      try {
        const data = await api.request('/chat/threads/' + threadId + '/messages', {
          method: 'POST',
          body: JSON.stringify({ message: messageText }),
        });
        setShowTyping(false);

        // HTTP response arrived — only add if stream didn't already add it
        if (!streamedMessageAddedRef.current) {
          const assistantMsg = {
            id: data.message.id || Date.now() + 1,
            role: 'assistant',
            content: data.message.content,
            metadata: data.message.metadata,
            animate: false,
          };
          setMessages((prev) => [...prev, assistantMsg]);

          // Open campaign preview panel if a campaign was created
          if (data.message.metadata?.action === 'create_campaign' && data.message.metadata?.campaign) {
            setCampaignPreview({ campaign: data.message.metadata.campaign, edits: {} });
          }
        }
        setStreamingContent('');
        setIsStreaming(false);
        streamedMessageAddedRef.current = false;
        scrollToBottom();

        // Refresh thread list (title may have changed)
        loadThreads();
      } catch (err) {
        setShowTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: lang === 'en'
              ? 'Sorry, I can\'t respond right now. Check that the backend is running and the Baakalai API key is configured.\n\n`' + err.message + '`'
              : 'Désolé, je ne peux pas répondre pour le moment. Vérifiez que le backend est démarré et que la clé API Baakalai est configurée.\n\n`' + err.message + '`',
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      }
    } else {
      // Offline fallback
      setTimeout(() => {
        setShowTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: lang === 'en'
              ? 'The backend is not connected. Start the server with `cd backend && node server.js` to enable the AI assistant.\n\nIn the meantime, you can explore the dashboard and other pages.'
              : 'Le backend n\'est pas connecté. Démarrez le serveur avec `cd backend && node server.js` pour activer l\'assistant IA.\n\nEn attendant, vous pouvez explorer le dashboard et les autres pages.',
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      }, 800);
    }

    setSending(false);
    if (inputRef.current) inputRef.current.focus();
  }, [sending, inputValue, attachedFiles, currentThreadId, backendAvailable, loadThreads, scrollToBottom]);

  /* ─── Execute structured action from chat ─── */
  const executeAction = useCallback((metadata) => {
    const action = metadata?.action;
    if (!action) return;

    if (action === 'update_campaign') {
      const campName = metadata.campaignName || '';
      const changes = metadata.changes || {};
      const changeDesc = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(', ');
      sendMessage(lang === 'en' ? `Apply changes to "${campName}": ${changeDesc}` : `Applique les modifications sur "${campName}" : ${changeDesc}`);
      return;
    }

    if (action === 'analyze_campaign') {
      sendMessage(lang === 'en' ? `Run performance analysis on campaign "${metadata.campaignName || ''}"` : `Lance l'analyse de performance de la campagne "${metadata.campaignName || ''}"`);
      return;
    }

    if (action === 'regenerate_touchpoints') {
      const steps = (metadata.steps || []).join(', ');
      sendMessage(lang === 'en' ? `Regenerate touchpoints ${steps} of campaign "${metadata.campaignName || ''}"` : `Régénère les touchpoints ${steps} de la campagne "${metadata.campaignName || ''}"`);
      return;
    }

    if (action === 'show_diagnostic') {
      sendMessage(lang === 'en' ? `Show the full diagnostic of campaign "${metadata.campaignName || ''}"` : `Montre le diagnostic complet de la campagne "${metadata.campaignName || ''}"`);
      return;
    }

    if (action === 'search_prospects') {
      // Injected from ChooseSourceCard: render a new message with the search card
      const sourceName = (metadata.source || '').replace(/^./, c => c.toUpperCase());
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          content: lang === 'en' ? `Great, I'm using **${sourceName}** for the search.` : `Parfait, j'utilise **${sourceName}** pour la recherche.`,
          metadata: { action: 'search_prospects', ...metadata },
          animate: true,
        },
      ]);
      scrollToBottom();
      return;
    }
  }, [sendMessage, scrollToBottom]);

  /* ─── Action button starters ─── */
  const startAction = useCallback((action) => {
    const prompts = getActionPrompts(lang);
    const text = prompts[action];
    if (text) sendMessage(text);
  }, [sendMessage]);

  /* ─── File attachments (drag & drop + file picker) ─── */

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const addFiles = useCallback((files) => {
    const MAX_SIZE = 20 * 1024 * 1024;
    const newFiles = Array.from(files).filter(f => {
      if (f.size > MAX_SIZE) {
        console.warn(`File ${f.name} too large (max 20MB)`);
        return false;
      }
      return true;
    });
    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileInputChange = useCallback((e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  }, [addFiles]);

  const removeAttachedFile = useCallback((index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const formatFileSize = useCallback((bytes) => {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }, []);

  /* ─── Input handling ─── */
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleInputChange = useCallback((e) => {
    setInputValue(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  /* ─── Compute user state for onboarding ─── */
  const campaignList = Object.values(campaigns);
  const activeCampaignsList = campaignList.filter(c => c.status === 'active');
  const topCampaign = activeCampaignsList.length > 0
    ? activeCampaignsList.reduce((best, c) => (c.kpis?.openRate || 0) > (best.kpis?.openRate || 0) ? c : best, activeCampaignsList[0])
    : null;
  const userState = {
    userName: user?.name?.split(' ')[0] || '',
    campaignCount: campaignList.length,
    hasProfile: !!(user?.company),
    activeCampaigns: activeCampaignsList.length,
    topCampaign: topCampaign ? { name: topCampaign.name, openRate: topCampaign.kpis?.openRate } : null,
    insights: recommendations || [],
  };

  /* ─── Compute last assistant metadata for suggestions ─── */
  const lastAssistantMsg = messages.length > 0
    ? [...messages].reverse().find((m) => m.role === 'assistant')
    : null;
  const inlineSuggestions = lastAssistantMsg ? getSuggestions(lastAssistantMsg.metadata) : [];

  return (
    <>
    <Confetti trigger={showConfetti} />
    <div className="chat-page">
      {/* ─── Sidebar: Thread List ─── */}
      {!chatSidebarOpen && (
        <button
          className="chat-sidebar-toggle"
          onClick={() => setChatSidebarOpen(true)}
          style={{ position: 'absolute', left: 8, top: 8, zIndex: 10 }}
          title={lang === 'en' ? 'Open conversations' : 'Ouvrir les conversations'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      <div className={`chat-sidebar${chatSidebarOpen ? '' : ' collapsed'}`}>
        <div className="chat-sidebar-header">
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Conversations</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AiStatusBadge online={backendAvailable} />
            <button
              className="chat-sidebar-toggle"
              onClick={() => setChatSidebarOpen(false)}
              title={lang === 'en' ? 'Hide conversations' : 'Masquer les conversations'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        </div>
        <ThreadList
          threads={threads}
          currentThreadId={currentThreadId}
          onSelect={selectThread}
          onDelete={deleteThread}
          onNew={newThread}
        />
      </div>

      {/* ─── Main Chat Area ─── */}
      <div
        className="chat-main"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(96, 165, 250, 0.08)',
            border: '2px dashed var(--blue)',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              textAlign: 'center', color: 'var(--blue)',
              fontSize: '15px', fontWeight: 600,
            }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>+</div>
              {lang === 'en' ? 'Drop your files here' : 'Déposez vos fichiers ici'}
              <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '4px' }}>
                {lang === 'en' ? 'CSV, Excel, PDF, DOCX — max 20 MB' : 'CSV, Excel, PDF, DOCX — max 20 Mo'}
              </div>
            </div>
          </div>
        )}
        {/* Welcome screen or messages */}
        {showWelcome && messages.length === 0 ? (
          <WelcomeScreen
            suggestions={
              userState.campaignCount === 0 ? getOnboardingSuggestions(lang)
              : userState.activeCampaigns > 0 ? getReturningSuggestions(lang)
              : getDefaultSuggestions(lang)
            }
            onSuggestionClick={(s) => sendMessage(s)}
            onAction={startAction}
            userState={userState}
          />
        ) : (
          <div
            className="chat-messages"
            id="chatMessages"
            ref={messagesContainerRef}
            style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
          >
            <div className="chat-messages-inner" id="chatMessagesInner" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  metadata={msg.metadata}
                  animate={msg.animate}
                  isLast={idx === messages.length - 1 && msg.role === 'assistant'}
                  onCreateCampaign={createCampaignFromChat}
                  onSendMessage={sendMessage}
                  onActionExecute={executeAction}
                  onPreview={(campaign) => setCampaignPreview({ campaign, edits: {} })}
                />
              ))}

              {/* Real-time streaming message */}
              {(isStreaming || streamingContent) && streamingContent && (
                <div className="chat-msg assistant" style={{ animation: 'chatFadeIn 0.25s ease' }}>
                  <div className="chat-msg-avatar">b</div>
                  <div className="chat-msg-body">
                    <div
                      className="chat-msg-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(formatMarkdown(
                        streamingContent.replace(/```json\s*[\s\S]*?```/g, '').trim()
                      )) }}
                    />
                  </div>
                </div>
              )}

              {/* Typing indicator */}
              {showTyping && !isStreaming && !streamingContent && <TypingIndicator />}

              {/* Inline suggestions after last assistant message */}
              {!showTyping && !isStreaming && !streamingContent && messages.length > 0 && (
                <InlineSuggestions suggestions={inlineSuggestions} onSend={sendMessage} />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* ─── Attached files preview ─── */}
        {attachedFiles.length > 0 && (
          <div style={{
            padding: '8px 20px 0',
            borderTop: '1px solid var(--border)',
            display: 'flex', flexWrap: 'wrap', gap: '6px',
          }}>
            {attachedFiles.map((file, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: '8px', padding: '4px 10px', fontSize: '12px',
                color: 'var(--text-secondary)',
              }}>
                <span style={{ fontSize: '14px' }}>
                  {file.type?.includes('csv') || file.type?.includes('spreadsheet') ? '📊'
                    : file.type?.includes('pdf') ? '📄'
                    : file.type?.includes('image') ? '🖼️'
                    : '📎'}
                </span>
                <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  {formatFileSize(file.size)}
                </span>
                <button
                  onClick={() => removeAttachedFile(i)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: '14px', padding: '0 2px',
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ─── Input bar ─── */}
        <div className="chat-input-bar" style={{ padding: '12px 20px', borderTop: attachedFiles.length > 0 ? 'none' : '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls,.pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
          {/* File picker button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title={lang === 'en' ? 'Attach a file' : 'Joindre un fichier'}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '10px 12px',
              cursor: 'pointer', color: 'var(--text-secondary)',
              fontSize: '16px', lineHeight: 1, flexShrink: 0,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text-muted)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            +
          </button>
          <textarea
            ref={inputRef}
            id="chatInput"
            className="chat-input"
            placeholder={attachedFiles.length > 0 ? (lang === 'en' ? 'Add a message with your files...' : 'Ajoutez un message pour accompagner vos fichiers...') : (lang === 'en' ? 'Type your message...' : 'Écrivez votre message...')}
            rows={1}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '10px 14px',
              fontSize: '13px',
              lineHeight: '1.5',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              outline: 'none',
              minHeight: '40px',
              maxHeight: '160px',
              overflow: 'auto',
            }}
          />
          <button
            id="chatSendBtn"
            className="btn btn-primary"
            style={{ padding: '10px 16px', fontSize: '13px', borderRadius: '10px', flexShrink: 0 }}
            disabled={sending || uploadingFiles}
            onClick={() => sendMessage()}
          >
            {uploadingFiles ? 'Upload...' : (lang === 'en' ? 'Send' : 'Envoyer')}
          </button>
        </div>
      </div>

      {/* ─── Campaign Preview Panel (split view) ─── */}
      {campaignPreview && (
        <div style={{
          width: 420, flexShrink: 0, borderLeft: '1px solid var(--border)',
          background: 'var(--bg-card)', overflowY: 'auto', padding: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{lang === 'en' ? 'Campaign Preview' : 'Aperçu campagne'}</div>
            <button onClick={() => setCampaignPreview(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)',
            }}>×</button>
          </div>

          {/* Campaign name */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
              {lang === 'en' ? 'Campaign' : 'Campagne'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{campaignPreview.campaign.name}</div>
            {campaignPreview.campaign.sector && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{campaignPreview.campaign.sector}</div>
            )}
          </div>

          {/* Touchpoints / Sequence */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            {lang === 'en' ? 'Sequence' : 'Séquence'} ({(campaignPreview.campaign.sequence || campaignPreview.campaign.touchpoints || []).length} {lang === 'en' ? 'steps' : 'étapes'})
          </div>
          {(campaignPreview.campaign.sequence || campaignPreview.campaign.touchpoints || []).map((tp, i) => {
            const editKey = `tp_${i}`;
            const editedSubject = campaignPreview.edits?.[`${editKey}_subject`];
            const editedBody = campaignPreview.edits?.[`${editKey}_body`];
            return (
              <div key={i} style={{
                marginBottom: 12, padding: 12, borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                borderLeft: `3px solid ${tp.type === 'linkedin' ? '#0A66C2' : 'var(--accent)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                    {tp.step || `E${i + 1}`} · {tp.timing || `J+${i * 3}`} · {tp.type || 'email'}
                  </span>
                </div>
                {tp.subject && (
                  <input
                    type="text"
                    value={editedSubject !== undefined ? editedSubject : tp.subject}
                    onChange={(e) => setCampaignPreview(prev => ({
                      ...prev,
                      edits: { ...prev.edits, [`${editKey}_subject`]: e.target.value },
                    }))}
                    className="form-input"
                    style={{ fontSize: 12, padding: '4px 8px', marginBottom: 6, fontWeight: 600 }}
                  />
                )}
                <textarea
                  value={editedBody !== undefined ? editedBody : (tp.body || '')}
                  onChange={(e) => setCampaignPreview(prev => ({
                    ...prev,
                    edits: { ...prev.edits, [`${editKey}_body`]: e.target.value },
                  }))}
                  className="form-input"
                  style={{ fontSize: 11, padding: '6px 8px', minHeight: 80, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
            );
          })}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}
              onClick={() => {
                // Apply edits to campaign and trigger creation
                const edited = { ...campaignPreview.campaign };
                const steps = edited.sequence || edited.touchpoints || [];
                const editedSteps = steps.map((tp, i) => ({
                  ...tp,
                  subject: campaignPreview.edits?.[`tp_${i}_subject`] || tp.subject,
                  body: campaignPreview.edits?.[`tp_${i}_body`] || tp.body,
                }));
                if (edited.sequence) edited.sequence = editedSteps;
                else edited.touchpoints = editedSteps;
                // Send to create
                createCampaignFromChat(edited);
                setCampaignPreview(null);
              }}>
              {lang === 'en' ? 'Deploy campaign' : 'Déployer la campagne'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }}
              onClick={() => setCampaignPreview(null)}>
              {lang === 'en' ? 'Close' : 'Fermer'}
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
