/* ═══════════════════════════════════════════════════
   Dashboard · bloc « Cette semaine »

   Ce que baakalai a fait depuis lundi, dans cet ordre : le résultat, le volume
   de travail qui le rend crédible, puis ce qui attend l'utilisateur.

   Trois partis pris qui ne sont pas cosmétiques :
   · une semaine sans résultat bascule sur la veille (« X comptes relus, rien à
     signaler ») au lieu d'afficher des zéros, qui se lisent comme une panne ;
   · les compteurs sont cliquables, un chiffre qu'on ne peut pas ouvrir ne se
     fait croire qu'une fois ;
   · le barème du temps est consultable en un clic, et arrondi vers le bas.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useT, useI18n } from '../i18n';
import { request } from '../services/api-client';
import Icon from './Icon';

/** Clé singulier/pluriel · l'interpolation i18n ne gère pas les pluriels. */
const plural = (n, base) => `${base}${n > 1 ? 'Other' : 'One'}`;

export default function WeeklyWorkCard() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [data, setData] = useState(null);
  const [showRates, setShowRates] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request('/dashboard/weekly-activity')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const money = useMemo(() => (value) => {
    const n = Math.round(Number(value) || 0);
    const formatted = n.toLocaleString(en ? 'en-US' : 'fr-FR');
    return en ? `€${formatted}` : `${formatted} €`;
  }, [en]);

  /** Toujours arrondi vers le bas : 14 h 46 réelles s'affichent « 14 h ». */
  const duration = (minutes) => {
    const m = Math.max(0, Math.round(minutes || 0));
    return m < 60
      ? t('weeklyWork.duration.minutes', { count: m })
      : t('weeklyWork.duration.hours', { count: Math.floor(m / 60) });
  };

  // Rien tant que les agents n'ont rien fait : un bloc à zéro sur un compte
  // fraîchement créé dirait le contraire de ce qu'il est censé montrer.
  if (!data || !data.hasWork) return null;

  const { counters, results, pending, daily, minutes, delta } = data;

  /* ── Phrase d'ouverture ── */
  const clauses = [];
  if (results.reactivatedCount > 0) {
    let clause = t(`weeklyWork.clause.${plural(results.reactivatedCount, 'reactivated')}`, {
      count: results.reactivatedCount,
    });
    if (results.reactivatedValue > 0) {
      clause += t('weeklyWork.clause.pipeline', { value: money(results.reactivatedValue) });
    }
    clauses.push(clause);
  }
  if (results.replies > 0) {
    clauses.push(t(`weeklyWork.clause.${plural(results.replies, 'replies')}`, { count: results.replies }));
  }
  if (results.churnAlerts > 0) {
    clauses.push(t(`weeklyWork.clause.${plural(results.churnAlerts, 'churn')}`, { count: results.churnAlerts }));
  }

  const joined = clauses.length > 1
    ? `${clauses.slice(0, -1).join(', ')} ${t('weeklyWork.and')} ${clauses[clauses.length - 1]}`
    : clauses[0];

  const headline = clauses.length > 0
    ? t('weeklyWork.sentence', { clauses: joined })
    : t(`weeklyWork.${plural(counters.accountsReviewed, 'quiet')}`, { count: counters.accountsReviewed });

  /* ── Lignes nommées ── */
  const lines = results.items.map((item, i) => {
    if (item.kind === 'reactivated') {
      return {
        key: `r${i}`, to: '/deals-to-reactivate',
        main: t('weeklyWork.item.reactivated', { company: item.company || t('weeklyWork.item.unnamed') }),
        sub: item.value > 0 ? t('weeklyWork.item.reactivatedValue', { value: money(item.value) }) : null,
      };
    }
    if (item.kind === 'reply') {
      return {
        key: `p${i}`, to: '/activation',
        main: t('weeklyWork.item.reply', { company: item.company || t('weeklyWork.item.unnamed') }),
        sub: null,
      };
    }
    return {
      key: `c${i}`, to: '/churn-risk',
      main: t('weeklyWork.item.churn', { company: item.company || t('weeklyWork.item.unnamed') }),
      sub: t('weeklyWork.item.churnScore', { score: item.score }),
    };
  });

  /* ── Registre du travail ── */
  // Le temps par ligne rend le total vérifiable : sans lui, « 14 h » est à
  // prendre ou à laisser. Le barème vient du backend, source unique.
  const rates = data.rates || {};
  const ledger = [
    { key: 'accountsReviewed', to: '/clients' },
    { key: 'signals', to: '/activation?section=signals' },
    { key: 'followUps', to: '/activation' },
    { key: 'issuesFound', to: '/data-quality' },
    { key: 'analyses', to: '/recos' },
  ]
    .map((row) => ({ ...row, count: counters[row.key] || 0 }))
    .filter((row) => row.count > 0)
    .map((row) => ({ ...row, minutes: row.count * (rates[row.key] || 0) }));

  /* ── Barres des 7 jours ── */
  const maxDay = Math.max(...daily, 1);
  const dayLabels = t('weeklyWork.days.short');
  const showDays = daily.some((n) => n > 0);
  // « Aucun jour sans travail » ne se dit que si c'est vrai, et seulement sur
  // les jours déjà écoulés : samedi est à zéro un vendredi, forcément.
  const elapsedDays = Math.min(7, Math.max(1, Math.ceil(
    (new Date(data.range.end) - new Date(data.range.start)) / 86400000
  )));
  const everyDayActive = daily.slice(0, elapsedDays).every((n) => n > 0);
  const daysNote = t(everyDayActive ? 'weeklyWork.days.noteEveryDay' : 'weeklyWork.days.note');

  /* ── Ce qui attend l'utilisateur ── */
  const alerts = [];
  if (pending.approvals > 0) {
    alerts.push({
      key: 'approvals', to: '/activation', cta: t('weeklyWork.alert.approve'),
      text: t(`weeklyWork.alert.${plural(pending.approvals, 'approvals')}`, { count: pending.approvals })
        + (pending.approvalsOldestDays > 1
          ? ` ${t('weeklyWork.alert.since', { days: pending.approvalsOldestDays })}`
          : ''),
    });
  }
  if (pending.noEmail > 0) {
    alerts.push({
      key: 'noEmail', to: '/data-quality', cta: t('weeklyWork.alert.fix'),
      text: t(`weeklyWork.alert.${plural(pending.noEmail, 'noEmail')}`, { count: pending.noEmail }),
    });
  }

  return (
    <section className="wwc">
      <div className="wwc-top">
        <div className="wwc-top-left">
          <span className="wwc-kicker">{t('weeklyWork.kicker')}</span>
          <span className="wwc-range">{t('weeklyWork.rangeCurrent')}</span>
        </div>
        {/* Pas de variation sur une base minuscule : passer de 1 à 3 signaux
            affiche « +200 % », ce qui impressionne une fois et décrédibilise
            ensuite. Il faut au moins 3 signaux la semaine d'avant. */}
        {delta?.signals != null && Math.abs(delta.signals) >= 10
          && counters.signals > 0 && (data.previous?.counters?.signals || 0) >= 3 && (
          <span className="wwc-chip">
            <span style={{ color: delta.signals > 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
              {delta.signals > 0 ? '+' : ''}{delta.signals} %
            </span>
            &nbsp;{t('weeklyWork.deltaSignals')}
          </span>
        )}
      </div>

      <div className="wwc-main">
        <div className="wwc-left">
          <p className="wwc-headline">{headline}</p>

          {lines.length > 0 && (
            <ul className="wwc-results">
              {lines.map((line) => (
                <li key={line.key}>
                  <Icon name="checkCircle" size={15} style={{ color: 'var(--success)', flex: 'none', marginTop: 2 }} />
                  <Link to={line.to} className="wwc-result-link">
                    <span>{line.main}</span>
                    {line.sub && <span className="wwc-muted"> {line.sub}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="wwc-right">
          <div className="wwc-label">{t('weeklyWork.ledgerTitle')}</div>

          <table className="wwc-ledger">
            <tbody>
              {ledger.map((row) => (
                <tr key={row.key}>
                  <td>
                    <Link to={row.to} className="wwc-ledger-link">
                      {t(`weeklyWork.ledger.${plural(row.count, row.key)}`, { count: row.count })}
                    </Link>
                  </td>
                  <td>{row.minutes > 0 ? duration(row.minutes) : ''}</td>
                </tr>
              ))}
              <tr className="wwc-total">
                <td>{results.reactivatedCount || results.replies ? t('weeklyWork.ledger.total') : t('weeklyWork.ledger.watch')}</td>
                <td>{duration(minutes)}</td>
              </tr>
            </tbody>
          </table>

          {showDays && (
            <div className="wwc-days">
              <div className="wwc-bars" role="img" aria-label={daysNote}>
                {daily.map((n, i) => (
                  <div
                    key={i}
                    className={i >= 5 ? 'wwc-bar wwc-bar-weekend' : 'wwc-bar'}
                    style={{ height: `${Math.max(4, Math.round((n / maxDay) * 100))}%` }}
                  />
                ))}
              </div>
              <div className="wwc-day-labels">
                {(Array.isArray(dayLabels) ? dayLabels : []).map((d, i) => <span key={i}>{d}</span>)}
              </div>
              <p className="wwc-days-note">{daysNote}</p>
            </div>
          )}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="wwc-alerts">
          {alerts.map((a) => (
            <div className="wwc-alert" key={a.key}>
              <span className="wwc-alert-dot" />
              <span>{a.text}</span>
              <Link to={a.to} className="wwc-alert-cta">{a.cta}</Link>
            </div>
          ))}
        </div>
      )}

      <div className="wwc-foot">
        <button type="button" className="wwc-rates-toggle" onClick={() => setShowRates((v) => !v)}>
          {t('weeklyWork.rates.toggle')}
        </button>
      </div>

      {showRates && (
        <div className="wwc-rates">
          <table className="wwc-rates-table">
            <tbody>
              {Object.entries(data.rates || {}).map(([key, min]) => (
                <tr key={key}>
                  <td>{t(`weeklyWork.rates.${key}`)}</td>
                  <td>{t('weeklyWork.duration.minutes', { count: min })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="wwc-rates-note">{t('weeklyWork.rates.note')}</p>
        </div>
      )}
    </section>
  );
}
