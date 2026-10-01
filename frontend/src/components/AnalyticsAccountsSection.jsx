/* ═══════════════════════════════════════════════════
   Analytics au niveau SOCIETE · lot 7.

   Tout le reste de la page Analytics compte des CONTACTS, et c'est juste pour
   un funnel de personnes. Mais le pipeline, le cycle de vente et le risque sont
   des faits d'entreprise : les lire sur la ligne du contact est ce qui rendait
   659 800 € invisibles sous Deals (mesuré sur staging le 2026-10-01).

   La réponse du serveur dit de quelle table viennent les montants, et l'écran le
   répète quand ce n'est pas `deals` : un chiffre dont on ignore la source est un
   chiffre qu'on ne peut pas défendre.

   Dans son propre fichier et non dans CRMAnalyticsPage, qui fait déjà 2029
   lignes. Les barres sont redessinées ici plutôt que d'exporter `StageBars` :
   la forme des données diffère (une étape porte un montant en plus d'un
   compte), et un composant autonome vaut mieux qu'un paramètre de plus.
   ═══════════════════════════════════════════════════ */

import { useT, useI18n } from '../i18n';

export default function AnalyticsAccountsSection({ data }) {
  const t = useT();
  const { lang } = useI18n();
  const loc = lang === 'en' ? 'en-US' : 'fr-FR';
  const { pipeline = {}, risk = {}, accounts = {}, stages = [] } = data || {};

  // NULL n'est pas zéro : on écrit "inconnu" plutôt qu'un 0 qui mentirait, et un mot
  // se lit là où un glyphe se devine.
  const nb = (v) => (v == null ? t('analytics.accountsUnknown') : Number(v).toLocaleString(loc));
  const eur = (v) => (v == null ? t('analytics.accountsUnknown') : `${Math.round(Number(v)).toLocaleString(loc)} €`);

  const bandes = [
    { cle: 'healthy', n: risk.bands?.healthy || 0, couleur: 'var(--success)' },
    { cle: 'medium', n: risk.bands?.medium || 0, couleur: 'var(--warning)' },
    { cle: 'high', n: risk.bands?.high || 0, couleur: 'var(--warning)' },
    { cle: 'critical', n: risk.bands?.critical || 0, couleur: 'var(--danger)' },
  ];
  const totalBandes = bandes.reduce((s, b) => s + b.n, 0);
  const maxEtape = Math.max(1, ...stages.map(s => Number(s.value) || 0));

  const tuile = (titre, valeur, dessous, couleur) => (
    <div className="card">
      <div className="card-body">
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{titre}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: couleur || 'inherit' }}>{valeur}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dessous}</div>
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* La source des montants, dite AVANT les montants eux-memes. */}
      {data?.source === 'opportunities' && (
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
        }}>
          {t('analytics.accountsFromContacts')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 20 }}>
        {tuile(
          t('analytics.accountsOpenValue'),
          eur(pipeline.openValue),
          t('analytics.accountsOpenDeals', { count: pipeline.openDeals || 0 })
        )}
        {tuile(
          t('analytics.accountsWinRate'),
          pipeline.winRate365d == null ? t('analytics.accountsUnknown') : `${pipeline.winRate365d} %`,
          pipeline.winRate365d == null
            ? t('analytics.accountsNoOutcome')
            : t('analytics.accountsWonLost', { won: pipeline.won365d, lost: pipeline.lost365d })
        )}
        {tuile(
          t('analytics.accountsCycle'),
          pipeline.avgCycleDays == null ? t('analytics.accountsUnknown') : t('analytics.accountsDays', { days: pipeline.avgCycleDays }),
          t('analytics.accountsCycleBasis')
        )}
        {tuile(
          t('analytics.accountsTicket'),
          eur(pipeline.avgTicket),
          t('analytics.accountsTicketBasis')
        )}
      </div>

      <div className="crm-grid-2">
        {stages.length > 0 && (
          <div className="card">
            <div className="card-title">{t('analytics.accountsStagesTitle')}</div>
            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stages.map((s, i) => (
                  <div key={`${s.stage}-${i}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginBottom: 3 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.stage}
                      </span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {eur(s.value)}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                          {' · '}{t('analytics.accountsOpenDeals', { count: s.count })}
                        </span>
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.max(2, ((Number(s.value) || 0) / maxEtape) * 100)}%`,
                        height: '100%', background: 'var(--purple)', borderRadius: 4,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-title">{t('analytics.accountsRiskTitle')}</div>
          <div className="card-body">
            {totalBandes === 0 ? (
              /* L'etat vide est explicatif, pas decoratif : aucun compte score ne
                 veut pas dire aucun risque, ca veut dire que le calcul n'est pas
                 encore passe. */
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('analytics.accountsNoScore')}</div>
            ) : (
              <>
                <div
                  style={{ display: 'flex', gap: 2, height: 13, marginBottom: 12 }}
                  role="img"
                  aria-label={bandes.map(b => `${t(`analytics.accountsBand_${b.cle}`)} ${b.n}`).join(', ')}
                >
                  {bandes.filter(b => b.n > 0).map(b => (
                    <span key={b.cle} style={{ flex: b.n, background: b.couleur, borderRadius: 2 }} />
                  ))}
                </div>
                {/* Legende toujours presente et chiffree : l'identite d'une bande
                    ne doit jamais reposer sur la seule couleur. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12 }}>
                  {bandes.map(b => (
                    <span key={b.cle} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: b.couleur, flexShrink: 0 }} />
                      {t(`analytics.accountsBand_${b.cle}`)} <b>{b.n}</b>
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                  {t('analytics.accountsAtRisk', { count: risk.atRisk || 0, threshold: risk.threshold })}
                  {risk.notScored > 0 ? ` · ${t('analytics.accountsNotScored', { count: risk.notScored })}` : ''}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('analytics.accountsWhatTitle')}</div>
        <div className="card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t('analytics.accountsUpsell')}</span>
              <b>{nb(accounts.upsell)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t('analytics.accountsWithoutContact')}</span>
              <b style={{ color: accounts.withoutContact > 0 ? 'var(--warning)' : 'inherit' }}>
                {nb(accounts.withoutContact)}
              </b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t('analytics.accountsContactsPer')}</span>
              <b>{nb(accounts.avgContacts)}</b>
            </div>
          </div>
          {accounts.withoutContact > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              {t('analytics.accountsWithoutContactWhy')}
            </div>
          )}
          {accounts.medianContacts != null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('analytics.accountsContactsSpread', { median: accounts.medianContacts, max: accounts.maxContacts })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
