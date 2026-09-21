/* ===============================================================================
   BAKAL · File des brouillons de relance

   Ex-onglets « En attente » et « Envoyés » de NurturePage, avec ce qui leur
   manquait : la sélection multiple. Le backend expose approve-batch et
   cancel-batch depuis des mois (la file de réactivation s'en sert), mais cet
   écran demandait un clic par brouillon · 188 clics en prod.

   La liste est chargée ici, filtrée côté serveur (?status=), et non plus
   découpée dans une page de 50 lignes tous statuts confondus.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import { useConfirm } from '../ConfirmModal';
import AppliedPatternsBanner from '../AppliedPatternsBanner';
import Icon from '../Icon';

// Plafond de POST /nurture/emails/approve-batch · au-delà on ré-appelle par tranches.
const APPROVE_BATCH_MAX = 20;
// Pagination de GET /nurture/emails (plafond serveur : 200).
const PAGE_SIZE = 200;

// Défaut stable : une lambda écrite dans la signature change d'identité à
// chaque rendu, donc `load` aussi, donc l'effet qui l'appelle boucle.
const NOOP = () => {};

export default function EmailsQueue({ type = 'pending', sendBlocked = false, summary = null, onChange = NOOP, refreshToken = 0 }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const confirm = useConfirm();

  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request(`/nurture/emails?status=${type}&limit=${PAGE_SIZE}`);
      setEmails(data.emails || []);
      setSelected(new Set());
    } catch { /* liste vide, l'état réel est de toute façon dans le résumé */ }
    setLoading(false);
    onChange();
    // refreshToken : le parent force un rechargement après un aperçu ou un
    // lancement, qui viennent d'écrire dans la file.
  }, [type, onChange, refreshToken]);

  useEffect(() => { load(); }, [load]);

  const toggleExpanded = (id, value) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      const expand = value !== undefined ? value : !next.has(id);
      if (expand) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleSelected = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = emails.length > 0 && selected.size === emails.length;
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(emails.map(e => e.id)));

  const handleApprove = async (id) => {
    try {
      await request(`/nurture/emails/${id}/approve`, { method: 'POST' });
      load();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  const handleCancel = async (id) => {
    try {
      await request(`/nurture/emails/${id}/cancel`, { method: 'POST' });
      load();
    } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Operation failed' : 'Opération échouée' }); }
  };

  const handleBulkSend = async () => {
    const ids = emails.filter(e => selected.has(e.id)).map(e => e.id);
    if (!ids.length || bulk) return;
    if (!await confirm(t('activation.queue.confirmSend', { count: ids.length }))) return;

    setBulk({ done: 0, total: ids.length });
    let sent = 0;
    let failed = 0;
    const errors = [];
    for (let i = 0; i < ids.length; i += APPROVE_BATCH_MAX) {
      const chunk = ids.slice(i, i + APPROVE_BATCH_MAX);
      try {
        const result = await request('/nurture/emails/approve-batch', {
          method: 'POST',
          body: JSON.stringify({ ids: chunk }),
        });
        sent += result.sent || 0;
        failed += result.failed || 0;
        for (const r of result.results || []) {
          if (!r.success && r.error) errors.push(r.error);
        }
      } catch (err) {
        failed += chunk.length;
        errors.push(err.message);
      }
      setBulk({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    setBulk(null);

    showToast({
      type: failed === 0 ? 'success' : (sent > 0 ? 'warning' : 'error'),
      title: t('activation.queue.sendDone', { sent, failed }),
      message: errors.slice(0, 3).join('\n'),
    });
    load();
  };

  const handleBulkCancel = async () => {
    const ids = emails.filter(e => selected.has(e.id)).map(e => e.id);
    if (!ids.length || bulk) return;
    if (!await confirm(t('activation.queue.confirmCancel', { count: ids.length }), { danger: true })) return;
    try {
      const res = await request('/nurture/emails/cancel-batch', { method: 'POST', body: JSON.stringify({ ids }) });
      showToast({ type: 'success', title: t('activation.stale.done', { count: res.cancelled || 0 }) });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    load();
  };

  const staleCount = type === 'pending' ? (summary?.stalePending || 0) : 0;
  const staleDays = summary?.staleDays || 14;

  const handlePurgeStale = async () => {
    if (!await confirm(t('activation.stale.confirm', { count: staleCount }), { danger: true })) return;
    setPurging(true);
    try {
      const res = await request('/nurture/emails/cancel-stale', {
        method: 'POST',
        body: JSON.stringify({ olderThanDays: staleDays }),
      });
      showToast({ type: 'success', title: t('activation.stale.done', { count: res.cancelled || 0 }) });
      load();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setPurging(false);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;
  }

  // La barre reste visible même quand la liste est vide : les brouillons
  // périmés sont comptés en base, pas dans les lignes chargées ici.
  const staleBar = staleCount > 0 ? (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '12px 16px', marginBottom: 12,
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {t('activation.stale.title', { count: staleCount, days: staleDays })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
          {t('activation.stale.desc')}
        </div>
      </div>
      <button
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: '6px 12px', color: 'var(--danger)', flexShrink: 0 }}
        onClick={handlePurgeStale}
        disabled={purging}
      >
        {purging ? t('activation.stale.purging') : t('activation.stale.cta')}
      </button>
    </div>
  ) : null;

  if (emails.length === 0) {
    return (
      <div>
        {staleBar}
        <div style={{
          textAlign: 'center', padding: 50,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Icon name={type === 'pending' ? 'inbox' : 'checkCircle'} size={28} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {type === 'pending' ? t('activation.noPending') : t('activation.noSent')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {staleBar}

      {/* Barre d'actions groupées */}
      {type === 'pending' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            {t('activation.queue.selectAll', { count: emails.length })}
          </label>
          <div style={{ flex: 1 }} />
          {bulk ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('activation.queue.sending', { done: bulk.done, total: bulk.total })}
            </span>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 12px', color: 'var(--danger)' }}
                disabled={selected.size === 0}
                onClick={handleBulkCancel}
              >
                {t('activation.queue.cancelSelection', { count: selected.size })}
              </button>
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '5px 14px' }}
                disabled={selected.size === 0 || sendBlocked}
                title={sendBlocked ? t('activation.mailbox.blockedHint') : undefined}
                onClick={handleBulkSend}
              >
                {t('activation.queue.sendSelection', { count: selected.size })}
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {emails.map(email => (
          <div key={email.id} className="card">
            <div className="card-body" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                {type === 'pending' && (
                  <input
                    type="checkbox"
                    checked={selected.has(email.id)}
                    onChange={() => toggleSelected(email.id)}
                    style={{ marginTop: 4, flexShrink: 0 }}
                    aria-label={email.to_name || email.to_email}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{email.to_name || email.to_email}</span>
                    {email.trigger_name && (
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                        {email.trigger_name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{email.subject}</div>
                  <div
                    style={{
                      fontSize: 12, color: 'var(--text-secondary)', marginTop: 6,
                      whiteSpace: 'pre-wrap', lineHeight: 1.5,
                      maxHeight: expandedIds.has(email.id) ? 'none' : 80, overflow: 'hidden',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleExpanded(email.id)}
                    title={en ? 'Click to expand/collapse' : 'Cliquer pour déplier/replier'}
                  >
                    {email.body}
                  </div>
                  {/* Mémoire visible : bandeau des patterns appliqués, uniquement quand le
                      brouillon est déplié (le composant ne fetch qu'une fois monté). */}
                  {type === 'pending' && expandedIds.has(email.id) && (
                    <AppliedPatternsBanner patternIds={email.pattern_ids} />
                  )}
                  {!expandedIds.has(email.id) && email.body && email.body.length > 200 && (
                    <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2, cursor: 'pointer' }}
                      onClick={() => toggleExpanded(email.id, true)}
                    >
                      {en ? 'Show full email' : 'Voir l\'email complet'}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                    {email.to_email}
                    {email.sent_at && ` · ${en ? 'Sent on' : 'Envoyé le'} ${new Date(email.sent_at).toLocaleString(en ? 'en-US' : 'fr-FR')}`}
                    {email.error && <span style={{ color: 'var(--danger)' }}> · {email.error}</span>}
                  </div>
                </div>

                {type === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginLeft: 12, flexShrink: 0 }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '4px 12px' }}
                      onClick={() => handleApprove(email.id)}
                      disabled={sendBlocked || !!bulk}
                      title={sendBlocked ? t('activation.mailbox.blockedHint') : undefined}
                    >
                      {en ? 'Send' : 'Envoyer'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '4px 12px', color: 'var(--danger)' }}
                      onClick={() => handleCancel(email.id)}
                      disabled={!!bulk}
                    >
                      {en ? 'Cancel' : 'Annuler'}
                    </button>
                  </div>
                )}

                {type === 'sent' && (
                  <span style={{ fontSize: 11, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                    <Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                    {en ? 'Sent' : 'Envoyé'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
