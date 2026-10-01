/* ═══════════════════════════════════════════════════
   La FICHE d'une société · lot 7.

   L'écran de détail qui manquait. Jusqu'ici une société n'existait qu'en ligne
   dans une liste, et cliquer dessus ne menait nulle part : tout ce qui est vrai
   d'une entreprise était soit introuvable, soit répété autant de fois qu'elle a
   d'interlocuteurs.

   Les affaires viennent de la table `deals` (migration 126), jamais de la ligne
   du contact. C'est la seule façon de montrer un gagné et un ouvert ENSEMBLE,
   ce qui est la définition même de l'upsell et restait invisible par
   construction : deux affaires ne tenaient pas sur la ligne d'une personne.

   Le score de churn affiche sa décomposition, y compris le facteur
   `activity_source` qui nomme le contact ayant maintenu le compte en vie. C'est
   ce qui rend l'arbitrage du 2026-10-01 révisable sans migration : le jour où
   un compte « sain » se révèle perdu, on peut lire que seul un opérationnel
   répondait encore.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { request } from '../services/api-client';
import { useT } from '../i18n';

/** Mêmes seuils que les pages Comptes et Deals · un compte ne peut pas être
 *  « au point mort » à deux dates différentes selon l'écran. */
const DORMANT_DAYS = 30;
const STALLED_DAYS = 60;

/** Seuil « client à risque », identique à AT_RISK_THRESHOLD du backend
 *  (lib/churn-scoring.js). Une règle ne doit pas parler d'« à risque »
 *  autrement que le reste du produit. */
const AT_RISK = 60;

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// Sans activité connue, gris et jamais rouge : une donnée manquante n'est pas
// une alerte. Même règle que silenceColor sur la page Comptes.
function silenceColor(days) {
  if (days == null) return 'var(--text-muted)';
  if (days > STALLED_DAYS) return 'var(--danger)';
  if (days > DORMANT_DAYS) return 'var(--warning)';
  return 'var(--success)';
}

function churnColor(score) {
  if (score == null) return 'var(--text-muted)';
  if (score >= 76) return 'var(--danger)';
  if (score >= AT_RISK) return 'var(--warning)';
  if (score >= 26) return 'var(--warning)';
  return 'var(--success)';
}

/** Fond neutre et couleur portée par le texte. La forme `${couleur}15`
 *  employée ailleurs concatène une opacité à une variable CSS et ne produit
 *  aucune couleur valide : ne pas la propager. */
function Pastille({ color, children, title }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11, padding: '3px 9px', borderRadius: 6,
        background: 'var(--bg-elevated)', color: color || 'var(--text-secondary)',
        fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function Bloc({ titre, indice, children }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8,
      background: 'var(--bg-card)', padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.02em' }}>{titre}</div>
        {indice ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{indice}</div> : null}
      </div>
      {children}
    </div>
  );
}

export default function AccountSheetPage() {
  const t = useT();
  const { id } = useParams();
  const [fiche, setFiche] = useState(null);
  const [etat, setEtat] = useState('chargement');

  // L'état n'est posé que dans les retours de la promesse, jamais de façon
  // synchrone dans l'effet : c'est le patron de la page Comptes, et le seul que
  // `react-hooks/set-state-in-effect` accepte. `etat` démarre déjà à
  // « chargement », donc il n'y a rien à réinitialiser ici. On n'arrive jamais
  // d'une fiche vers une autre fiche sans démontage, donc aucun risque
  // d'afficher brièvement la société précédente.
  useEffect(() => {
    let vivant = true;
    request(`/crm/accounts/${id}`)
      .then(data => { if (vivant) { setFiche(data); setEtat('ok'); } })
      // Un compte inexistant et un compte d'un autre utilisateur rendent le
      // même 404, et l'écran dit la même chose dans les deux cas.
      .catch(() => { if (vivant) setEtat('introuvable'); });
    return () => { vivant = false; };
  }, [id]);

  const money = (n, devise) => {
    const v = Math.round(Number(n) || 0).toLocaleString('fr-FR');
    return devise && devise !== 'EUR' ? `${v} ${devise}` : `${v} €`;
  };

  if (etat === 'chargement') return null;

  if (etat === 'introuvable') {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('accountSheet.notFoundTitle')}</h1>
          <div className="page-subtitle">{t('accountSheet.notFoundBody')}</div>
        </div>
        <Link to="/clients" style={{ fontSize: 13 }}>{t('accountSheet.backToClients')}</Link>
      </div>
    );
  }

  const { compte, affaires, contacts, resume } = fiche;
  const silence = daysSince(compte.lastActivityAt);
  const ouvertes = affaires.filter(d => d.status !== 'won' && d.status !== 'lost');
  const closes = affaires.filter(d => d.status === 'won' || d.status === 'lost');

  return (
    <div className="page">
      {/* Fil d'Ariane vers la page d'où l'on vient. Il n'existe pas d'entrée
          « Comptes » dans le menu (arbitrage du 29/09) : Deals et Clients SONT
          les listes de sociétés, et c'est vers elles qu'on remonte. */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        <Link to="/clients" style={{ color: 'inherit' }}>{t('nav.sectionClients')}</Link>
        {' / '}{compte.name}
      </div>

      <div className="page-header">
        <h1 className="page-title">{compte.name}</h1>
        <div className="page-subtitle">
          {[
            compte.industry,
            compte.crmProvider,
            compte.ownerEmail ? compte.ownerEmail.split('@')[0] : null,
            compte.source === 'derived' ? t('accounts.derived') : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {/* NULL n'est pas zéro : un compte jamais scoré le DIT, au lieu de
            passer pour sain. C'est la règle de toute la base. */}
        {compte.churnScore == null ? (
          <Pastille title={t('accountSheet.notScoredWhy')}>{t('accountSheet.notScored')}</Pastille>
        ) : (
          <Pastille color={churnColor(compte.churnScore)}>
            {t('accountSheet.riskScore', { score: compte.churnScore })}
          </Pastille>
        )}
        {resume.upsell && (
          <Pastille color="var(--primary)">{t('accountSheet.upsellPossible')}</Pastille>
        )}
        <Pastille color={silenceColor(silence)}>
          {silence == null ? t('accounts.noActivity') : t('accounts.days', { days: silence })}
        </Pastille>
        {resume.injoignable === true && (
          <Pastille color="var(--warning)" title={t('accountSheet.unreachableWhy')}>
            {t('accountSheet.unreachable')}
          </Pastille>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          <Bloc titre={t('accountSheet.deals')} indice={t('accountSheet.dealsSource')}>
            {affaires.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('accountSheet.noDeals')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {[...ouvertes, ...closes].map(d => {
                  const immobile = daysSince(d.crm_updated_at || d.last_activity_at || d.updated_at);
                  const gagne = d.status === 'won';
                  const perdu = d.status === 'lost';
                  return (
                    <div key={d.id} style={{
                      display: 'flex', alignItems: 'baseline', gap: 11, padding: '9px 0',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {d.name || t('accountSheet.unnamedDeal')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {[
                            gagne ? t('accountSheet.won') : perdu ? t('accountSheet.lost') : t('accountSheet.open'),
                            d.crm_stage,
                            d.crm_pipeline_name,
                            !gagne && !perdu && immobile != null
                              ? t('accountSheet.stalled', { days: immobile })
                              : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div style={{
                        marginLeft: 'auto', fontWeight: 600, whiteSpace: 'nowrap',
                        color: gagne ? 'var(--success)' : perdu ? 'var(--text-muted)' : 'inherit',
                      }}>
                        {d.deal_value == null ? t('accountSheet.noAmount') : money(d.deal_value, d.currency)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {resume.upsell && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                {t('accountSheet.upsellExplain')}
              </div>
            )}
            {/* Deux devises ne s'additionnent JAMAIS (arbitrage du 30/09) : on
                le dit au lieu de produire un total qui mente. */}
            {resume.devisesMelangees && (
              <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>
                {t('accountSheet.mixedCurrencies', { list: resume.devises.join(', ') })}
              </div>
            )}
          </Bloc>

          <Bloc titre={t('accountSheet.contacts')} indice={t('accountSheet.contactsSource')}>
            {contacts.length === 0 ? (
              /* Le vide est explicatif : « aucun contact rattaché » est un trou
                 de notre import, pas un fait commercial, et c'est lui qui rend
                 le compte non scorable. */
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {t('accountSheet.noContactsBody')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {contacts.map(c => {
                  const j = daysSince(c.last_activity_at);
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {c.name || c.email || t('accountSheet.unnamedContact')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {[
                            c.title,
                            c.account_role ? t(`accountSheet.role.${c.account_role}`) : null,
                            c.is_primary_contact ? t('accountSheet.primary') : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
                        {c.email_bounced_at && (
                          <Pastille color="var(--danger)">{t('accountSheet.bounced')}</Pastille>
                        )}
                        <Pastille color={silenceColor(j)}>
                          {j == null ? t('accounts.noActivity') : t('accounts.days', { days: j })}
                        </Pastille>
                      </div>
                    </div>
                  );
                })}
                {contacts.length > 1 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                    {t('accountSheet.oneSendExplain')}
                  </div>
                )}
              </div>
            )}
          </Bloc>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          <Bloc titre={t('accountSheet.summary')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('accountSheet.openValue')}</span>
                <b>{money(resume.ouvert)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('accountSheet.wonValue')}</span>
                <b style={{ color: resume.gagne > 0 ? 'var(--success)' : 'inherit' }}>{money(resume.gagne)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('accountSheet.contactCount')}</span>
                <b>{t('accountSheet.reachableOf', { reachable: resume.joignables, total: resume.contacts })}</b>
              </div>
            </div>
          </Bloc>

          <Bloc
            titre={t('accountSheet.churn')}
            indice={compte.churnScore == null ? null : t('accountSheet.threshold', { threshold: AT_RISK })}
          >
            {compte.churnScore == null ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {resume.sansInterlocuteur
                  ? t('accountSheet.notScoredNoContact')
                  : t('accountSheet.notScoredYet')}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: churnColor(compte.churnScore) }}>
                    {compte.churnScore}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('accountSheet.churnBasis')}
                  </div>
                </div>

                {compte.churnFactors.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('accountSheet.noFactors')}</div>
                ) : (
                  /* `f.detail` fait le libellé, comme sur la page À risque.
                     Pas de clé i18n par signal : `t()` ne prend pas de valeur de
                     repli et rendrait la clé brute à l'écran pour un signal
                     inconnu, ce qui est précisément le défaut que le module
                     i18n met en garde dans son en-tête. Les détails sont
                     générés en français par le backend · c'est une dette
                     partagée avec À risque, pas une que j'introduis ici. */
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {compte.churnFactors.map((f, i) => (
                      <div
                        key={`${f.signal}-${i}`}
                        style={{
                          display: 'flex', justifyContent: 'space-between', gap: 10,
                          fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>{f.detail || f.signal}</span>
                        <b style={{
                          color: f.weight > 0 ? 'var(--danger)' : f.weight < 0 ? 'var(--success)' : 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                        }}>
                          {f.weight > 0 ? `+${f.weight}` : String(f.weight)}
                        </b>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Bloc>

          {resume.champsManquants.length > 0 && (
            <Bloc titre={t('accountSheet.dataQuality')}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {t('accountSheet.missingFields', {
                  fields: resume.champsManquants.map(f => t(`accountSheet.field.${f}`)).join(', '),
                })}
              </div>
              {/* Ce qui manque est corrigé UNE fois pour tous les
                  interlocuteurs, au lieu d'une fois par contact. C'est tout
                  l'intérêt du niveau société. */}
              {resume.contacts > 1 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 7 }}>
                  {t('accountSheet.missingFieldsOnce', { count: resume.contacts })}
                </div>
              )}
            </Bloc>
          )}
        </div>
      </div>
    </div>
  );
}
