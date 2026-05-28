/* ===============================================================================
   BAKAL — CRM Diagnostic Report
   Full-screen modal shown after first CRM import.
   Displays: contact stats, health score, churn risk, deal coach suggestions,
   top companies — all from POST /api/crm/first-diagnostic.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT, useI18n } from '../i18n';

const ISSUE_META = {
  duplicate_email: { icon: '\uD83D\uDD04', color: 'var(--danger)' },
  duplicate_name: { icon: '\uD83D\uDC65', color: 'var(--warning)' },
  missing_email: { icon: '\uD83D\uDCE7', color: 'var(--danger)' },
  missing_name: { icon: '\uD83D\uDC64', color: 'var(--warning)' },
  missing_company: { icon: '\uD83C\uDFE2', color: 'var(--text-muted)' },
  invalid_email: { icon: '\u26A0\uFE0F', color: 'var(--danger)' },
  inactive: { icon: '\uD83D\uDE34', color: 'var(--text-muted)' },
  format_name_caps: { icon: 'Aa', color: 'var(--blue)' },
};

const URGENCY_COLORS = {
  high: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.2)' },
  medium: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
  low: { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', border: 'rgba(34,197,94,0.2)' },
};

const ACTION_ICONS = {
  email: '\uD83D\uDCE7',
  call: '\uD83D\uDCDE',
  linkedin: '\uD83D\uDC64',
  content: '\uD83D\uDCCE',
  intro: '\uD83E\uDD1D',
  offer: '\uD83C\uDF81',
};

export default function CRMDiagnosticReport({ onClose }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fixing, setFixing] = useState(null);
  const [fixingAll, setFixingAll] = useState(false);

  useEffect(() => {
    request('/crm/first-diagnostic', { method: 'POST' })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleFix = useCallback(async (issue) => {
    if (!data?.provider) return;
    setFixing(issue.type);
    try {
      let fixes = [];
      if (issue.type === 'format_name_caps') {
        fixes = [{ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts }];
      } else if (issue.suggestedAction === 'delete' || issue.suggestedAction === 'archive') {
        fixes = [{ type: issue.type, action: 'delete', contactIds: issue.contacts.map(c => c.id) }];
      } else if ((issue.suggestedAction === 'merge' || issue.suggestedAction === 'review') && issue.contacts?.length >= 2) {
        fixes = [{ type: issue.type, action: 'merge', contactIds: issue.contacts.map(c => c.id) }];
      }
      if (fixes.length > 0) {
        await request(`/crm/clean/${data.provider}`, {
          method: 'POST',
          body: JSON.stringify({ fixes }),
        });
        showToast({ type: 'success', title: en ? 'Fixed' : 'Corrigé', message: `${issue.type.replace(/_/g, ' ')}` });
        const fresh = await request('/crm/first-diagnostic', { method: 'POST' });
        setData(fresh);
      }
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message || 'Fix failed' });
    }
    setFixing(null);
  }, [data?.provider, en]);

  const handleFixAll = useCallback(async () => {
    const health = data?.health;
    if (!data?.provider || !health?.issues) return;
    setFixingAll(true);
    try {
      const fixes = [];
      for (const issue of health.issues) {
        if (issue.type === 'format_name_caps') {
          fixes.push({ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts });
        } else if (issue.suggestedAction === 'delete' || issue.suggestedAction === 'archive') {
          fixes.push({ type: issue.type, action: 'delete', contactIds: issue.contacts.map(c => c.id) });
        } else if ((issue.suggestedAction === 'merge' || issue.suggestedAction === 'review') && issue.contacts?.length >= 2) {
          fixes.push({ type: issue.type, action: 'merge', contactIds: issue.contacts.map(c => c.id) });
        }
      }
      if (fixes.length > 0) {
        await request(`/crm/clean/${data.provider}`, {
          method: 'POST',
          body: JSON.stringify({ fixes }),
        });
        showToast({ type: 'success', title: en ? 'All fixed' : 'Tout corrigé', message: `${fixes.length} ${en ? 'issue(s) resolved' : 'problème(s) résolus'}` });
        const fresh = await request('/crm/first-diagnostic', { method: 'POST' });
        setData(fresh);
      }
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message || 'Fix all failed' });
    }
    setFixingAll(false);
  }, [data, en]);

  function handleNav(path) {
    localStorage.setItem('bakal_diagnostic_seen', 'true');
    if (onClose) onClose();
    navigate(path);
  }

  /* ── Loading state ── */
  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={{ textAlign: 'center', padding: '60px 40px' }}>
            <div style={styles.spinner} />
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 24, color: 'var(--text)' }}>
              {t('diagnostic.loading')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, maxWidth: 360, margin: '8px auto 0' }}>
              {t('diagnostic.loadingDesc')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error || !data) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={{ textAlign: 'center', padding: '60px 40px' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>{'\u26A0\uFE0F'}</div>
            <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>{t('diagnostic.error')}</div>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => handleNav('/dashboard')}>
              {t('diagnostic.goToDashboard')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── No data state ── */
  if (!data.contacts || data.contacts.total === 0) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={{ textAlign: 'center', padding: '60px 40px' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>{'\uD83D\uDCCB'}</div>
            <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>{t('diagnostic.noData')}</div>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => handleNav('/clients')}>
              {t('diagnostic.goToClients')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { contacts, health, churn, dealCoach } = data;
  const healthLabel = health?.score >= 80 ? t('diagnostic.healthExcellent')
    : health?.score >= 50 ? t('diagnostic.healthGood')
    : health?.score != null && health.score < 30 ? t('diagnostic.healthCritical')
    : t('diagnostic.healthFair');
  const healthColor = health?.score >= 80 ? '#22c55e'
    : health?.score >= 50 ? '#3b82f6'
    : health?.score != null && health.score < 30 ? '#ef4444'
    : '#f59e0b';

  const totalChurn = churn.critical + churn.high + churn.medium + churn.low;

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, maxWidth: 720 }}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>{'\uD83D\uDD0D'}</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
            {t('diagnostic.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {t('diagnostic.subtitle')}
          </p>
        </div>

        <div style={styles.body}>
          {/* ── ROW 1: Contact stats + Health score ── */}
          <div style={styles.row}>
            {/* Contacts card */}
            <div style={{ ...styles.card, flex: 1 }}>
              <div style={styles.cardLabel}>{t('diagnostic.contacts')}</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>
                {contacts.total}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {contacts.withEmail} {t('diagnostic.withEmail')} &middot; {contacts.withCompany} {t('diagnostic.withCompany')}
              </div>
              {/* Positive metrics */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {contacts.total > 0 && contacts.withEmail > 0 && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: contacts.withEmail / contacts.total >= 0.8 ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                    color: contacts.withEmail / contacts.total >= 0.8 ? '#22c55e' : '#f59e0b',
                  }}>
                    {Math.round(contacts.withEmail / contacts.total * 100)}% {t('diagnostic.haveEmail')}
                  </span>
                )}
                {contacts.total > 0 && contacts.withCompany > 0 && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: contacts.withCompany / contacts.total >= 0.8 ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                    color: contacts.withCompany / contacts.total >= 0.8 ? '#22c55e' : '#f59e0b',
                  }}>
                    {Math.round(contacts.withCompany / contacts.total * 100)}% {t('diagnostic.haveCompany')}
                  </span>
                )}
              </div>
              {/* Status breakdown */}
              {contacts.byStatus && Object.keys(contacts.byStatus).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {Object.entries(contacts.byStatus).map(([status, count]) => (
                    <span key={status} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                    }}>
                      {status}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Health score card */}
            {health && health.score != null && (
              <div style={{ ...styles.card, flex: 1, textAlign: 'center' }}>
                <div style={styles.cardLabel}>{t('diagnostic.healthScore')}</div>
                <div style={{ position: 'relative', width: 80, height: 80, margin: '8px auto' }}>
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="6" />
                    <circle cx="40" cy="40" r="34" fill="none" stroke={healthColor} strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${(health.score / 100) * 213.6} 213.6`}
                      transform="rotate(-90 40 40)"
                      style={{ transition: 'stroke-dasharray 0.8s ease' }}
                    />
                  </svg>
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: healthColor }}>{health.score}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: healthColor }}>{healthLabel}</div>
                {health.issues && health.issues.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {t('diagnostic.issuesFound', { count: health.issues.length })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Health issues with fix buttons ── */}
          {health?.issues && health.issues.length > 0 && (
            <div style={styles.section}>
              {health.issues.filter(i => i.suggestedAction && i.suggestedAction !== 'enrich').length > 1 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '6px 14px' }}
                    disabled={fixingAll}
                    onClick={handleFixAll}
                  >
                    {fixingAll ? '...' : t('diagnostic.fixAll')}
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {health.issues.map((issue, i) => {
                  const meta = ISSUE_META[issue.type] || { icon: '\u2022', color: 'var(--text-muted)' };
                  const isMergeable = issue.suggestedAction === 'merge'
                    || (issue.suggestedAction === 'review' && issue.contacts?.length >= 2);
                  const actionLabel = isMergeable ? t('diagnostic.merge')
                    : issue.suggestedAction === 'archive' || issue.suggestedAction === 'delete' ? t('diagnostic.archive')
                    : issue.suggestedAction === 'auto_fix' ? t('diagnostic.fix')
                    : t('diagnostic.fix');
                  const issueLabel = t(`diagnostic.issue_${issue.type}`) || issue.type.replace(/_/g, ' ');
                  const showAction = issue.suggestedAction && issue.suggestedAction !== 'enrich';
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 13,
                    }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{meta.icon}</span>
                      <span style={{ flex: 1, color: 'var(--text)', minWidth: 0 }}>
                        {issue.count != null && (
                          <strong style={{ color: meta.color }}>{issue.count} </strong>
                        )}
                        {issueLabel}
                        {issue.key && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>
                            — {issue.key}
                          </span>
                        )}
                      </span>
                      {showAction && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 10px', color: 'var(--primary)', flexShrink: 0 }}
                          disabled={fixing === issue.type}
                          onClick={() => handleFix(issue)}
                        >
                          {fixing === issue.type ? '...' : actionLabel}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── ROW 2: Churn risk + Top companies ── */}
          <div style={styles.row}>
            {/* Churn risk */}
            {totalChurn > 0 && (
              <div style={{ ...styles.card, flex: 1 }}>
                <div style={styles.cardLabel}>{t('diagnostic.churnTitle')}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  {[
                    { key: 'critical', count: churn.critical, color: '#ef4444' },
                    { key: 'high', count: churn.high, color: '#f97316' },
                    { key: 'medium', count: churn.medium, color: '#f59e0b' },
                    { key: 'low', count: churn.low, color: '#22c55e' },
                  ].filter(c => c.count > 0).map(c => (
                    <div key={c.key} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.count}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(`diagnostic.${c.key}`)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top companies */}
            {contacts.topCompanies && contacts.topCompanies.length > 0 && (
              <div style={{ ...styles.card, flex: 1 }}>
                <div style={styles.cardLabel}>{t('diagnostic.topCompanies')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                  {contacts.topCompanies.slice(0, 6).map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text)' }}>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Deal Coach suggestions ── */}
          {dealCoach && dealCoach.suggestions && dealCoach.suggestions.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>{t('diagnostic.dealCoachTitle')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dealCoach.suggestions.map((s, i) => {
                  const urgency = URGENCY_COLORS[s.urgency] || URGENCY_COLORS.medium;
                  const actionIcon = ACTION_ICONS[s.action] || '\u27A1\uFE0F';
                  const urgencyLabel = s.urgency === 'high' ? t('diagnostic.urgencyHigh')
                    : s.urgency === 'low' ? t('diagnostic.urgencyLow')
                    : t('diagnostic.urgencyMedium');
                  return (
                    <div key={i} style={{
                      padding: '12px 14px', borderRadius: 10,
                      background: urgency.bg, border: `1px solid ${urgency.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 16 }}>{actionIcon}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          {s.contactName} {s.company ? `@ ${s.company}` : ''}
                        </span>
                        <span style={{
                          marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px',
                          borderRadius: 4, color: urgency.color, background: `${urgency.color}15`,
                        }}>
                          {urgencyLabel}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                        {s.reason}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text)', fontStyle: 'italic' }}>
                        {s.suggestion}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dealCoach && (!dealCoach.suggestions || dealCoach.suggestions.length === 0) && !dealCoach.skipped && (
            <div style={{ ...styles.section, textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 13, color: 'var(--success)' }}>
                {'\u2705'} {t('diagnostic.dealCoachEmpty')}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={styles.footer}>
          <button className="btn btn-ghost" onClick={() => handleNav('/crm-analytics')}>
            {t('diagnostic.goToHealth')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => handleNav('/clients')}>
              {t('diagnostic.goToClients')}
            </button>
            <button className="btn btn-primary" onClick={() => handleNav('/dashboard')}>
              {t('diagnostic.goToDashboard')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Inline styles ── */
const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, overflowY: 'auto',
  },
  modal: {
    background: 'var(--bg-primary)', borderRadius: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    maxWidth: 680, width: '100%', maxHeight: '90vh', overflowY: 'auto',
    animation: 'fadeInUp 0.4s ease-out',
  },
  header: {
    padding: '28px 28px 12px', textAlign: 'center',
    borderBottom: '1px solid var(--border)',
  },
  body: {
    padding: '20px 28px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  footer: {
    padding: '16px 28px', borderTop: '1px solid var(--border)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  row: {
    display: 'flex', gap: 12,
  },
  card: {
    padding: '16px 18px', borderRadius: 12,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  },
  cardLabel: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'var(--text-muted)', marginBottom: 4,
  },
  section: {
    padding: '12px 0',
  },
  sectionTitle: {
    fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10,
  },
  spinner: {
    width: 40, height: 40, border: '3px solid var(--border)',
    borderTopColor: 'var(--primary)', borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto',
  },
};
