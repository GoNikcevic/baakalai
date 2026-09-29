/* ═══════════════════════════════════════════════════
   Les COMPTES · l'écran qui manquait (lot 2, migration 124).

   Jusqu'ici baakalai n'avait qu'une population, les contacts, et une société
   n'existait que comme texte répété sur chacun d'eux. Impossible de voir ce
   qu'une entreprise pèse, qui la suit, ni qu'elle porte à la fois un deal
   gagné et un deal ouvert, ce qui est pourtant la définition même de l'upsell.

   Cette liste répond à une question et une seule : avec qui je travaille, et
   qu'est-ce que ça représente. Les colonnes sont donc celles d'un compte, pas
   celles d'une personne.

   Le silence affiché est celui du COMPTE, c'est-à-dire la dernière activité de
   n'importe lequel de ses contacts (arbitrage du 29/09) : un compte n'est pas
   silencieux parce qu'un de ses interlocuteurs l'est.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { request } from '../services/api-client';
import { useT } from '../i18n';

/** Mêmes seuils que la page Deals · un compte et un deal ne peuvent pas être
 *  « au point mort » à deux dates différentes. */
const DORMANT_DAYS = 30;
const STALLED_DAYS = 60;

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// Sans activité connue, gris et jamais rouge : une donnée manquante n'est pas
// une alerte. Même règle que silenceColor sous Deals.
function silenceColor(days) {
  if (days == null) return 'var(--text-muted)';
  if (days > STALLED_DAYS) return 'var(--danger)';
  if (days > DORMANT_DAYS) return 'var(--warning)';
  return 'var(--success)';
}

export default function AccountsPage() {
  const t = useT();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let vivant = true;
    request('/crm/accounts')
      .then(data => { if (vivant) setAccounts(data.accounts || []); })
      .catch(() => { /* liste vide plutôt qu'un écran d'erreur */ })
      .finally(() => { if (vivant) setLoading(false); });
    return () => { vivant = false; };
  }, []);

  const q = search.trim().toLowerCase();
  const filtres = q
    ? accounts.filter(a => (a.name || '').toLowerCase().includes(q))
    : accounts;

  const montantTotal = accounts.reduce((s, a) => s + Number(a.montant || 0), 0);
  const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`;

  if (loading) return null;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t('accounts.title')}</h1>
        <div className="page-subtitle">
          {t('accounts.subtitle', { count: accounts.length, value: money(montantTotal) })}
        </div>
      </div>

      {accounts.length === 0 ? (
        /* Le vide est explicatif, pas décoratif : un écran de comptes vide
           laisse croire à une panne alors que c'est le CRM qui n'a pas encore
           été lu. */
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>
          {t('accounts.empty')}
        </div>
      ) : (
        <>
          <input
            className="form-input"
            style={{ width: '100%', marginBottom: 12 }}
            placeholder={t('accounts.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtres.map(a => {
              const jours = daysSince(a.last_activity_at);
              return (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 14, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 13,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {t('accounts.contacts', { count: a.contacts })}
                      {a.owner_email ? ` · ${a.owner_email.split('@')[0]}` : ''}
                      {/* L'origine du compte est dite quand elle est incertaine,
                          et tue seulement quand elle ne l'est pas. Un compte
                          reconstruit depuis un nom n'a pas la même valeur de
                          preuve qu'un compte lu dans le CRM. */}
                      {a.source === 'derived' ? ` · ${t('accounts.derived')}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {/* Gagné ET ouvert sur le même compte : c'est ça, l'upsell,
                        et c'était invisible avant cet écran.

                        Fond neutre et couleur portée par le texte · la forme
                        `${couleur}15` employée ailleurs concatène une opacité à
                        une variable CSS, ce qui ne produit aucune couleur
                        valide. Autant ne pas la propager. */}
                    {a.deals_gagnes > 0 && (
                      <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--success)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {t('accounts.won', { count: a.deals_gagnes })}
                      </span>
                    )}
                    {a.deals_ouverts > 0 && (
                      <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {t('accounts.open', { count: a.deals_ouverts })}
                      </span>
                    )}
                    {Number(a.montant) > 0 && (
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(a.montant)}</span>
                    )}
                    <span style={{ fontSize: 11, color: silenceColor(jours), whiteSpace: 'nowrap' }}>
                      {jours == null ? t('accounts.noActivity') : t('accounts.days', { days: jours })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
