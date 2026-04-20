import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';

const TABS = [
  { key: 'terms', labelFr: 'Conditions Générales', labelEn: 'Terms of Service' },
  { key: 'privacy', labelFr: 'Politique de confidentialité', labelEn: 'Privacy Policy' },
];

export default function LegalPage() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const isEN = lang === 'en';

  // Detect initial tab from URL hash
  const [tab, setTab] = useState(() => {
    if (window.location.hash === '#privacy') return 'privacy';
    return 'terms';
  });

  return (
    <div style={{
      maxWidth: 800,
      margin: '0 auto',
      padding: '40px 24px',
      fontFamily: 'var(--font-sans)',
      color: 'var(--text-primary, #1a1a1a)',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span className="mark" style={{ width: 22, height: 22, borderRadius: 6 }}></span>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.025em' }}>baakalai</span>
        </div>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none', color: 'var(--blue, #2563eb)',
            cursor: 'pointer', fontSize: 13, padding: 0,
          }}
        >
          ← {isEN ? 'Back to app' : "Retour à l'application"}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border, #e5e7eb)', marginBottom: 32 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '12px 20px',
              fontSize: 14,
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? 'var(--text-primary, #1a1a1a)' : 'var(--text-muted, #9ca3af)',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--ink)' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
            }}
          >
            {isEN ? t.labelEn : t.labelFr}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-secondary, #4b5563)' }}>
        {tab === 'terms' ? (isEN ? <TermsEN /> : <TermsFR />) : (isEN ? <PrivacyEN /> : <PrivacyFR />)}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border, #e5e7eb)', fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>
        {isEN ? 'Last updated: April 2026' : 'Dernière mise à jour : avril 2026'} · contact@baakal.ai
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #1a1a1a)', margin: '32px 0 12px' }}>{children}</h2>;
}
function SubTitle({ children }) {
  return <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)', margin: '24px 0 8px' }}>{children}</h3>;
}

function TermsFR() {
  return (<>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Conditions Générales d'Utilisation</h1>
    <p style={{ color: 'var(--text-muted)' }}>En vigueur au 15 avril 2026</p>

    <SectionTitle>1. Objet</SectionTitle>
    <p>Les présentes CGU régissent l'utilisation de la plateforme Baakalai (baakal.ai), un service SaaS de prospection B2B assisté par intelligence artificielle.</p>

    <SectionTitle>2. Description du service</SectionTitle>
    <p>Baakalai permet aux utilisateurs de :</p>
    <ul>
      <li>Créer et gérer des campagnes de prospection multi-canal (email + LinkedIn)</li>
      <li>Générer du contenu de prospection personnalisé via l'IA</li>
      <li>Rechercher et enrichir des prospects via des bases de données tierces</li>
      <li>Analyser les performances et affiner les campagnes automatiquement</li>
      <li>Synchroniser les données avec des CRM (HubSpot, Salesforce, Pipedrive, Notion, Airtable)</li>
    </ul>

    <SectionTitle>3. Création de compte</SectionTitle>
    <p>L'accès au service nécessite la création d'un compte avec une adresse email valide. L'utilisateur est responsable de la confidentialité de ses identifiants et de toute activité sur son compte.</p>

    <SectionTitle>4. Usage acceptable</SectionTitle>
    <p>L'utilisateur s'engage à utiliser Baakalai exclusivement pour de la prospection B2B légitime. Il est interdit de :</p>
    <ul>
      <li>Envoyer du spam ou des communications non sollicitées en masse</li>
      <li>Utiliser le service pour du B2C, du phishing ou de la fraude</li>
      <li>Contourner les limites de taux des APIs tierces</li>
      <li>Stocker ou traiter des données sensibles (santé, orientation politique, etc.)</li>
    </ul>

    <SectionTitle>5. Propriété des données</SectionTitle>
    <p>L'utilisateur reste propriétaire de ses données (profil, campagnes, prospects, contenus générés). Baakalai n'utilise pas les données des utilisateurs pour entraîner ses modèles IA. Les données peuvent être exportées ou supprimées à tout moment.</p>

    <SectionTitle>6. Intégrations tierces</SectionTitle>
    <p>Baakalai s'intègre avec des services tiers (Lemlist, Apollo, Brave Search, Claude API). L'utilisateur est responsable de respecter les conditions d'utilisation de ces services. Baakalai n'est pas responsable des interruptions ou changements de ces services tiers.</p>

    <SectionTitle>7. Disponibilité</SectionTitle>
    <p>Le service est fourni "en l'état" pendant la phase beta. Aucun SLA n'est garanti. Baakalai s'efforce de maintenir une disponibilité maximale mais ne peut garantir une absence totale d'interruptions.</p>

    <SectionTitle>8. Résiliation</SectionTitle>
    <p>L'utilisateur peut résilier son compte à tout moment. La suppression du compte entraîne la suppression de toutes les données associées dans un délai de 30 jours.</p>

    <SectionTitle>9. Limitation de responsabilité</SectionTitle>
    <p>Baakalai ne peut être tenu responsable des résultats des campagnes de prospection, des décisions commerciales basées sur les recommandations de l'IA, ou des dommages indirects liés à l'utilisation du service.</p>

    <SectionTitle>10. Droit applicable</SectionTitle>
    <p>Les présentes CGU sont régies par le droit français. Tout litige sera soumis aux tribunaux compétents de Paris.</p>
  </>);
}

function TermsEN() {
  return (<>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Terms of Service</h1>
    <p style={{ color: 'var(--text-muted)' }}>Effective April 15, 2026</p>

    <SectionTitle>1. Purpose</SectionTitle>
    <p>These Terms of Service govern the use of the Baakalai platform (baakal.ai), a SaaS B2B prospecting service powered by artificial intelligence.</p>

    <SectionTitle>2. Service Description</SectionTitle>
    <p>Baakalai enables users to:</p>
    <ul>
      <li>Create and manage multi-channel prospecting campaigns (email + LinkedIn)</li>
      <li>Generate personalized prospecting content using AI</li>
      <li>Search and enrich prospects via third-party databases</li>
      <li>Analyze performance and automatically optimize campaigns</li>
      <li>Sync data with CRMs (HubSpot, Salesforce, Pipedrive, Notion, Airtable)</li>
    </ul>

    <SectionTitle>3. Account Creation</SectionTitle>
    <p>Access to the service requires creating an account with a valid email address. Users are responsible for the confidentiality of their credentials and all activity on their account.</p>

    <SectionTitle>4. Acceptable Use</SectionTitle>
    <p>Users agree to use Baakalai exclusively for legitimate B2B prospecting. The following are prohibited:</p>
    <ul>
      <li>Sending spam or unsolicited mass communications</li>
      <li>Using the service for B2C, phishing, or fraud</li>
      <li>Circumventing third-party API rate limits</li>
      <li>Storing or processing sensitive data (health, political orientation, etc.)</li>
    </ul>

    <SectionTitle>5. Data Ownership</SectionTitle>
    <p>Users retain ownership of their data (profile, campaigns, prospects, generated content). Baakalai does not use user data to train its AI models. Data can be exported or deleted at any time.</p>

    <SectionTitle>6. Third-Party Integrations</SectionTitle>
    <p>Baakalai integrates with third-party services (Lemlist, Apollo, Brave Search, Claude API). Users are responsible for complying with the terms of service of these services. Baakalai is not liable for interruptions or changes to third-party services.</p>

    <SectionTitle>7. Availability</SectionTitle>
    <p>The service is provided "as is" during the beta phase. No SLA is guaranteed. Baakalai strives to maintain maximum uptime but cannot guarantee zero interruptions.</p>

    <SectionTitle>8. Termination</SectionTitle>
    <p>Users may terminate their account at any time. Account deletion results in the removal of all associated data within 30 days.</p>

    <SectionTitle>9. Limitation of Liability</SectionTitle>
    <p>Baakalai cannot be held liable for campaign results, business decisions based on AI recommendations, or indirect damages related to the use of the service.</p>

    <SectionTitle>10. Governing Law</SectionTitle>
    <p>These Terms are governed by French law. Any disputes shall be submitted to the competent courts of Paris, France.</p>
  </>);
}

function PrivacyFR() {
  return (<>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Politique de Confidentialité</h1>
    <p style={{ color: 'var(--text-muted)' }}>En vigueur au 15 avril 2026</p>

    <SectionTitle>1. Données collectées</SectionTitle>
    <SubTitle>Données de compte</SubTitle>
    <p>Nom, email, entreprise, mot de passe (hashé bcrypt).</p>
    <SubTitle>Données de campagne</SubTitle>
    <p>Paramètres de campagne, séquences, prospects (nom, titre, entreprise, email, LinkedIn URL), performances.</p>
    <SubTitle>Données d'usage</SubTitle>
    <p>Actions dans la plateforme, messages du chat IA, documents uploadés.</p>

    <SectionTitle>2. Traitement des données</SectionTitle>
    <p>Les données sont traitées pour fournir le service :</p>
    <ul>
      <li><strong>Claude API (Anthropic)</strong> — Génération de contenu IA, analyse de performance</li>
      <li><strong>Lemlist</strong> — Exécution des campagnes email/LinkedIn</li>
      <li><strong>Brave Search</strong> — Recherche web de prospects</li>
      <li><strong>Resend</strong> — Emails transactionnels (vérification, reset password)</li>
    </ul>

    <SectionTitle>3. Hébergement</SectionTitle>
    <p>Les données sont stockées sur des serveurs européens :</p>
    <ul>
      <li><strong>Supabase</strong> — Base de données PostgreSQL (EU-West)</li>
      <li><strong>Railway</strong> — Hébergement backend (EU-West)</li>
    </ul>

    <SectionTitle>4. Sous-traitants</SectionTitle>
    <p>Anthropic (USA), Lemlist (France), Brave (USA), Resend (USA), Supabase (USA/EU), Railway (USA/EU).</p>

    <SectionTitle>5. Vos droits (RGPD)</SectionTitle>
    <p>Conformément au RGPD, vous disposez des droits suivants :</p>
    <ul>
      <li><strong>Accès</strong> — Obtenir une copie de vos données</li>
      <li><strong>Rectification</strong> — Corriger vos données</li>
      <li><strong>Suppression</strong> — Demander l'effacement de vos données</li>
      <li><strong>Portabilité</strong> — Exporter vos données</li>
      <li><strong>Opposition</strong> — Vous opposer au traitement</li>
    </ul>
    <p>Contact : contact@baakal.ai</p>

    <SectionTitle>6. Cookies</SectionTitle>
    <p>Baakalai n'utilise pas de cookies tiers. Seuls des tokens d'authentification sont stockés dans le localStorage du navigateur.</p>
  </>);
}

function PrivacyEN() {
  return (<>
    <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
    <p style={{ color: 'var(--text-muted)' }}>Effective April 15, 2026</p>

    <SectionTitle>1. Data Collected</SectionTitle>
    <SubTitle>Account data</SubTitle>
    <p>Name, email, company, password (bcrypt hashed).</p>
    <SubTitle>Campaign data</SubTitle>
    <p>Campaign parameters, sequences, prospects (name, title, company, email, LinkedIn URL), performance metrics.</p>
    <SubTitle>Usage data</SubTitle>
    <p>Platform actions, AI chat messages, uploaded documents.</p>

    <SectionTitle>2. Data Processing</SectionTitle>
    <p>Data is processed to provide the service:</p>
    <ul>
      <li><strong>Claude API (Anthropic)</strong> — AI content generation, performance analysis</li>
      <li><strong>Lemlist</strong> — Email/LinkedIn campaign execution</li>
      <li><strong>Brave Search</strong> — Web-based prospect research</li>
      <li><strong>Resend</strong> — Transactional emails (verification, password reset)</li>
    </ul>

    <SectionTitle>3. Data Storage</SectionTitle>
    <p>Data is stored on European servers:</p>
    <ul>
      <li><strong>Supabase</strong> — PostgreSQL database (EU-West)</li>
      <li><strong>Railway</strong> — Backend hosting (EU-West)</li>
    </ul>

    <SectionTitle>4. Sub-processors</SectionTitle>
    <p>Anthropic (USA), Lemlist (France), Brave (USA), Resend (USA), Supabase (USA/EU), Railway (USA/EU).</p>

    <SectionTitle>5. Your Rights (GDPR)</SectionTitle>
    <p>Under GDPR, you have the following rights:</p>
    <ul>
      <li><strong>Access</strong> — Obtain a copy of your data</li>
      <li><strong>Rectification</strong> — Correct your data</li>
      <li><strong>Erasure</strong> — Request deletion of your data</li>
      <li><strong>Portability</strong> — Export your data</li>
      <li><strong>Objection</strong> — Object to data processing</li>
    </ul>
    <p>Contact: contact@baakal.ai</p>

    <SectionTitle>6. Cookies</SectionTitle>
    <p>Baakalai does not use third-party cookies. Only authentication tokens are stored in the browser's localStorage.</p>
  </>);
}
