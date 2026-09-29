/* ═══════════════════════════════════════════════════
   Les rattachements de deals que baakalai a devinés.

   Pendant de StageMappingSettings, au même endroit dans les Réglages : l'un dit
   ce que baakalai a compris du pipeline, celui-ci ce qu'il a supposé du
   rattachement des deals à leurs interlocuteurs.

   La section n'existe que s'il y a quelque chose à confirmer. Un CRM qui
   remplit ses contact roles ne la verra jamais, et c'est bien : une question
   posée sans objet use la confiance aussi sûrement qu'une erreur.

   Une seule question, en bloc. « Ce contact-ci est-il le bon » n'est pas
   répondable sur trois cents deals, et le user n'en sait pas plus que baakalai
   sur une org qu'il n'a pas remplie. La question qui se répond, c'est : est-ce
   que je fais confiance à la déduction.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';

export default function DealAttributionSettings() {
  const t = useT();
  const [total, setTotal] = useState(0);
  const [sample, setSample] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request('/crm/deal-attribution');
      setTotal(data.total || 0);
      setSample(data.sample || []);
    } catch { /* la section disparaît plutôt que d'afficher une erreur */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const data = await request('/crm/deal-attribution/confirm', { method: 'POST' });
      showToast({
        type: 'success',
        title: t('dealAttribution.title'),
        message: t('dealAttribution.confirmed', { count: data.confirmed || 0 }),
      });
      // La section disparaît : il n'y a plus rien à relire.
      setTotal(0);
      setSample([]);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err?.message || '' });
    }
    setConfirming(false);
  };

  if (loading || total === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="card-title">{t('dealAttribution.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {t('dealAttribution.subtitle', { count: total })}
          </div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}
          onClick={handleConfirm}
          disabled={confirming}
        >
          {confirming ? t('dealAttribution.confirming') : t('dealAttribution.confirm')}
        </button>
      </div>

      <div className="card-body">
        {/* Les plus gros montants d'abord : c'est là qu'un porteur mal deviné
            coûte le plus cher, donc là que le user veut regarder. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sample.map(o => (
            <div key={o.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-card)', fontSize: 12,
            }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{o.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {[o.title, o.company].filter(Boolean).join(' · ')}
                </div>
              </div>
              {o.deal_value != null && (
                <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {Number(o.deal_value).toLocaleString('fr-FR')} {'€'}
                </span>
              )}
            </div>
          ))}
        </div>

        {total > sample.length && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {t('dealAttribution.andMore', { count: total - sample.length })}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          {t('dealAttribution.footnote')}
        </div>
      </div>
    </div>
  );
}
