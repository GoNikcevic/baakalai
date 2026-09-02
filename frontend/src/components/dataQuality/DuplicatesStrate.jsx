/* ===============================================================================
   BAKAL — General Strate (Data Quality's "Général" tab)
   CRM hygiene issues that aren't specific to a deal or a client — duplicates, missing
   fields, invalid formats, inactivity. Scans every connected CRM independently
   (duplicates are a same-CRM concept only — the same person legitimately existing in
   two different CRMs is normal, never flagged). Each provider's duplicate groups get
   the merge-review UX; other general issues from the same scan are shown underneath.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useI18n, useT } from '../../i18n';
import MergeReviewPanel from './MergeReviewPanel';

const PROVIDER_LABELS = {
  pipedrive: 'Pipedrive', hubspot: 'HubSpot', salesforce: 'Salesforce',
  odoo: 'Odoo', notion: 'Notion', airtable: 'Airtable', folk: 'Folk',
};

function getOtherIssueConfig(en) { return {
  missing_email: { icon: '📧', label: en ? 'Missing email' : 'Email manquant', color: 'var(--danger)' },
  missing_name: { icon: '👤', label: en ? 'Missing name' : 'Nom manquant', color: 'var(--warning)' },
  missing_company: { icon: '🏢', label: en ? 'Missing company' : 'Entreprise manquante', color: 'var(--text-muted)' },
  invalid_email_format: { icon: '⚠️', label: en ? 'Invalid email format' : 'Format d\'email invalide', color: 'var(--danger)' },
  invalid_email_domain: { icon: '⚠️', label: en ? 'Invalid email domain' : 'Domaine email invalide', color: 'var(--danger)' },
  inactive: { icon: '💤', label: en ? 'Inactive contacts (6+ months)' : 'Contacts inactifs (6+ mois)', color: 'var(--text-muted)' },
  format_name_caps: { icon: 'Aa', label: en ? 'Names in ALL CAPS' : 'Noms en MAJUSCULES', color: 'var(--blue)' },
}; }

// Issue types correctable by typing in the right value for one field — same mechanism as the
// Deal Quality sector/deal value fix (a text field + "Enregistrer", calling POST /enrich-field,
// with full audit + undo). No AI guessing: predictable, and works even for data an enrichment
// agent could never find (test contacts, unlisted companies, etc).
const FIXABLE_FIELD_BY_ISSUE_TYPE = {
  missing_email: 'email',
  missing_name: 'name',
  missing_company: 'company',
  invalid_email_format: 'email',
  invalid_email_domain: 'email',
};

function FieldFixRow({ provider, contact, field, en, t, onSaved }) {
  const [value, setValue] = useState(contact[field] || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const v = value.trim();
    if (!v) return;
    setSaving(true);
    try {
      await request('/data-quality/enrich-field', {
        method: 'POST',
        body: JSON.stringify({ provider, crmContactId: contact.id, field, value: v }),
      });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setSaving(false);
  };

  if (saved) {
    return (
      <div style={{ fontSize: 12, color: 'var(--success)', padding: '4px 0' }}>
        ✅ {contact.name || contact.email || '?'} — {value}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {contact.name || contact.email || '?'}
      </span>
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        style={{ flex: 1, padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
      />
      <button
        className="btn btn-primary"
        style={{ fontSize: 11, padding: '5px 10px', whiteSpace: 'nowrap' }}
        disabled={saving || !value.trim()}
        onClick={handleSave}
      >
        {saving ? '…' : (en ? 'Save' : 'Enregistrer')}
      </button>
    </div>
  );
}

function OtherIssueCard({ provider, issue, onFixed }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const t = useT();
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const config = getOtherIssueConfig(en)[issue.type] || { icon: '?', label: issue.type, color: 'var(--text-muted)' };
  const count = issue.count || issue.contacts?.length || 0;
  const fixField = FIXABLE_FIELD_BY_ISSUE_TYPE[issue.type];

  const handleFix = async () => {
    setFixing(true);
    try {
      let fixes = [];
      if (issue.type === 'format_name_caps' || issue.suggestedAction === 'auto_fix') {
        fixes = [{ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts }];
      } else if (issue.suggestedAction === 'archive') {
        fixes = [{ type: issue.type, action: 'archive', contactIds: issue.contacts.map(c => c.id) }];
      }
      if (fixes.length > 0) {
        const result = await request(`/crm/clean/${provider}`, { method: 'POST', body: JSON.stringify({ fixes }) });
        setFixResult({ message: `${result.applied || 0} ${en ? 'fixed' : 'corrigé(s)'}` });
      }
      if (onFixed) onFixed();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setFixing(false);
  };

  return (
    <div className="card" style={{ borderLeft: `3px solid ${config.color}` }}>
      <div className="card-body" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {config.icon} {config.label} <span style={{ fontSize: 11, color: config.color }}>{count}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {(issue.contacts || []).slice(0, 3).map(c => c.name || c.email || '?').join(', ')}
              {count > 3 && ` +${count - 3}`}
            </div>
          </div>
          {fixResult ? (
            <span style={{ fontSize: 11, color: 'var(--success)' }}>✅ {fixResult.message}</span>
          ) : fixField ? (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setExpanded(e => !e)}>
              {en ? 'Fix' : 'Corriger'}
            </button>
          ) : issue.suggestedAction === 'review' ? null : (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={fixing} onClick={handleFix}>
              {fixing ? '…' : (en ? 'Fix' : 'Corriger')}
            </button>
          )}
        </div>

        {expanded && fixField && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(issue.contacts || []).map((c, i) => (
              <FieldFixRow key={c.id || i} provider={provider} contact={c} field={fixField} en={en} t={t} onSaved={onFixed} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderBlock({ provider, data, onRescan }) {
  const t = useT();
  const [rescanning, setRescanning] = useState(false);

  const providerLabel = provider === '__no_crm__' ? t('dataQuality.duplicates.noCrmProvider') : (PROVIDER_LABELS[provider] || provider);

  if (data.error) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '14px 16px', fontSize: 12, color: 'var(--danger)' }}>
          {providerLabel}: {data.error}
        </div>
      </div>
    );
  }

  const handleRescan = async () => {
    setRescanning(true);
    try {
      await request(`/crm/scan/${provider}`, { method: 'POST' });
      if (onRescan) onRescan();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setRescanning(false);
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{providerLabel}</div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={rescanning} onClick={handleRescan}>
          {rescanning ? t('dataQuality.duplicates.scanning') : `🔄 ${t('dataQuality.duplicates.rescan')}`}
        </button>
      </div>

      {data.duplicateGroups.length === 0 && data.otherIssues.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>{t('dataQuality.duplicates.noneFound')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.duplicateGroups.length > 0 && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              {t('dataQuality.duplicates.duplicatesSectionTitle')}
            </div>
          )}
          {data.duplicateGroups.map((group, i) => (
            <div key={i} className="card">
              <div className="card-body" style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {group.contacts.map(c => c.name || c.email).join(' / ')}
                </div>
                <MergeReviewPanel provider={provider} group={group} onMerged={onRescan} />
              </div>
            </div>
          ))}

          {data.otherIssues.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginTop: 8 }}>
                {t('dataQuality.duplicates.otherIssuesTitle')}
              </div>
              {data.otherIssues.map((issue, i) => (
                <OtherIssueCard key={i} provider={provider} issue={issue} onFixed={onRescan} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function DuplicatesStrate() {
  const t = useT();
  const [providerResults, setProviderResults] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/data-quality/duplicates');
      setProviderResults(data.providerResults || []);
    } catch {
      setProviderResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('dataQuality.duplicates.scanning')}</div>;
  if (!providerResults || providerResults.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('dataQuality.banners.noCrm.title')}</div>;
  }

  return (
    <div>
      {providerResults.map(pr => (
        <ProviderBlock key={pr.provider} provider={pr.provider} data={pr} onRescan={load} />
      ))}
    </div>
  );
}
