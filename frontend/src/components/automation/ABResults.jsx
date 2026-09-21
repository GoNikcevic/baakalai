/* ===============================================================================
   BAKAL · Résultats des tests A/B sur les emails de relance
   Déplacé depuis NurturePage · le contenu n'a pas changé.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';

export default function ABResults() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request('/nurture/ab-results')
      .then(data => setTests(data.tests || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;

  if (tests.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        {en ? 'No A/B tests yet. Enable A/B on your rules to start testing.' : 'Aucun test A/B. Activez le A/B sur vos règles pour commencer.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tests.map(test => {
        const a = test.variants?.A;
        const b = test.variants?.B;
        if (!a && !b) return null;

        const totalSent = (a?.sent || 0) + (b?.sent || 0);
        const winner = a && b ? (a.replyRate > b.replyRate ? 'A' : b.replyRate > a.replyRate ? 'B' : null) : null;
        const diff = a && b ? Math.abs(a.replyRate - b.replyRate) : 0;
        const significant = totalSent >= 10 && diff >= 10;

        return (
          <div key={test.id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '20px 24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                {' · '}{totalSent} {en ? 'emails sent' : 'emails envoyés'}
              </div>
              {winner && significant && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                  background: '#DCFCE7', color: '#16A34A',
                }}>
                  {en ? `Variant ${winner} wins (+${diff}pts)` : `Variante ${winner} gagne (+${diff}pts)`}
                </span>
              )}
              {!significant && totalSent >= 4 && (
                <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, background: '#FEF3C7', color: '#D97706' }}>
                  {en ? 'Not enough data yet' : 'Pas assez de données'}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['A', 'B'].map(variant => {
                const v = test.variants?.[variant];
                if (!v) return <div key={variant} />;
                const isWinner = winner === variant && significant;
                return (
                  <div key={variant} style={{
                    padding: 14, borderRadius: 10,
                    border: `2px solid ${isWinner ? '#16A34A' : 'var(--border)'}`,
                    background: isWinner ? 'rgba(22,163,74,0.03)' : 'var(--bg-elevated)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>
                        {en ? 'Variant' : 'Variante'} {variant}
                        {isWinner && (
                          <Icon name="award" size={13} color="var(--success)" style={{ display: 'inline-block', verticalAlign: '-2px', marginLeft: 5 }} />
                        )}
                      </span>
                      <span style={{
                        fontSize: 20, fontWeight: 800,
                        color: v.replyRate >= 20 ? '#16A34A' : v.replyRate >= 10 ? '#D97706' : 'var(--text-primary)',
                      }}>
                        {v.replyRate}%
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {v.sent} {en ? 'sent' : 'envoyés'} · {v.replies} {en ? 'replies' : 'réponses'}
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3, transition: 'width 0.5s',
                        width: `${Math.min(v.replyRate, 100)}%`,
                        background: isWinner ? '#16A34A' : 'var(--accent)',
                      }} />
                    </div>
                    {v.sampleSubject && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{v.sampleSubject}"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
