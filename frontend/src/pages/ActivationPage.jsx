/* ===============================================================================
   BAKAL · Automatisation

   Trois destinations, plus onze. L'écran empilait 3 sections et 9 sous-onglets
   sur deux niveaux, sans distinguer ce qu'on traite tous les jours (approuver)
   de ce qu'on règle une fois (règles, autopilot) et de ce qu'on regarde après
   coup (stats, A/B). Découpage retenu :

     À valider      · brouillons de relance + signaux détectés
     Automatisations· règles, workflows en cours, répondeur, surveillance, équipe
     Résultats      · chiffres d'envoi, envois par règle, tests A/B, Salesforce

   Les anciens liens (?section=nurture|signals|stats) continuent de tomber au
   bon endroit : ils sont posés dans la nav, le chat, les notifications et le
   bilan hebdo.
   =============================================================================== */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../i18n';
import { request } from '../services/api-client';
import MailboxBanner from '../components/MailboxBanner';
import QueueSection from '../components/automation/QueueSection';
import RulesSection from '../components/automation/RulesSection';
import ResultsSection from '../components/automation/ResultsSection';

const SECTIONS = [
  { key: 'queue', i18n: 'activation.sections.queue' },
  { key: 'rules', i18n: 'activation.sections.rules' },
  { key: 'results', i18n: 'activation.sections.results' },
];

// Anciennes valeurs de ?section=, toujours en circulation dans les liens.
const LEGACY_SECTIONS = {
  nurture: 'queue',
  signals: 'queue',
  stats: 'results',
  pending: 'queue',
  triggers: 'rules',
};

export default function ActivationPage() {
  const t = useT();
  // La section active vit dans l'URL (?section=) pour rester deep-linkable
  // depuis la TodayCard, le bilan hebdo et le chat.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSection = searchParams.get('section');
  const section = SECTIONS.some(s => s.key === urlSection)
    ? urlSection
    : (LEGACY_SECTIONS[urlSection] || 'queue');

  // Un lien « signaux » tombe dans la file, où les signaux sont plus bas que
  // les brouillons : on descend jusqu'au bloc plutôt que de laisser croire que
  // le lien n'a rien fait.
  const signalsRef = useRef(null);
  useEffect(() => {
    if (urlSection !== 'signals' || !signalsRef.current) return;
    const id = setTimeout(() => {
      signalsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    return () => clearTimeout(id);
  }, [urlSection]);

  // L'état de la file (compteurs exacts + boîte mail connectée) est chargé une
  // fois ici : le bandeau en a besoin sur les trois sections, et la file s'en
  // sert pour savoir si un envoi est seulement possible.
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(() => {
    request('/nurture/summary').then(setSummary).catch(() => setSummary(null));
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const counts = {
    queue: summary ? summary.pending : 0,
    rules: 0,
    results: 0,
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('activation.title')}</h1>
          <div className="page-subtitle">{t('activation.subtitle')}</div>
        </div>
      </div>

      <MailboxBanner summary={summary} />

      {/* Top-level section switcher */}
      <div style={{
        display: 'inline-flex', gap: 2, padding: 3,
        background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 10,
        marginBottom: 20,
      }}>
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSearchParams({ section: s.key }, { replace: true })}
            style={{
              padding: '7px 18px', border: 'none', borderRadius: 8,
              background: section === s.key ? 'var(--bg-card, white)' : 'transparent',
              color: section === s.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: section === s.key ? 600 : 400,
              fontSize: 13, cursor: 'pointer',
              boxShadow: section === s.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {t(s.i18n)}
            {counts[s.key] > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}> ({counts[s.key]})</span>}
          </button>
        ))}
      </div>

      {section === 'queue' && (
        <QueueSection summary={summary} onSummaryRefresh={loadSummary} signalsRef={signalsRef} />
      )}
      {section === 'rules' && <RulesSection />}
      {section === 'results' && <ResultsSection />}
    </div>
  );
}
