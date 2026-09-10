/* ===============================================================================
   BAKAL — Variable Generator (React)
   AI-driven variable suggestions: base -> derived chains with scenario switching.
   Ported from /app/vargen.js — full React hooks implementation.
   =============================================================================== */

import { useState, useCallback, useMemo } from 'react';
import { sanitizeHtml } from '../services/sanitize';
import { useI18n } from '../i18n';
import Icon from './Icon';

/* ─── Scenario data ─── */

const VARGEN_SCENARIOS = {

  /* -- Scenario 1: Beer / Brewery industry -- */
  'brasserie': {
    context: {
      campaign: 'Brasseries artisanales France',
      industry: 'Brasserie / Microbrasserie',
      target: 'Brasseurs, Directeurs qualite',
      angle: 'Expertise microbiologique',
    },
    explanation: {
      title: 'Pourquoi ces variables pour les brasseries ?',
      text: "Dans l'industrie brassicole, <strong>le produit est le point d'entree emotionnel</strong> \u2014 chaque brasseur est passionne par sa biere phare. En identifiant le nom de leur biere et le type de fermentation, on peut predire les problemes microbiologiques probables (contamination Brettanomyces pour les IPA, Lactobacillus pour les sours\u2026). <strong>Cette intelligence cree un icebreaker ultra-cible</strong> qui prouve qu'on connait leur metier, pas juste leur entreprise.",
    },
    chain: [
      {
        key: 'beerName',
        label: 'Nom de la bière phare',
        type: 'base',
        desc: 'Le produit signature ou best-seller de la brasserie. Trouvable sur leur site, Untappd, ou réseaux sociaux.',
        source: { icon: 'search', label: 'Scraping site web / Untappd' },
        examples: [
          { prospect: "Brasserie de la Goutte d'Or", value: 'Chateau Rouge (Amber Ale)' },
          { prospect: 'Brasserie du Mont Blanc', value: 'La Blanche (Witbier)' },
          { prospect: 'Deck & Donohue', value: 'Saison Station (Saison)' },
        ],
      },
      {
        key: 'microbioProblem',
        label: 'Risque microbiologique probable',
        type: 'enrichment',
        desc: 'Problème microbiologique le plus courant selon le type de bière produite. Généré par IA à partir du style de bière.',
        source: { icon: 'bot', label: 'IA \u2014 base sur le type de fermentation' },
        dependsOn: ['beerName'],
        derivationHint: 'Le type de bière (IPA, Stout, Sour, Lager\u2026) détermine la levure et les risques de contamination.',
        formula: {
          inputs: ['beerName'],
          prompt: "À partir du style de bière, identifie le risque microbiologique le plus probable. Sois spécifique et technique mais compréhensible.",
        },
        examples: [
          { prospect: 'Chateau Rouge (Amber)', value: "Oxydation prématurée \u2014 les malts caramélisés sont plus sensibles aux réactions de Maillard post-embouteillage" },
          { prospect: 'La Blanche (Witbier)', value: "Contamination Lactobacillus \u2014 les bières de blé à pH élevé sont un terrain propice" },
          { prospect: 'Saison Station (Saison)', value: "Refermentation non contrôlée \u2014 les levures Saison sont notoirement imprévisibles en bouteille" },
        ],
      },
      {
        key: 'brewerIcebreaker',
        label: 'Icebreaker brasseur',
        type: 'derived',
        desc: "Accroche personnalisée qui combine la bière phare et le risque microbio pour montrer une expertise crédible du métier.",
        source: { icon: 'sparkles', label: 'IA \u2014 combinaison de beerName + microbioProblem' },
        dependsOn: ['beerName', 'microbioProblem'],
        formula: {
          inputs: ['beerName', 'microbioProblem'],
          prompt: "Combine le nom de la bière phare et le risque microbiologique en une phrase d'accroche qui montre une expertise du métier brassicole. Ton conversationnel, pas de jargon excessif. Max 2 phrases.",
        },
        examples: [
          { prospect: "Brasserie de la Goutte d'Or", value: "<em>Chateau Rouge</em> est une de mes ambers préférées \u2014 vous avez mis en place un protocole anti-oxydation spécifique pour protéger ces malts caramélisés post-embouteillage ?" },
          { prospect: 'Brasserie du Mont Blanc', value: "J'ai goûté <em>La Blanche</em> récemment, très réussie. Cela dit, les witbiers à pH élevé sont un vrai défi côté Lactobacillus \u2014 c'est un sujet que vous maîtrisez déjà ?" },
          { prospect: 'Deck & Donohue', value: "Les Saisons, c'est une de mes passions \u2014 mais je sais que <em>Saison Station</em> doit vous donner du fil à retordre en refermentation bouteille. Vous avez trouvé une parade ?" },
        ],
      },
    ],
  },

  /* -- Scenario 2: DAF / Finance -- */
  'daf-finance': {
    context: {
      campaign: 'DAF Ile-de-France',
      industry: 'Cabinets comptables / Finance',
      target: 'DAF, Directeurs financiers',
      angle: 'Douleur client \u2014 automatisation',
    },
    explanation: {
      title: 'Pourquoi ces variables pour les DAF ?',
      text: "Les DAF sont submerges de taches repetitives mais n'ont pas le temps de quantifier le cout reel. En identifiant <strong>l'outil comptable utilise</strong> (Sage, Cegid, QuickBooks\u2026) et en calculant le <strong>temps perdu estime</strong> sur des taches automatisables, on cree un icebreaker chiffre qui parle leur langage \u2014 les chiffres.",
    },
    chain: [
      {
        key: 'accountingSoftware',
        label: 'Logiciel comptable utilisé',
        type: 'base',
        desc: "L'outil principal de gestion comptable. Identifiable via les offres d'emploi, profils LinkedIn de l'equipe, ou le site web.",
        source: { icon: 'search', label: "Scraping offres d'emploi / LinkedIn" },
        examples: [
          { prospect: 'Cabinet Fidrec', value: 'Sage 100 Comptabilite' },
          { prospect: 'Nexia Conseil', value: 'Cegid Loop' },
          { prospect: 'BDO France', value: 'SAP Business One' },
        ],
      },
      {
        key: 'estimatedTimeLost',
        label: 'Heures perdues estimées / semaine',
        type: 'enrichment',
        desc: "Estimation du temps consacré aux tâches automatisables, calculé selon l'outil utilisé et la taille du cabinet.",
        source: { icon: 'bot', label: 'IA \u2014 base sur accountingSoftware + companySize' },
        dependsOn: ['accountingSoftware', 'companySize'],
        derivationHint: "Chaque logiciel a des fonctionnalités d'automatisation connues. On estime le gap entre usage courant et potentiel.",
        formula: {
          inputs: ['accountingSoftware', 'companySize'],
          prompt: "Estime le nombre d'heures par semaine perdues en tâches automatisables, selon le logiciel comptable et la taille de l'entreprise. Sois spécifique sur ce qui cause la perte de temps.",
        },
        examples: [
          { prospect: 'Cabinet Fidrec (Sage 100)', value: "~14h/semaine \u2014 Sage 100 n'a pas d'OCR natif, saisie manuelle des factures" },
          { prospect: 'Nexia Conseil (Cegid Loop)', value: "~8h/semaine \u2014 Loop a de l'automatisation partielle, gap principalement sur le rapprochement bancaire" },
          { prospect: 'BDO France (SAP B1)', value: "~6h/semaine \u2014 SAP bien automatise, mais les PME n'utilisent que 40% des fonctions" },
        ],
      },
      {
        key: 'dafIcebreaker',
        label: 'Icebreaker DAF chiffre',
        type: 'derived',
        desc: "Accroche qui combine l'outil comptable et les heures perdues en une question qui parle le langage du DAF.",
        source: { icon: 'sparkles', label: 'IA \u2014 combinaison accountingSoftware + estimatedTimeLost' },
        dependsOn: ['accountingSoftware', 'estimatedTimeLost'],
        formula: {
          inputs: ['accountingSoftware', 'estimatedTimeLost'],
          prompt: "Crée une accroche pour un DAF qui mentionne leur outil comptable et le temps perdu estimé. La question doit être chiffrée et provoquer une prise de conscience. Ton professionnel décontracté, 1-2 phrases max.",
        },
        examples: [
          { prospect: 'Cabinet Fidrec', value: "<em>14h par semaine</em> en saisie manuelle sur Sage 100 \u2014 c'est ce qu'on observe en moyenne chez les cabinets de votre taille. Si vous pouviez recuperer ne serait-ce que la moitie, qu'est-ce que ca changerait ?" },
          { prospect: 'Nexia Conseil', value: "Cegid Loop fait bien le job, mais on voit souvent <em>8h/semaine</em> perdues sur le rapprochement bancaire. C'est un sujet que vous avez déjà creusé chez Nexia ?" },
          { prospect: 'BDO France', value: "SAP B1 est puissant, mais la plupart des PME n'utilisent que 40% de ses capacités \u2014 ça représente environ <em>6h récupérables par semaine</em>. Ça vous parle ?" },
        ],
      },
    ],
  },

  /* -- Scenario 3: Formation / Training industry -- */
  'formation': {
    context: {
      campaign: 'Dirigeants Formation',
      industry: 'Organismes de formation',
      target: 'Dirigeants, Responsables developpement',
      angle: 'Preuve sociale \u2192 douleur acquisition',
    },
    explanation: {
      title: 'Pourquoi ces variables pour les organismes de formation ?',
      text: "Les organismes de formation vivent et meurent par leur <strong>taux de remplissage</strong>. En identifiant leur certification Qualiopi et leur catalogue de formations, on peut calculer le cout d'acquisition par stagiaire et creer un icebreaker qui touche directement le nerf de la rentabilite.",
    },
    chain: [
      {
        key: 'qualiopiStatus',
        label: 'Statut Qualiopi',
        type: 'base',
        desc: "Si l'organisme est certifie Qualiopi (obligatoire pour fonds publics). Verifiable sur la base publique DataDock / Qualiopi.",
        source: { icon: 'search', label: 'Base publique Qualiopi / site web' },
        examples: [
          { prospect: 'FormaPro Consulting', value: 'Certifie Qualiopi \u2014 Actions de formation' },
          { prospect: 'CreActifs', value: 'Certifie Qualiopi \u2014 Formation + VAE' },
          { prospect: 'OpenClassrooms B2B', value: 'Certifie Qualiopi \u2014 Actions de formation a distance' },
        ],
      },
      {
        key: 'catalogSize',
        label: 'Taille du catalogue',
        type: 'base',
        desc: "Nombre approximatif de formations proposées. Identifiable sur leur site ou les plateformes CPF.",
        source: { icon: 'search', label: 'Scraping site web / MonCompteFormation' },
        examples: [
          { prospect: 'FormaPro Consulting', value: '12 formations (management, RH)' },
          { prospect: 'CreActifs', value: '8 formations (entrepreneuriat)' },
          { prospect: 'OpenClassrooms B2B', value: '150+ parcours (tech, data, digital)' },
        ],
      },
      {
        key: 'formationIcebreaker',
        label: 'Icebreaker formation',
        type: 'derived',
        desc: "Accroche qui combine statut Qualiopi et taille catalogue pour parler de la problématique de remplissage.",
        source: { icon: 'sparkles', label: 'IA \u2014 combinaison qualiopiStatus + catalogSize' },
        dependsOn: ['qualiopiStatus', 'catalogSize'],
        formula: {
          inputs: ['qualiopiStatus', 'catalogSize'],
          prompt: "Crée une accroche pour un dirigeant d'organisme de formation en utilisant leur statut Qualiopi et la taille de leur catalogue. L'angle est la difficulté à remplir les sessions. Ton conversationnel, 1-2 phrases.",
        },
        examples: [
          { prospect: 'FormaPro Consulting', value: "Avec <em>12 formations</em> au catalogue et Qualiopi en poche, le plus dur c'est pas la qualité \u2014 c'est de remplir les sessions. Comment vous gérez votre acquisition de stagiaires aujourd'hui ?" },
          { prospect: 'CreActifs', value: "8 formations en entrepreneuriat, c'est un positionnement pointu. Mais les organismes spécialisés comme le vôtre ont souvent du mal à <em>toucher les bons candidats</em> au bon moment \u2014 c'est votre cas aussi ?" },
          { prospect: 'OpenClassrooms B2B', value: "Avec <em>150+ parcours</em>, vous avez le catalogue. Mais pour les entreprises B2B, le défi c'est souvent de convaincre les DRH de passer à la formation en ligne \u2014 comment vous approchez ce frein ?" },
        ],
      },
    ],
  },
};

/* ─── Variable Card sub-component ─── */

function VarCard({ variable, onAccept, onDismiss, onEdit, onRefreshPreview }) {
  const { lang } = useI18n(); const en = lang === 'en';
  const [status, setStatus] = useState('pending'); // pending | accepted | dismissed | editing
  const [refreshing, setRefreshing] = useState(false);

  const isDerived = variable.type === 'derived';
  const isEnrichment = variable.type === 'enrichment';

  const handleAccept = useCallback(() => {
    setStatus('accepted');
    onAccept(variable.key);
  }, [variable.key, onAccept]);

  const handleDismiss = useCallback(() => {
    setStatus('dismissed');
    onDismiss(variable.key);
  }, [variable.key, onDismiss]);

  const handleEdit = useCallback(() => {
    setStatus('editing');
    onEdit(variable.key);
  }, [variable.key, onEdit]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    onRefreshPreview(variable.key);
    setTimeout(() => setRefreshing(false), 1200);
  }, [variable.key, onRefreshPreview]);

  if (status === 'dismissed') return null;

  return (
    <div
      className={`vargen-var ${isDerived ? 'derived' : ''}`}
      data-vargen-key={variable.key}
      style={status === 'accepted' ? {
        borderColor: 'var(--success)',
        boxShadow: '0 0 20px rgba(0,214,143,0.1)',
        transition: 'border-color 0.3s, box-shadow 0.3s',
      } : undefined}
    >
      {/* Header */}
      <div className="vargen-var-header">
        <div className="vargen-var-name">
          <span className="vargen-var-tag">{`{{${variable.key}}}`}</span>
          <span className={`vargen-var-type ${variable.type}`}>
            <Icon name={isDerived ? 'zap' : isEnrichment ? 'sparkles' : 'download'} size={11} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }} />
            {isDerived ? 'Dérivée' : isEnrichment ? 'Enrichie' : 'Base'}
          </span>
        </div>
        <div className="vargen-var-actions">
          {status === 'accepted' ? (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Ajoutée à la bibliothèque
            </span>
          ) : (
            <>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }} onClick={handleAccept}>
                <Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Accepter
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }} onClick={handleEdit}>
                <Icon name="pen" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{en ? 'Edit' : 'Modifier'}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }} onClick={handleDismiss}>
                \u2715
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="vargen-var-desc">
        <strong>{variable.label}</strong> &mdash; {variable.desc}
      </div>

      {/* Source */}
      <div className="vargen-var-source">
        <span className="vargen-var-source-icon"><Icon name={variable.source.icon} size={13} /></span>
        <span>Source : {variable.source.label}</span>
        {variable.dependsOn && (
          <span style={{ marginLeft: 8, color: 'var(--accent-light)' }}>
            \u2190 depend de {variable.dependsOn.map(d => `{{${d}}}`).join(' + ')}
          </span>
        )}
      </div>

      {/* Formula for derived / enrichment variables */}
      {(isDerived || isEnrichment) && variable.formula && (
        <div className="vargen-formula">
          <div className="vargen-formula-label">
            <Icon name="settings" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Formule de derivation
          </div>
          <div className="vargen-formula-inputs">
            {variable.formula.inputs.map((inp, i) => (
              <span key={inp}>
                <span className="vargen-formula-input-tag">{`{{${inp}}}`}</span>
                {i < variable.formula.inputs.length - 1 && (
                  <span className="vargen-formula-operator">+</span>
                )}
              </span>
            ))}
            <span className="vargen-formula-operator">\u2192</span>
            <span className="vargen-var-tag">{`{{${variable.key}}}`}</span>
          </div>
          <textarea
            className="vargen-formula-prompt"
            defaultValue={variable.formula.prompt}
            readOnly={status !== 'editing'}
            style={status === 'editing' ? { borderColor: 'var(--text-muted)', boxShadow: '0 0 0 2px var(--accent-glow)' } : undefined}
          />
        </div>
      )}

      {/* Enrichment derivation hint (if no formula) */}
      {isEnrichment && !variable.formula && variable.derivationHint && (
        <div className="vargen-formula">
          <div className="vargen-formula-label">
            <Icon name="settings" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Logique d'enrichissement
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {variable.derivationHint}
          </div>
        </div>
      )}

      {/* AI Preview examples */}
      {variable.examples && variable.examples.length > 0 && (
        <div className="vargen-preview">
          <div className="vargen-preview-header">
            <span className="vargen-preview-title">
              <Icon name="eye" size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
              Prévisualisation IA &mdash; {variable.examples.length} exemples
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 10, padding: '4px 8px' }}
              onClick={handleRefresh}
            >
              <Icon name="refresh" size={11} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
              Rafraîchir
            </button>
          </div>
          <div className="vargen-preview-body">
            {refreshing ? (
              <div style={{ textAlign: 'center', padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>
                <Icon name="refresh" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                {en ? 'Regenerating examples...' : 'Régénération des exemples...'}
              </div>
            ) : (
              variable.examples.map((ex, i) => (
                <div key={i} className="vargen-preview-example">
                  <span className="vargen-preview-prospect">{ex.prospect}</span>
                  <span className="vargen-preview-value" dangerouslySetInnerHTML={{ __html: sanitizeHtml(ex.value) }} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Connector between chain variables ─── */

function ChainConnector() {
  return (
    <div className="vargen-connector">
      <div className="vargen-connector-arrow"></div>
    </div>
  );
}

/* ═══ Main Component ═══ */

/**
 * VarGenerator — AI-driven variable suggestion panel with scenario switching.
 *
 * Props:
 * - onAcceptVariable?(key, varData): called when user accepts a variable
 * - onAcceptAll?(scenarioKey, chain): called when user accepts all variables
 * - scenarios?: custom scenarios object (defaults to VARGEN_SCENARIOS)
 * - defaultScenario?: initial scenario key (defaults to 'brasserie')
 */
export default function VarGenerator({
  onAcceptVariable,
  onAcceptAll,
  scenarios,
  defaultScenario = 'brasserie',
}) {
  const { lang } = useI18n(); const en = lang === 'en';
  const scenarioData = scenarios || VARGEN_SCENARIOS;
  const [activeScenario, setActiveScenario] = useState(defaultScenario);
  const [regenerating, setRegenerating] = useState(false);
  const [allAccepted, setAllAccepted] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState(new Set());

  const scenario = scenarioData[activeScenario];
  const ctx = scenario?.context;

  const scenarioKeys = useMemo(() => Object.keys(scenarioData), [scenarioData]);

  /* ─── Handlers ─── */

  const switchScenario = useCallback((key) => {
    setActiveScenario(key);
    setAllAccepted(false);
    setDismissedKeys(new Set());
  }, []);

  const handleAccept = useCallback((key) => {
    if (onAcceptVariable) {
      const varData = scenario.chain.find(v => v.key === key);
      onAcceptVariable(key, varData);
    }
  }, [scenario, onAcceptVariable]);

  const handleDismiss = useCallback((key) => {
    setDismissedKeys(prev => new Set([...prev, key]));
  }, []);

  const handleEdit = useCallback(() => {
    // Edit is handled within VarCard (focus on formula textarea)
  }, []);

  const handleRefreshPreview = useCallback(() => {
    // Refresh is simulated within VarCard
  }, []);

  const handleAcceptAll = useCallback(() => {
    setAllAccepted(true);
    if (onAcceptAll) {
      onAcceptAll(activeScenario, scenario.chain);
    } else if (onAcceptVariable) {
      scenario.chain.forEach(v => onAcceptVariable(v.key, v));
    }
  }, [activeScenario, scenario, onAcceptAll, onAcceptVariable]);

  const suggestNewChain = useCallback(() => {
    const currentIdx = scenarioKeys.indexOf(activeScenario);
    const nextIdx = (currentIdx + 1) % scenarioKeys.length;
    switchScenario(scenarioKeys[nextIdx]);
  }, [scenarioKeys, activeScenario, switchScenario]);

  const regenerateSuggestions = useCallback(() => {
    setRegenerating(true);
    // Simulate AI regeneration
    setTimeout(() => {
      setRegenerating(false);
      setAllAccepted(false);
      setDismissedKeys(new Set());
    }, 2000);
  }, []);

  if (!scenario) return null;

  const visibleChain = scenario.chain.filter(v => !dismissedKeys.has(v.key));

  /* ─── Render ─── */

  return (
    <div className="vargen-card" id="vargen-card">
      {/* Header */}
      <div className="vargen-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
      }}>
        <div className="vargen-header-left">
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.3px' }}>
            <Icon name="variable" size={15} color="var(--accent)" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            Générateur de variables
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Suggestions IA basées sur l'industrie et la campagne
          </div>
        </div>
        {allAccepted ? (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="checkCircle" size={14} />
            {scenario.chain.length} variables ajoutées à votre bibliothèque
          </div>
        ) : (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '8px 14px' }}
            onClick={regenerateSuggestions}
            disabled={regenerating}
          >
            <Icon name={regenerating ? 'sparkles' : 'refresh'} size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            {regenerating ? (en ? 'Analyzing...' : 'Analyse en cours...') : (en ? 'Regenerate' : 'Régénérer')}
          </button>
        )}
      </div>

      {/* Context bar */}
      <div className="vargen-context" id="vargen-context" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px',
        borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
      }}>
        <span className="vargen-context-label" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Analyse basée sur :
        </span>
        <span className="vargen-context-tag highlight" style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 20,
          background: 'var(--accent-glow)', color: 'var(--accent-light)',
          fontWeight: 500,
        }}>
          {ctx.industry}
        </span>
        <span className="vargen-context-tag" style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 20,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}>
          {ctx.target}
        </span>
        <span className="vargen-context-tag" style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 20,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}>
          {ctx.campaign}
        </span>
        <span className="vargen-context-tag" style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 20,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}>
          {ctx.angle}
        </span>
        <select
          value={activeScenario}
          onChange={(e) => switchScenario(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '6px 12px', borderRadius: 6,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {Object.entries(scenarioData).map(([key, s]) => (
            <option key={key} value={key}>{s.context.industry}</option>
          ))}
        </select>
      </div>

      {/* Body */}
      <div className="vargen-body" id="vargen-body" style={{ padding: 20 }}>
        {regenerating ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center', color: 'var(--accent)' }}>
              <Icon name="sparkles" size={36} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Analyse en cours...</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto' }}>
              Baakalai analyse l'industrie, les données de campagne et la mémoire cross-campagne pour suggérer les meilleures variables.
            </div>
          </div>
        ) : (
          <>
            {/* Explanation block */}
            <div className="vargen-explanation" style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 16, marginBottom: 20,
            }}>
              <div className="vargen-explanation-title" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                <Icon name="bulb" size={13} color="var(--accent)" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                {scenario.explanation.title}
              </div>
              <div
                className="vargen-explanation-text"
                style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(scenario.explanation.text) }}
              />
            </div>

            {/* Variable chain */}
            <div className="vargen-chain">
              <div className="vargen-chain-label" style={{
                fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                Chaîne de variables suggérée
              </div>

              {visibleChain.map((v, idx) => (
                <div key={v.key}>
                  {idx > 0 && <ChainConnector />}
                  <VarCard
                    variable={v}
                    onAccept={handleAccept}
                    onDismiss={handleDismiss}
                    onEdit={handleEdit}
                    onRefreshPreview={handleRefreshPreview}
                  />
                </div>
              ))}
            </div>

            {/* Bottom actions */}
            <div className="vargen-actions" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: 20, padding: '16px 0', borderTop: '1px solid var(--border)',
            }}>
              <div className="vargen-actions-info" style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                <Icon name="bulb" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                Les variables acceptées seront ajoutées à votre bibliothèque et synchronisées avec Lemlist.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '8px 14px' }}
                  onClick={suggestNewChain}
                >
                  <Icon name="sparkles" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                  Suggérer une autre chaîne
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '8px 14px' }}
                  onClick={handleAcceptAll}
                  disabled={allAccepted}
                >
                  <Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Accepter {visibleChain.length} variables
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Export scenarios for external use ─── */
export { VARGEN_SCENARIOS };
