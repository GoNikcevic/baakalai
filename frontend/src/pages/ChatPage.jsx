/* ===============================================================================
   BAKAL — Chat Page (React)
   Conversational campaign builder powered by Claude.
   Ported from /app/chat.js — full React hooks implementation.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useSocket } from '../context/SocketContext';
import api from '../services/api-client';
import { sanitizeHtml } from '../services/sanitize';
import Confetti from '../components/Confetti';

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

const DEFAULT_SUGGESTIONS = [
  'Cibler des DAF en Ile-de-France',
  'Optimiser ma campagne',
  'Quel angle pour le secteur tech ?',
];

const ONBOARDING_SUGGESTIONS = [
  'Comment fonctionne Baakalai ?',
  'Quel secteur cibler en premier ?',
  'Aide-moi à définir mon ICP',
];

const RETURNING_SUGGESTIONS = [
  'Résumé de mes campagnes',
  'Quelle campagne optimiser en priorité ?',
  'Créer une campagne similaire',
];

const ACTION_PROMPTS = {
  create: 'Je veux créer une nouvelle campagne de prospection. Guide-moi étape par étape.',
  optimize: 'Je veux optimiser une de mes campagnes existantes qui sous-performe. Quelles campagnes puis-je améliorer ?',
  analyze: 'Peux-tu analyser les performances de mes campagnes actives et me donner un diagnostic ?',
  setup_profile: 'Je viens de m\'inscrire. Aide-moi à configurer mon profil entreprise pour personnaliser mes campagnes.',
  explore: 'Explique-moi les fonctionnalités de Baakalai et comment tirer le meilleur parti de la plateforme.',
  create_from_insights: 'Tu as analysé mes campagnes précédentes et identifié des patterns qui fonctionnent. Crée-moi une nouvelle campagne optimisée en t\'appuyant sur ces insights et la mémoire cross-campagne. Propose-moi le meilleur angle, ton et séquence basés sur ce qui a marché.',
};

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
  return (
    <div className="chat-thread-list" id="chatThreadList">
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: '12px', padding: '8px 12px' }}
          onClick={onNew}
        >
          + Nouvelle conversation
        </button>
      </div>
      {threads.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
          Aucune conversation
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
                title="Supprimer"
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

function ActionCard({ metadata, onCreateCampaign, onModify, onActionExecute }) {
  const action = metadata?.action;

  // Create campaign card
  if (action === 'create_campaign' && metadata.campaign) {
    return <CreateCampaignCard campaign={metadata.campaign} onCreateCampaign={onCreateCampaign} onModify={onModify} />;
  }

  // Update campaign card
  if (action === 'update_campaign') {
    const changes = metadata.changes || {};
    const changeList = Object.entries(changes).map(([k, v]) => `${k}: ${v}`);
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">Modifier : {metadata.campaignName || ''}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '8px 0' }}>
          {changeList.map((c, i) => <div key={i}>{c}</div>)}
        </div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            Appliquer les modifications
          </button>
          <button className="chat-action-btn ghost" onClick={onModify}>
            Modifier
          </button>
        </div>
      </div>
    );
  }

  // Analyze campaign card
  if (action === 'analyze_campaign') {
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">Analyser : {metadata.campaignName || ''}</div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            Lancer l'analyse
          </button>
        </div>
      </div>
    );
  }

  // Regenerate touchpoints card
  if (action === 'regenerate_touchpoints') {
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">Régénérer : {metadata.campaignName || ''}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '8px 0' }}>
          Touchpoints : {(metadata.steps || []).join(', ')}
        </div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            Régénérer les touchpoints
          </button>
          <button className="chat-action-btn ghost" onClick={onModify}>
            Modifier
          </button>
        </div>
      </div>
    );
  }

  // Show diagnostic card
  if (action === 'show_diagnostic') {
    return (
      <div className="chat-action-card">
        <div className="chat-action-title">Diagnostic : {metadata.campaignName || ''}</div>
        <div className="chat-action-buttons">
          <button className="chat-action-btn primary" onClick={() => onActionExecute && onActionExecute(metadata)}>
            Voir le diagnostic complet
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

  return null;
}

function WebSearchProspectsCard({ metadata, onActionExecute }) {
  const { campaigns } = useApp();
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
      });
    } catch (err) {
      setError(err.message || 'Recherche web echouee');
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
      setError(err.message || 'Sauvegarde echouee');
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
      <div className="chat-action-title">🌐 Recherche web approfondie</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 8px' }}>
        {companies.length} entreprise{companies.length > 1 ? 's' : ''} :&nbsp;
        {companies.slice(0, 5).join(', ')}{companies.length > 5 ? `, +${companies.length - 5}...` : ''}
      </div>
      <div className="chat-action-params">
        {titles.map((t, i) => <span key={i} className="chat-action-param">{t}</span>)}
      </div>

      {!contacts && (
        <div className="chat-action-buttons" style={{ marginTop: 8 }}>
          <button
            className="chat-action-btn primary"
            onClick={handleSearch}
            disabled={searching}
          >
            {searching
              ? `Recherche en cours (${companies.length} entreprises)...`
              : `🔍 Lancer la recherche web (${companies.length} entreprises)`}
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
          {stats.searched} entreprises analysees · {stats.withResults} avec resultats
          {stats.without.length > 0 && (
            <span> · Sans resultat : {stats.without.slice(0, 5).join(', ')}{stats.without.length > 5 ? '...' : ''}</span>
          )}
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {contacts.length} contacts trouves · {selected.size} selectionnes
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
                    {c.title} · {c.company}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {savedCount > 0 ? (
            <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
              {savedCount} prospects ajoutes a la campagne
            </div>
          ) : showCampaignPicker ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Choisis la campagne :
              </div>
              {pickableCampaigns.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Aucune campagne en preparation.</div>
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
                {saving ? 'Ajout...' : `+ Ajouter ${selected.size} (choisir campagne)`}
              </button>
            </div>
          )}
        </div>
      )}

      {contacts && contacts.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Aucun contact trouve via la recherche web pour ces entreprises.
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
  const sources = metadata.sources || [];
  return (
    <div className="chat-action-card">
      <div className="chat-action-title">🎯 Quel outil utiliser pour générer la liste ?</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 12px' }}>
        Tu as plusieurs outils d'outreach connectés. Lequel doit générer la liste de prospects ?
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
      setError(err.message || 'Sauvegarde échouée');
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
      <div className="chat-action-title">📋 Ajouter une liste de prospects</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
        {contacts.length} contact{contacts.length > 1 ? 's' : ''} détecté{contacts.length > 1 ? 's' : ''}
        {metadata.campaignName && <> · destination : <strong>{metadata.campaignName}</strong></>}
      </div>

      {contacts.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--danger, #dc2626)' }}>
          Aucun contact valide (email manquant). Vérifie que la liste contient bien des emails.
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
                {c.name || '—'}
              </div>
              <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title || '—'}
              </div>
              <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.company || '—'} · {c.email}
              </div>
            </div>
          ))}
          {contacts.length > 8 && (
            <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
              + {contacts.length - 8} autres…
            </div>
          )}
        </div>
      )}

      {savedCount > 0 ? (
        <div style={{ color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>
          ✅ {savedCount} prospect{savedCount > 1 ? 's' : ''} ajouté{savedCount > 1 ? 's' : ''} à la campagne
        </div>
      ) : showCampaignPicker ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            Choisis la campagne où ajouter les {contacts.length} prospects :
          </div>
          {pickableCampaigns.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Aucune campagne en préparation. Crée-en d'abord une.
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
                    {[c.sector, c.size].filter(Boolean).join(' · ')}
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
            Annuler
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
              ? 'Ajout...'
              : metadata.campaignId
                ? `➕ Ajouter ${contacts.length} à la campagne`
                : `➕ Ajouter ${contacts.length} (choisir une campagne)`}
          </button>
        </div>
      ) : null}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 8 }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

function CreateCampaignCard({ campaign, onCreateCampaign, onModify }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [createdId, setCreatedId] = useState(null);

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
      <div className="chat-action-title">Campagne prête : {campaign.name}</div>
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
              {creating ? '⏳ Création...' : 'Créer la campagne'}
            </button>
            <button className="chat-action-btn ghost" onClick={onModify} disabled={creating}>
              Modifier
            </button>
          </>
        ) : (
          <button
            className="chat-action-btn primary"
            onClick={handleViewCampaign}
            disabled={!createdId}
          >
            ✅ Campagne créée · Voir la campagne →
          </button>
        )}
      </div>
    </div>
  );
}

function ProspectSearchCard({ metadata, onActionExecute }) {
  const { campaigns } = useApp();
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
    metadata.companies?.length ? `Entreprises: ${metadata.companies.join(', ')}` : null,
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
      setError(err.message || 'Recherche échouée');
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
      setError(err.message || 'Sauvegarde échouée');
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
      <div className="chat-action-title">🎯 Recherche de prospects ({sourceLabel})</div>
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
            {searching ? 'Recherche...' : `🔍 Lancer la recherche (${metadata.limit || 25} max)`}
          </button>
        </div>
      )}

      {/* Fallback banner — Lemlist indisponible → Apollo */}
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
        }}>
          ⚠️ Lemlist Leads indisponible — résultats via <strong>Apollo</strong> (fallback automatique).
        </div>
      )}

      {/* Filter diagnostics — critères ignorés */}
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
            ⚠️ Filtres non appliqués — résultats peu pertinents
          </div>
          <div>
            Ignorés par Lemlist :&nbsp;
            <strong>{diagnostics.dropped.map(d => d.criterion).join(', ')}</strong>.
            &nbsp;·&nbsp; Seuls envoyés :&nbsp;
            {(diagnostics.applied?.length ?? 0) > 0
              ? <strong>{diagnostics.applied.map(a => a.criterion).join(', ')}</strong>
              : <strong>aucun</strong>}.
          </div>
        </div>
      )}

      {contacts && contacts.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
          Aucun contact trouvé pour ces critères.
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
            {contacts.length} résultats · {selected.size} sélectionnés
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
                    {c.name} {!c.email && <span style={{ color: 'var(--warning)', fontSize: 10 }}>(sans email)</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {c.title} · {c.company}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {savedCount > 0 ? (
            <div style={{ color: 'var(--success)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
              ✅ {savedCount} prospects ajoutés à la campagne
            </div>
          ) : showCampaignPicker ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Choisis la campagne où ajouter les {selected.size} prospects :
              </div>
              {pickableCampaigns.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  Aucune campagne en préparation. Crée d'abord une campagne via le chat.
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
                        {[c.sector, c.size].filter(Boolean).join(' · ')}
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
                Annuler
              </button>
            </div>
          ) : (
            <div className="chat-action-buttons" style={{ marginTop: 10 }}>
              <button
                className="chat-action-btn primary"
                onClick={handleSaveClick}
                disabled={saving || selected.size === 0}
              >
                {saving ? 'Ajout...' : metadata.campaignId
                  ? `➕ Ajouter ${selected.size} à la campagne`
                  : `➕ Ajouter ${selected.size} (choisir une campagne)`}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
          ⚠️ {error}
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

function ChatMessage({ role, content, metadata, animate, isLast, onCreateCampaign, onSendMessage, onActionExecute }) {
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
  const showQuickReplies = isLast && quickReplies && quickReplies.length > 0;

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
            onModify={() => onSendMessage('Peux-tu ajuster cette campagne ?')}
            onActionExecute={onActionExecute}
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
            onModify={() => onSendMessage('Peux-tu ajuster cette campagne ?')}
            onActionExecute={onActionExecute}
          />
        )}
        {showAction && metadata?.quick_replies?.length > 0 && (
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

  // Contextual greeting based on user state
  let title = 'Assistant Baakalai';
  let subtitle = 'Je peux vous aider à créer des campagnes, optimiser vos séquences et analyser vos performances.';
  let actions = [
    { key: 'create', label: 'Créer une campagne' },
    { key: 'optimize', label: 'Optimiser' },
    { key: 'analyze', label: 'Analyser' },
  ];

  if (!hasProfile && campaignCount === 0) {
    title = userName ? `Bienvenue ${userName} !` : 'Bienvenue sur Baakalai !';
    subtitle = 'Commencez par configurer votre profil entreprise, puis créez votre première campagne de prospection. Je vous guide étape par étape.';
    actions = [
      { key: 'setup_profile', label: 'Configurer mon profil' },
      { key: 'create', label: 'Créer ma première campagne' },
    ];
  } else if (hasProfile && campaignCount === 0) {
    title = userName ? `Prêt à prospecter, ${userName} ?` : 'Prêt à prospecter ?';
    subtitle = 'Votre profil est configuré. Créez votre première campagne et je génère vos séquences personnalisées.';
    actions = [
      { key: 'create', label: 'Créer ma première campagne' },
      { key: 'explore', label: 'Explorer les fonctionnalités' },
    ];
  } else if (campaignCount > 0 && activeCampaigns === 0) {
    title = userName ? `Bon retour, ${userName} !` : 'Bon retour !';
    subtitle = `Vous avez ${campaignCount} campagne${campaignCount > 1 ? 's' : ''} en préparation. Lancez-en une ou créez-en une nouvelle.`;
    actions = [
      { key: 'create', label: 'Nouvelle campagne' },
      { key: 'analyze', label: 'Voir mes campagnes' },
    ];
  } else if (activeCampaigns > 0) {
    title = userName ? `Bonjour ${userName} !` : 'Bonjour !';
    const topInfo = topCampaign ? ` "${topCampaign.name}" a un taux d'ouverture de ${topCampaign.openRate || '—'}%.` : '';
    subtitle = `${activeCampaigns} campagne${activeCampaigns > 1 ? 's' : ''} active${activeCampaigns > 1 ? 's' : ''}.${topInfo} Que puis-je faire pour vous ?`;
    actions = [
      { key: 'optimize', label: 'Optimiser mes campagnes' },
      { key: 'analyze', label: 'Analyser les performances' },
      { key: 'create', label: 'Nouvelle campagne' },
    ];
  }

  // Show top insights from memory analysis
  const topInsights = (insights || []).filter(r => r.level === 'success').slice(0, 2);

  return (
    <div className="chat-welcome" id="chatWelcome" style={{ display: 'flex' }}>
      <div className="chat-welcome-inner">
        <div className="chat-welcome-icon">b</div>
        <h2 className="chat-welcome-title" style={{ marginBottom: 12 }}>{title}</h2>
        <p className="chat-welcome-text" style={{ marginBottom: 16 }}>{subtitle}</p>

        {/* Memory insights — shown when patterns exist */}
        {topInsights.length > 0 && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '14px 18px', marginBottom: 16,
            textAlign: 'left', maxWidth: 520, width: '100%',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              🧠 Insights de vos campagnes
            </div>
            {topInsights.map((insight, i) => (
              <div key={i} style={{
                fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
                padding: '6px 0',
                borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              }} dangerouslySetInnerHTML={{ __html: insight.text }} />
            ))}
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, marginTop: 10, padding: '6px 14px' }}
              onClick={() => onAction('create_from_insights')}
            >
              Créer une campagne basée sur ces insights
            </button>
          </div>
        )}

        <div className="chat-welcome-suggestions" id="chatWelcomeSuggestions">
          {suggestions.map((s) => (
            <button key={s} className="chat-suggestion" onClick={() => onSuggestionClick(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="chat-welcome-actions" style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {actions.map((a) => (
            <button key={a.key} className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => onAction(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══ Main Component ═══ */

export default function ChatPage() {
  const { backendAvailable, setCampaigns, campaigns, user, recommendations } = useApp();
  const { socket } = useSocket();

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
        body: JSON.stringify({ title: 'Nouvelle conversation' }),
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
          metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : null,
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
    if (!metadata || !metadata.action) {
      return ['Créer une campagne', 'Voir mes stats', 'Optimiser mes séquences'];
    }
    if (metadata.action === 'create_campaign') {
      return ['Modifier les paramètres', 'Ajouter un touchpoint LinkedIn', 'Changer le ton'];
    }
    if (metadata.action === 'update_campaign') {
      return ['Voir la campagne', 'Lancer une analyse', 'Autre modification'];
    }
    if (metadata.action === 'analyze_campaign' || metadata.action === 'show_diagnostic') {
      return ['Régénérer les touchpoints faibles', 'Comparer avec les autres campagnes', 'Proposer des optimisations'];
    }
    if (metadata.action === 'regenerate_touchpoints') {
      return ['Voir les nouvelles versions', 'Déployer les modifications', 'Modifier l\'approche'];
    }
    return ['Créer une campagne', 'Voir mes stats', 'Optimiser mes séquences'];
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
            content: `Campagne **"${campaignData.name}"** créée avec succès ! Clique sur **Voir la campagne** ci-dessus pour ajouter des prospects et lancer la séquence vers Lemlist.`,
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
            content: 'Erreur lors de la création : `' + err.message + '`. Essayez de créer la campagne manuellement.',
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
          content: 'Le backend n\'est pas connecté. Vous pouvez créer cette campagne manuellement via le bouton **+ Nouvelle campagne** du dashboard.',
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
      const fileNote = `\n\n[Fichiers joints : ${fileNames}]`;
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
            content: 'Désolé, je ne peux pas répondre pour le moment. Vérifiez que le backend est démarré et que la clé API Baakalai est configurée.\n\n`' + err.message + '`',
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
            content: 'Le backend n\'est pas connecté. Démarrez le serveur avec `cd backend && node server.js` pour activer l\'assistant IA.\n\nEn attendant, vous pouvez explorer le dashboard et les autres pages.',
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
      sendMessage(`Applique les modifications sur "${campName}" : ${changeDesc}`);
      return;
    }

    if (action === 'analyze_campaign') {
      sendMessage(`Lance l'analyse de performance de la campagne "${metadata.campaignName || ''}"`);
      return;
    }

    if (action === 'regenerate_touchpoints') {
      const steps = (metadata.steps || []).join(', ');
      sendMessage(`Régénère les touchpoints ${steps} de la campagne "${metadata.campaignName || ''}"`);
      return;
    }

    if (action === 'show_diagnostic') {
      sendMessage(`Montre le diagnostic complet de la campagne "${metadata.campaignName || ''}"`);
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
          content: `Parfait, j'utilise **${sourceName}** pour la recherche.`,
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
    const text = ACTION_PROMPTS[action];
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
          title="Ouvrir les conversations"
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
              title="Masquer les conversations"
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
              Déposez vos fichiers ici
              <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginTop: '4px' }}>
                CSV, Excel, PDF, DOCX — max 20 Mo
              </div>
            </div>
          </div>
        )}
        {/* Welcome screen or messages */}
        {showWelcome && messages.length === 0 ? (
          <WelcomeScreen
            suggestions={
              userState.campaignCount === 0 ? ONBOARDING_SUGGESTIONS
              : userState.activeCampaigns > 0 ? RETURNING_SUGGESTIONS
              : DEFAULT_SUGGESTIONS
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
            title="Joindre un fichier"
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
            placeholder={attachedFiles.length > 0 ? 'Ajoutez un message pour accompagner vos fichiers...' : 'Écrivez votre message...'}
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
            {uploadingFiles ? 'Upload...' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
