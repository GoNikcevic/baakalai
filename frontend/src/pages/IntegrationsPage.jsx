/* ===============================================================================
   BAKAL — Integrations Documentation Page
   Shows all integrations with details about what Baakal does with each one.
   Accessible via the platform (requires login).
   =============================================================================== */

import { Link } from 'react-router-dom';

/* ─── Integration data by category ─── */

const CATEGORIES = [
  {
    title: 'Outreach',
    tools: [
      {
        icon: 'L', color: '#6C5CE7', name: 'Lemlist',
        desc: 'Campagnes email et LinkedIn, séquences multi-canal',
        status: 'natif',
        features: [
          'Analyse vos stats de campagne en temps réel',
          'Génère et optimise vos séquences avec Claude',
          'Déploie les variantes A/B directement dans Lemlist',
          'Collecte quotidienne des taux d\'ouverture, réponse et conversion',
        ],
      },
      {
        icon: 'A', color: '#6C5CE7', name: 'Apollo',
        desc: 'Base B2B + séquences email automatisées',
        status: 'bientot',
        features: [
          'Import de vos campagnes et statistiques',
          'Enrichissement des données prospect',
          'Analyse de performance cross-campagne',
        ],
      },
      {
        icon: 'In', color: '#0984E3', name: 'Instantly',
        desc: 'Cold email à grande échelle',
        status: 'bientot',
        features: [
          'Sync des campagnes et métriques',
          'Optimisation des séquences via IA',
        ],
      },
      {
        icon: 'LG', color: '#6C5CE7', name: 'La Growth Machine',
        desc: 'Séquences multi-canal automatisées',
        status: 'bientot',
        features: [
          'Import des workflows multi-canal',
          'Analyse des performances par canal',
        ],
      },
      {
        icon: 'W', color: '#A29BFE', name: 'Waalaxy',
        desc: 'Automatisation LinkedIn + email',
        status: 'bientot',
        features: [
          'Sync des campagnes LinkedIn',
          'Analyse des taux d\'acceptation et réponse',
        ],
      },
    ],
  },
  {
    title: 'CRM',
    tools: [
      {
        icon: 'H', color: '#FF6B35', name: 'HubSpot',
        desc: 'CRM complet + marketing automation',
        status: 'natif',
        features: [
          'Pull des deals et contacts pour enrichir l\'ICP',
          'Push des scores de leads (/100) vers les contacts HubSpot',
          'Analyse des patterns de conversion par Claude',
          'Synchronisation bidirectionnelle des opportunités',
        ],
      },
      {
        icon: 'S', color: '#00A1E0', name: 'Salesforce',
        desc: 'CRM enterprise + reporting avancé',
        status: 'beta',
        features: [
          'Import des deals et pipeline',
          'Analyse des cycles de vente',
          'Export des scores leads',
        ],
      },
      {
        icon: 'P', color: '#017737', name: 'Pipedrive',
        desc: 'CRM visuel orienté vente',
        status: 'beta',
        features: [
          'Import des deals et activités',
          'Analyse des taux de conversion par étape',
          'Export des scores leads',
        ],
      },
    ],
  },
  {
    title: 'Enrichissement',
    tools: [
      {
        icon: 'D', color: '#00B894', name: 'DropContact',
        desc: 'Enrichissement email et téléphone',
        status: 'prevu',
        features: [
          'Enrichissement automatique des prospects importés',
          'Vérification des emails avant envoi',
        ],
      },
      {
        icon: 'H', color: '#FF7675', name: 'Hunter',
        desc: 'Recherche et vérification d\'emails',
        status: 'prevu',
        features: [
          'Recherche d\'emails par domaine',
          'Vérification de la délivrabilité',
        ],
      },
      {
        icon: 'K', color: '#0984E3', name: 'Kaspr',
        desc: 'Données LinkedIn en temps réel',
        status: 'prevu',
        features: [
          'Extraction de coordonnées depuis LinkedIn',
          'Enrichissement des profils prospect',
        ],
      },
      {
        icon: 'Lu', color: '#00CEC9', name: 'Lusha',
        desc: 'Coordonnées professionnelles',
        status: 'prevu',
        features: [
          'Enrichissement téléphone et email',
          'Données entreprise et contact',
        ],
      },
      {
        icon: 'S', color: '#E17055', name: 'Snov.io',
        desc: 'Email finder et drip campaigns',
        status: 'prevu',
        features: [
          'Recherche d\'emails',
          'Import de séquences',
        ],
      },
    ],
  },
  {
    title: 'LinkedIn / Scraping',
    tools: [
      {
        icon: 'PB', color: '#636E72', name: 'PhantomBuster',
        desc: 'Scraping et automatisation web',
        status: 'prevu',
        features: [
          'Extraction de listes LinkedIn',
          'Automatisation de tâches de prospection',
        ],
      },
      {
        icon: 'CD', color: '#0984E3', name: 'Captain Data',
        desc: 'Extraction de données multi-sources',
        status: 'prevu',
        features: [
          'Extraction de données depuis plusieurs plateformes',
          'Enrichissement de listes prospect',
        ],
      },
    ],
  },
  {
    title: 'Calendrier',
    tools: [
      {
        icon: 'Ca', color: '#0069FF', name: 'Calendly',
        desc: 'Planification de RDV automatisée',
        status: 'prevu',
        features: [
          'Tracking des RDV pris via les campagnes',
          'Attribution des conversions par campagne',
        ],
      },
      {
        icon: 'Cl', color: '#292929', name: 'Cal.com',
        desc: 'Alternative open-source à Calendly',
        status: 'prevu',
        features: [
          'Même fonctionnalités que Calendly',
        ],
      },
    ],
  },
  {
    title: 'Délivrabilité',
    tools: [
      {
        icon: 'MR', color: '#E17055', name: 'MailReach',
        desc: 'Warm-up et monitoring inbox',
        status: 'prevu',
        features: [
          'Monitoring du score de délivrabilité',
          'Alertes si la réputation baisse',
        ],
      },
      {
        icon: 'Wb', color: '#FDCB6E', name: 'Warmbox',
        desc: 'Préchauffage email automatisé',
        status: 'prevu',
        features: [
          'Suivi du warm-up des boîtes email',
          'Recommandations avant lancement de campagne',
        ],
      },
    ],
  },
];

/* ─── Status badge config ─── */

const STATUS_MAP = {
  natif:    { label: 'Natif',               bg: '#00b89418', color: '#00b894', border: '#00b89440' },
  beta:     { label: 'Beta',                bg: '#0984e318', color: '#0984e3', border: '#0984e340' },
  bientot:  { label: 'Bientôt disponible',  bg: '#e1705518', color: '#e17055', border: '#e1705540' },
  prevu:    { label: 'Prévu',               bg: '#636e7218', color: '#636e72', border: '#636e7240' },
};

function IntegrationStatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.prevu;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.2px',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

/* ─── Main component ─── */

export default function IntegrationsPage() {
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Link to="/settings" style={{
            color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none',
          }}>
            Paramètres
          </Link>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>/</span>
          <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>Intégrations</span>
        </div>
        <h1 style={{
          fontSize: 26, fontWeight: 700, color: 'var(--text-primary)',
          margin: '0 0 6px 0', letterSpacing: '-0.5px',
        }}>
          Intégrations
        </h1>
        <p style={{
          fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5,
        }}>
          Découvrez comment Baakal se connecte à vos outils
        </p>
      </div>

      {/* Categories */}
      {CATEGORIES.map(cat => (
        <div key={cat.title} style={{ marginBottom: 32 }}>
          <h2 style={{
            fontSize: 16, fontWeight: 600, color: 'var(--text-primary)',
            margin: '0 0 14px 0', letterSpacing: '-0.3px',
            paddingBottom: 8, borderBottom: '1px solid var(--border)',
          }}>
            {cat.title}
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}>
            {cat.tools.map(tool => (
              <div key={tool.name} className="card" style={{
                padding: 20, borderRadius: 12, margin: 0,
                border: tool.status === 'natif'
                  ? '1.5px solid var(--success)'
                  : '1.5px solid var(--border)',
              }}>
                {/* Card header: icon + name + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: tool.color + '18',
                    border: `1px solid ${tool.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: tool.color,
                    letterSpacing: '-0.5px',
                  }}>
                    {tool.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    }}>
                      <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                        {tool.name}
                      </span>
                      <IntegrationStatusBadge status={tool.status} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {tool.desc}
                    </div>
                  </div>
                </div>

                {/* Feature list */}
                <ul style={{
                  margin: '8px 0 0 0', padding: '0 0 0 18px',
                  fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7,
                }}>
                  {tool.features.map((feat, i) => (
                    <li key={i}>{feat}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Back link */}
      <div style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 32 }}>
        <Link to="/settings" style={{
          fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none',
        }}>
          ← Retour aux paramètres
        </Link>
      </div>
    </div>
  );
}
