/* ===============================================================================
   BAKAL — CRM / Activation action cards (shared chat primitives)
   Cartes d'action rendues par l'assistant général (pages/ChatPage.jsx) quand Claude
   propose une action côté CRM : scan, nettoyage, import, relance, trigger, autopilot,
   envoi d'email, signaux, newsletter — plus le compte-rendu de lecture du CRM affiché
   sur son écran d'accueil.

   Ces composants vivaient dans components/campaigns/CampaignAssistant.jsx. Ils en ont
   été sortis parce que l'onglet Prospection ne traite que la prospection froide : tout
   ce qui touche aux contacts déjà présents dans le CRM appartient à l'assistant général.
   Chaque carte s'exécute elle-même (elle appelle son endpoint au clic) — aucune n'a
   besoin d'un dispatcher côté page.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request, trackEvent } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';


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
  // La portée vient de l'Assistant, qui doit la demander quand elle manque.
  // Sans elle la route refuse : mieux vaut une carte inerte qu'une bascule
  // silencieuse sur la mauvaise population.
  const scope = metadata.scope === 'crm' || metadata.scope === 'prospection' ? metadata.scope : null;
  const scopeLabel = scope === 'crm'
    ? (en ? 'CRM contacts and clients' : 'contacts et clients du CRM')
    : (en ? 'cold prospects' : 'prospects froids');

  const handleToggle = async () => {
    setStatus('running');
    try {
      await request(`/chat/threads/${threadId}/toggle-autopilot`, {
        method: 'POST',
        body: JSON.stringify({ enabled: enabling, scope }),
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
          ? (en ? `AI will automatically answer replies from ${scopeLabel} (max 5 turns, 2-4h delay).` : `L'IA répondra automatiquement aux réponses de vos ${scopeLabel} (max 5 tours, délai 2-4h).`)
          : (en ? `Autopilot will be disabled for ${scopeLabel}. You will need to respond manually.` : `L'autopilot sera désactivé pour vos ${scopeLabel}. Vous devrez répondre manuellement.`)}
      </div>
      {!scope && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>
          {en ? 'Which population? Ask the assistant to specify: cold prospects, or CRM contacts.'
              : 'Sur quelle population ? Demande à l\'assistant de préciser : prospects froids, ou contacts CRM.'}
        </div>
      )}
      {scope && status === 'ready' && (
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
      // signal_types must come from the fixed set understood by the signal-agent
      // (SIGNAL_QUERIES) — free-text keywords go in targetKeywords only.
      const VALID_SIGNAL_TYPES = ['funding', 'hiring', 'news', 'job_change', 'leadership_change', 'competitor', 'product_launch', 'expansion', 'tech_adoption'];
      const requestedTypes = (metadata.signalTypes || []).filter(k => VALID_SIGNAL_TYPES.includes(k));
      await request('/signals/configs', {
        method: 'POST',
        body: JSON.stringify({
          name: `Chat scan ${new Date().toLocaleDateString()}`,
          signalTypes: requestedTypes.length > 0 ? requestedTypes : ['funding', 'hiring', 'news'],
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
          <a href="/activation?section=signals" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12 }}>
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

/* Premier dialogue : ce que baakalai a lu dans le CRM, avec les deals
   dormants cliquables — un clic lance la conversation sur un vrai deal.
   Rendu uniquement quand l'utilisateur a un profil mais aucune campagne. */
function CrmReadingSummary({ onSuggestionClick }) {
  const t = useT();
  const { lang } = useI18n();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    request('/crm/reading-summary')
      .then(setSummary)
      .catch((err) => { console.warn('reading-summary failed:', err.message); });
  }, []);

  if (!summary || !summary.totalDeals) return null;

  const money = (n) => {
    if (!n) return '0 €';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M €`;
    if (n >= 1000) return `${Math.round(n / 1000)}k €`;
    return `${Math.round(n)} €`;
  };

  const revivePrompt = (d) => (lang === 'en'
    ? `Draft a follow-up for the deal "${d.name}"${d.company ? ` (${d.company})` : ''} — no activity for ${d.daysInactive} days.`
    : `Prépare une relance pour le deal « ${d.name} »${d.company ? ` (${d.company})` : ''} — sans activité depuis ${d.daysInactive} jours.`);

  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 18px', marginBottom: 20,
      textAlign: 'left', maxWidth: 520, width: '100%',
    }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {t('chat.readSummary')
          .replace('{count}', summary.totalDeals)
          .replace('{value}', money(summary.openValue))}
        {summary.dormant.count > 0 && (
          <> {t('chat.readDormant')
            .replace('{count}', summary.dormant.count)
            .replace('{days}', summary.stagnantDays ?? 30)}</>
        )}
        {summary.dormant.noValueCount > 0 && (
          <> {t('chat.readDormantNoValue').replace('{count}', summary.dormant.noValueCount)}</>
        )}
      </div>
      {summary.dormant.top.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
          {t('chat.readStartWith')}
        </div>
      )}
      {summary.dormant.top.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {summary.dormant.top.map(d => (
            <button
              key={d.id}
              onClick={() => {
                trackEvent('reading_summary_revive_click', { daysInactive: d.daysInactive });
                onSuggestionClick(revivePrompt(d));
              }}
              style={{
                background: 'var(--paper-2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 12px', textAlign: 'left',
                cursor: 'pointer', fontSize: 13, color: 'var(--ink)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{d.name}</strong>{d.company ? ` · ${d.company}` : ''}
              </span>
              <span style={{ flexShrink: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
                {money(d.dealValue)} · {t('chat.readDays').replace('{days}', d.daysInactive)} →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export {
  SendEmailCard,
  CrmActionCard,
  CreateTriggerCard,
  ToggleAutopilotCard,
  ListClientsCard,
  SignalSearchCard,
  NewsletterCard,
  CrmReadingSummary,
};
