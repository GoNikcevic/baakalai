/* ═══════════════════════════════════════════════════
   Dashboard · Hidden Revenue Score

   Le chiffre d'ouverture du produit : combien de chiffre d'affaires le CRM
   contient déjà, que personne ne va chercher.

   Trois partis pris qui ne sont pas cosmétiques :

   · un score qui BAISSE est une bonne nouvelle. La réserve se vide parce qu'on
     l'a travaillée. Le sens de lecture est donc inversé par rapport à un
     tableau de bord habituel, et la légende le dit explicitement plutôt que de
     laisser une flèche rouge suggérer le contraire ;
   · chaque sous-score mène à l'écran qui agit dessus. Un chiffre qu'on ne peut
     pas ouvrir ne se fait croire qu'une fois ;
   · quand la base est trop trouée pour être chiffrée, le bloc ne dit pas « peu
     de revenu dormant », il dit que le CRM ne permet pas encore de chiffrer.
     C'est le cas type de notre cible, et c'est le vrai diagnostic.

   Se masque tout seul tant qu'aucun snapshot n'existe.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useI18n } from '../i18n';
import { request } from '../services/api-client';
import Icon from './Icon';

/* Même table que la modale de diagnostic : le score est le sommaire du produit,
   chaque ligne mène là où on traite la dimension. */
const DIMENSIONS = [
  { key: 'dormant_pipeline', path: '/deals-to-reactivate' },
  { key: 'customer_reactivation', path: '/clients' },
  { key: 'customer_expansion', path: '/clients-to-upsell' },
  { key: 'lead_reactivation', path: null },
];

/** Courbe du score. Pas d'axes ni de grille : à cette taille ils masqueraient
 *  la seule information utile, la pente. */
function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const w = 240;
  const h = 34;
  const values = points.map(p => p.hrs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - 3 - ((p.hrs - min) / span) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = coords[coords.length - 1].split(',');
  return (
    <svg
      width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }} aria-hidden="true"
    >
      <polyline
        points={coords.join(' ')} fill="none" stroke="var(--primary)"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="var(--primary)" />
    </svg>
  );
}

export default function HiddenRevenueCard({ onOpenDetail }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    request('/hidden-revenue')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* Arrondi au millier : « 400 566 € » sur une estimation encadrée par une
     fourchette donnerait une fausse impression de précision. */
  const money = useMemo(() => (value) => {
    const n = Math.round(Number(value) || 0);
    const rounded = n >= 10000 ? Math.round(n / 1000) * 1000 : n;
    const formatted = rounded.toLocaleString(en ? 'en-US' : 'fr-FR');
    return en ? `€${formatted}` : `${formatted} €`;
  }, [en]);

  const go = useCallback((path) => { if (path) navigate(path); }, [navigate]);

  const latest = data?.latest;
  if (!latest) return null;

  const delta = data.delta;
  const recovered = data.recovered || { deals: 0, value: 0 };

  /* Un score qui baisse est une bonne nouvelle : la réserve se vide. La couleur
     et le libellé suivent ce sens, pas celui d'une métrique de croissance. */
  const scoreTrend = delta && delta.hrs !== 0
    ? {
        down: delta.hrs < 0,
        label: delta.hrs < 0 ? t('hrs.trendDown') : t('hrs.trendUp'),
        text: `${delta.hrs > 0 ? '+' : ''}${delta.hrs}`,
      }
    : null;

  const tiles = [
    {
      key: 'range',
      label: t('hrs.label'),
      value: latest.quantifiable
        ? `${money(latest.expectedLow)} ${t('hrs.to')} ${money(latest.expectedHigh)}`
        : t('hrs.notQuantShort'),
      sub: latest.quantifiable
        ? t('hrs.rangeCap', { qualified: money(latest.qualifiedValue), count: latest.opportunityCount })
        : t('hrs.notQuantBody', {
            count: latest.opportunityCount,
            missing: latest.context?.countWithoutValue ?? 0,
          }),
      strong: true,
    },
    {
      key: 'score',
      label: t('hrs.score'),
      value: `${latest.hrs}/100`,
      sub: scoreTrend
        ? `${scoreTrend.text} · ${scoreTrend.label}`
        : t(`hrs.band.${latest.hrs <= 20 ? 'low' : latest.hrs <= 40 ? 'moderate' : latest.hrs <= 60 ? 'significant' : latest.hrs <= 80 ? 'high' : 'very_high'}`),
      trend: scoreTrend,
    },
    {
      key: 'recovered',
      label: t('hrs.recovered'),
      value: money(recovered.value),
      sub: recovered.deals > 0
        ? t('hrs.recoveredSub', { count: recovered.deals })
        : t('hrs.recoveredNone'),
    },
    {
      key: 'confidence',
      label: t('hrs.confidence'),
      value: `${latest.confidence}%`,
      sub: (latest.context?.countWithoutValue ?? 0) > 0
        ? t('hrs.confidenceGap', { count: latest.context.countWithoutValue })
        : t(`hrs.conf.${latest.confidence < 50 ? 'low' : latest.confidence < 75 ? 'medium' : latest.confidence < 90 ? 'high' : 'very_high'}`),
    },
  ];

  return (
    <div style={styles.card}>
      <div style={styles.head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="activity" size={15} style={{ color: 'var(--primary)' }} />
          <span style={styles.title}>{t('hrs.cardTitle')}</span>
        </div>
        {onOpenDetail && (
          <button type="button" style={styles.detailBtn} onClick={onOpenDetail}>
            {t('hrs.openDetail')}
          </button>
        )}
      </div>

      <div style={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.key} style={styles.tile}>
            <div style={styles.tileLabel}>{tile.label}</div>
            <div style={{
              ...styles.tileValue,
              fontSize: tile.strong ? 21 : 19,
              color: tile.strong ? 'var(--primary)' : 'var(--text)',
            }}>
              {tile.value}
            </div>
            <div style={{
              ...styles.tileSub,
              color: tile.trend ? (tile.trend.down ? '#22c55e' : '#f59e0b') : 'var(--text-muted)',
            }}>
              {tile.sub}
            </div>
          </div>
        ))}
      </div>

      {data.history && data.history.length >= 2 && (
        <div style={{ margin: '14px 0 2px' }}>
          <Sparkline points={data.history} />
          <div style={styles.sparkCap}>{t('hrs.sparkCap', { count: data.history.length })}</div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {DIMENSIONS.map(({ key, path }) => {
          const d = latest.dimensions?.[key];
          const evaluated = d?.evaluated;
          const clickable = Boolean(evaluated && path);
          return (
            <div
              key={key}
              onClick={clickable ? () => go(path) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(path); }
              } : undefined}
              style={{ ...styles.barRow, cursor: clickable ? 'pointer' : 'default', opacity: evaluated ? 1 : 0.5 }}
            >
              <span style={styles.barLabel}>{t(`hrs.dim.${key}`)}</span>
              <span style={styles.barTrack}>
                {evaluated && (
                  <span style={{ ...styles.barFill, width: `${Math.min(d.subScore, 100)}%` }} />
                )}
              </span>
              <span style={styles.barVal}>{evaluated ? d.subScore : t('hrs.notEvaluated')}</span>
            </div>
          );
        })}
      </div>

      <div style={styles.note}>{t('hrs.note')}</div>
    </div>
  );
}

const styles = {
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '18px 20px',
  },
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, marginBottom: 14,
  },
  title: { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  detailBtn: {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 12, color: 'var(--primary)', fontWeight: 500,
  },
  tiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 14,
  },
  tile: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  tileLabel: {
    fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--text-muted)', fontWeight: 600,
  },
  tileValue: { fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em' },
  tileSub: { fontSize: 11.5, lineHeight: 1.45 },
  sparkCap: { fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 },
  barRow: {
    display: 'grid', gridTemplateColumns: '1fr 2fr 38px',
    alignItems: 'center', gap: 10, padding: '5px 0',
  },
  barLabel: { fontSize: 12.5, color: 'var(--text)' },
  barTrack: {
    height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden',
  },
  barFill: { display: 'block', height: 6, borderRadius: 3, background: 'var(--primary)' },
  barVal: { fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'right' },
  note: { fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 },
};
