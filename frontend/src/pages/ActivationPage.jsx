/* ===============================================================================
   BAKAL · Automatisation · Déclencheur -> Workflow

   La page est 100 % ÉVÉNEMENTIELLE : tout ce qui vit ici part tout seul, sur un
   événement. L'envoi manuel sur une sélection de contacts n'existe pas dans
   cette zone, il vit sur Clients et Deals. C'est ce qui la distingue des
   autres pages, et c'est la règle qui décide de ce qui a le droit d'y entrer.

   Quatre destinations :

     Signaux                   ce que baakalai a remarqué sans qu'on le demande
     Déclencheurs et workflows le couple « quand ceci, faire cela »
     En cours                  qui est actuellement engagé
     Historique                les sorties, avec leur motif

   « À valider » n'est pas un onglet : c'est une file transitoire, elle ne
   mérite pas une place permanente dans la barre. Elle vit en bannière avec son
   compteur, et n'apparaît que quand elle a quelque chose à dire.

   Les anciens liens (?section=nurture|signals|stats|queue|rules|results)
   continuent de tomber au bon endroit : ils sont posés dans la nav, le chat,
   les notifications et le bilan hebdo.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../i18n';
import { request } from '../services/api-client';
import MailboxBanner from '../components/MailboxBanner';
import QueueSection from '../components/automation/QueueSection';
import RulesSection from '../components/automation/RulesSection';
import SignalsZone from '../components/automation/SignalsZone';
import TriggersZone from '../components/automation/TriggersZone';
import RunsZone from '../components/automation/RunsZone';
import HistoryZone from '../components/automation/HistoryZone';

const TABS = [
  { key: 'signals', i18n: 'automation.tab.signals' },
  { key: 'triggers', i18n: 'automation.tab.triggers' },
  { key: 'runs', i18n: 'automation.tab.runs' },
  { key: 'history', i18n: 'automation.tab.history' },
];

// Anciennes valeurs de ?section=, toujours en circulation dans les liens.
const LEGACY_SECTIONS = {
  nurture: 'queue',
  signals: 'signals',
  stats: 'history',
  pending: 'queue',
  triggers: 'triggers',
  queue: 'queue',
  // Les anciennes règles de relance, le répondeur, la veille et les campagnes
  // équipe restent joignables. Elles ne sont pas fusionnées dans le nouveau
  // modèle : les fusionner est un chantier à part, et prétendre que c'est
  // fait en les cachant serait pire que de les laisser à leur place.
  rules: 'settings',
  results: 'history',
};

// Sections joignables mais absentes de la barre d'onglets : une file
// transitoire et un écran de réglages n'ont pas à occuper une place
// permanente dans la navigation.
const ASIDE_SECTIONS = ['queue', 'settings'];

export default function ActivationPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSection = searchParams.get('section');
  const section = (TABS.some(s => s.key === urlSection) || ASIDE_SECTIONS.includes(urlSection))
    ? urlSection
    : (LEGACY_SECTIONS[urlSection] || 'signals');
  const isAside = ASIDE_SECTIONS.includes(section);

  const go = useCallback((key) => setSearchParams({ section: key }, { replace: true }), [setSearchParams]);

  const [summary, setSummary] = useState(null);
  const [auto, setAuto] = useState(null);
  const [signalCount, setSignalCount] = useState(0);

  const loadSummary = useCallback(() => {
    request('/nurture/summary').then(setSummary).catch(() => setSummary(null));
  }, []);

  const loadAuto = useCallback(() => {
    request('/automations').then(setAuto).catch(() => setAuto({ triggers: [], workflows: [], hasMailbox: false }));
    request('/signals/types').then(d => setSignalCount(d.totalNew || 0)).catch(() => setSignalCount(0));
  }, []);

  useEffect(() => { loadSummary(); loadAuto(); }, [loadSummary, loadAuto]);

  const triggers = auto?.triggers || [];
  const activeTriggers = triggers.filter(x => x.status === 'active').length;
  const hasMailbox = auto ? auto.hasMailbox : true;
  const pending = summary ? summary.pending : 0;

  const counters = [
    { key: 'runs', label: t('automation.counter.running'), value: auto ? String(auto.runsCount ?? '') : '' },
    { key: 'triggers', label: t('automation.counter.armed'), value: `${activeTriggers} / ${triggers.length}` },
    { key: 'signals', label: t('automation.counter.signals'), value: String(signalCount) },
  ];

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('activation.title')}</h1>
          <div className="page-subtitle">{t('automation.subtitle')}</div>
        </div>
      </div>

      <MailboxBanner summary={summary} />

      {/* À valider · file transitoire, jamais un onglet permanent. */}
      {pending > 0 && !isAside && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '8px 14px', marginBottom: 12, borderRadius: 'var(--r-lg)',
          background: 'var(--warning-soft)', border: '1px solid var(--warning)',
          fontSize: 13,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 'var(--r-full)',
            background: 'var(--warning-soft)', color: 'var(--warning)',
            border: '1px solid var(--warning)',
          }}>{pending}</span>
          <span style={{ flex: 1, minWidth: 220 }}>{t('automation.toValidate', { count: pending })}</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 14px' }} onClick={() => go('queue')}>
            {t('automation.validate')}
          </button>
        </div>
      )}

      {!isAside && (
        <>
          <div style={{
            display: 'flex', gap: 1, background: 'var(--border)',
            borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            marginBottom: 16, flexWrap: 'wrap',
          }}>
            {counters.map(c => (
              <button
                key={c.key}
                onClick={() => go(c.key)}
                style={{
                  flex: 1, minWidth: 140, background: 'var(--bg-card)', border: 'none',
                  color: 'var(--text-primary)',
                  padding: '10px 16px', display: 'flex', flexDirection: 'column',
                  alignItems: 'flex-start', gap: 3, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--grey-500)',
                }}>{c.label}</span>
                <span style={{ fontSize: 20, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {c.value || '0'}
                </span>
              </button>
            ))}
          </div>

          <div role="tablist" style={{
            display: 'flex', gap: 24, borderBottom: '1px solid var(--border)',
            marginBottom: 20, overflowX: 'auto',
          }}>
            {TABS.map(s => (
              <button
                key={s.key}
                role="tab"
                aria-selected={section === s.key}
                onClick={() => go(s.key)}
                style={{
                  height: 40, padding: 0, background: 'none', border: 'none',
                  borderBottom: `2px solid ${section === s.key ? 'var(--text-primary)' : 'transparent'}`,
                  marginBottom: -1, display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap',
                  color: section === s.key ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: section === s.key ? 600 : 400,
                }}
              >
                {t(s.i18n)}
                {s.key === 'signals' && signalCount > 0 && (
                  <span style={{
                    fontSize: 10.5, padding: '2px 8px', borderRadius: 'var(--r-full)',
                    background: 'var(--primary-softer)', color: 'var(--primary)',
                  }}>{signalCount}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {section === 'signals' && <SignalsZone onAutomated={loadAuto} />}
      {section === 'triggers' && (
        <>
          <TriggersZone hasMailbox={hasMailbox} onChanged={loadAuto} />
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
            {t('automation.legacyRulesHint')}{' '}
            <button
              onClick={() => go('settings')}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary)', fontSize: 12 }}
            >
              {t('automation.legacyRulesLink')}
            </button>
          </div>
        </>
      )}
      {section === 'runs' && (
        <RunsZone
          activeTriggers={activeTriggers}
          onGoSignals={() => go('signals')}
          onGoTriggers={() => go('triggers')}
        />
      )}
      {section === 'history' && <HistoryZone hasRuns={activeTriggers > 0} />}

      {isAside && (
        <>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '5px 12px', marginBottom: 14 }}
            onClick={() => go('signals')}
          >
            {t('automation.backToAutomation')}
          </button>
          {section === 'queue' && <QueueSection summary={summary} onSummaryRefresh={loadSummary} />}
          {section === 'settings' && <RulesSection />}
        </>
      )}
    </div>
  );
}
