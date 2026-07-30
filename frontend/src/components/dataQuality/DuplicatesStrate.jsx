/* ===============================================================================
   BAKAL — Duplicates Strate
   Scans every connected CRM independently (duplicates are a same-CRM concept only —
   the same person legitimately existing in two different CRMs is normal, never
   flagged). Each provider's duplicate groups get the new merge-review UX;
   non-duplicate issues from the same scan (missing email, invalid format, etc.) are
   shown underneath, unchanged from the previous flat card list.
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

function OtherIssueCard({ provider, issue, onFixed }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const t = useT();
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const config = getOtherIssueConfig(en)[issue.type] || { icon: '?', label: issue.type, color: 'var(--text-muted)' };
  const count = issue.count || issue.contacts?.length || 0;

  const handleFix = async () => {
    setFixing(true);
    try {
      if (issue.suggestedAction === 'enrich') {
        const issueType = issue.type === 'missing_email' ? 'missing_email' : issue.type === 'missing_company' ? 'missing_company' : 'all';
        const contactIds = (issue.contacts || []).map(c => c.id).filter(Boolean);
        const result = await request('/crm/enrich', { method: 'POST', body: JSON.stringify({ issueType, contactIds, limit: 20 }) });
        setFixResult({ message: en ? `${result.enriched} enriched` : `${result.enriched} enrichis` });
      } else {
        let fixes = [];
        if (issue.type === 'format_name_caps' || issue.suggestedAction === 'auto_fix') {
          fixes = [{ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts }];
        } else if (issue.suggestedAction === 'archive') {
          fixes = [{ type: issue.type, action: 'archive', contactIds: issue.contacts.map(c => c.id) }];
        } else if (issue.suggestedAction === 'verify') {
          fixes = [{ type: issue.type, action: 'verify_emails', contactIds: issue.contacts.map(c => c.id) }];
        }
        if (fixes.length > 0) {
          const result = await request(`/crm/clean/${provider}`, { method: 'POST', body: JSON.stringify({ fixes }) });
          setFixResult({ message: `${result.applied || 0} ${en ? 'fixed' : 'corrigé(s)'}` });
        }
      }
      if (onFixed) onFixed();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setFixing(false);
  };

  return (
    <div className="card" style={{ borderLeft: `3px solid ${config.color}` }}>
      <div className="card-body" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
        ) : issue.suggestedAction === 'review' ? null : (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={fixing} onClick={handleFix}>
            {fixing ? '…' : (en ? 'Fix' : 'Corriger')}
          </button>
        )}
      </div>
    </div>
  );
}

function ProviderBlock({ provider, data, onRescan }) {
  const t = useT();
  const [rescanning, setRescanning] = useState(false);

  if (data.error) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '14px 16px', fontSize: 12, color: 'var(--danger)' }}>
          {PROVIDER_LABELS[provider] || provider}: {data.error}
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
        <div style={{ fontSize: 14, fontWeight: 700 }}>{PROVIDER_LABELS[provider] || provider}</div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={rescanning} onClick={handleRescan}>
          {rescanning ? t('dataQuality.duplicates.scanning') : `🔄 ${t('dataQuality.duplicates.rescan')}`}
        </button>
      </div>

      {data.duplicateGroups.length === 0 && data.otherIssues.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>{t('dataQuality.duplicates.noneFound')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
