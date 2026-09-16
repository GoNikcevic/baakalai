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
          <svg width="22" height="22" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
            <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round"/>
            <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
            <circle cx="22" cy="26" r="7" fill="#C4B5FD"/>
            <circle cx="82" cy="30" r="8" fill="#9A84EB"/>
            <circle cx="30" cy="80" r="7" fill="#C4B5FD"/>
            <circle cx="50" cy="50" r="13" fill="#6E57FA"/>
          </svg>
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
        {isEN ? 'Last updated: May 2026' : 'Dernière mise à jour : mai 2026'} · contact@baakal.ai
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
    <p>L'utilisateur reste propriétaire de ses données (profil, campagnes, prospects, contenus générés). Baakalai n'utilise pas les données des utilisateurs pour entraîner ses modèles IA. Les données peuvent être exportées ou supprimées à tout moment via les paramètres du compte.</p>

    <SectionTitle>6. Intégrations tierces</SectionTitle>
    <p>Baakalai s'intègre avec des services tiers (Lemlist, Apollo, Brave Search, Claude API). L'utilisateur est responsable de respecter les conditions d'utilisation de ces services. Baakalai n'est pas responsable des interruptions ou changements de ces services tiers.</p>

    <SectionTitle>7. Disponibilité</SectionTitle>
    <p>Le service est fourni "en l'état" pendant la phase beta. Aucun SLA n'est garanti. Baakalai s'efforce de maintenir une disponibilité maximale mais ne peut garantir une absence totale d'interruptions.</p>

    <SectionTitle>8. Résiliation et suppression de compte</SectionTitle>
    <p>L'utilisateur peut résilier son compte à tout moment depuis les paramètres de son compte. La suppression est immédiate et entraîne la suppression définitive de toutes les données associées (campagnes, contacts, messages, documents, identifiants d'intégration). Cette action est irréversible.</p>

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
    <p>Users retain ownership of their data (profile, campaigns, prospects, generated content). Baakalai does not use user data to train its AI models. Data can be exported or deleted at any time via your account settings.</p>

    <SectionTitle>6. Third-Party Integrations</SectionTitle>
    <p>Baakalai integrates with third-party services (Lemlist, Apollo, Brave Search, Claude API). Users are responsible for complying with the terms of service of these services. Baakalai is not liable for interruptions or changes to third-party services.</p>

    <SectionTitle>7. Availability</SectionTitle>
    <p>The service is provided "as is" during the beta phase. No SLA is guaranteed. Baakalai strives to maintain maximum uptime but cannot guarantee zero interruptions.</p>

    <SectionTitle>8. Termination & Account Deletion</SectionTitle>
    <p>Users may terminate their account at any time from their account settings. Account deletion is immediate and permanently removes all associated data including campaigns, contacts, messages, uploaded documents, and integration credentials. This action cannot be undone.</p>

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
      <li><strong>Claude API (Anthropic)</strong>, Génération de contenu IA, analyse de performance</li>
      <li><strong>Lemlist</strong>, Exécution des campagnes email/LinkedIn</li>
      <li><strong>Brave Search</strong>, Recherche web de prospects</li>
      <li><strong>Resend</strong>, Emails transactionnels (vérification, reset password)</li>
    </ul>

    <SectionTitle>3. Hébergement</SectionTitle>
    <p>Les données sont stockées sur des serveurs européens :</p>
    <ul>
      <li><strong>Supabase</strong>, Base de données PostgreSQL (EU-West)</li>
      <li><strong>Railway</strong>, Hébergement backend (EU-West)</li>
    </ul>

    <SectionTitle>4. Sous-traitants</SectionTitle>
    <p>Anthropic (USA), Lemlist (France), Brave (USA), Resend (USA), Supabase (USA/EU), Railway (USA/EU).</p>

    <SectionTitle>5. Vos droits (RGPD)</SectionTitle>
    <p>Conformément au RGPD, vous disposez des droits suivants :</p>
    <ul>
      <li><strong>Accès</strong>, Obtenir une copie de vos données</li>
      <li><strong>Rectification</strong>, Corriger vos données</li>
      <li><strong>Suppression</strong>, Demander l'effacement de vos données</li>
      <li><strong>Portabilité</strong>, Exporter vos données</li>
      <li><strong>Opposition</strong>, Vous opposer au traitement</li>
    </ul>
    <p>Contact : contact@baakal.ai</p>

    <SectionTitle>6. Vos droits (CCPA, Résidents US/Californie)</SectionTitle>
    <p>Si vous résidez aux États-Unis ou en Californie, vous disposez des droits suivants :</p>
    <ul>
      <li><strong>Droit de savoir</strong>, Demander quelles données personnelles nous collectons et utilisons.</li>
      <li><strong>Droit de suppression</strong>, Demander la suppression de vos données. Utilisez l'option "Supprimer le compte" dans vos paramètres pour une suppression immédiate et définitive.</li>
      <li><strong>Droit de refus de vente</strong>, Baakalai ne vend pas de données personnelles à des tiers.</li>
      <li><strong>Non-discrimination</strong>, L'exercice de vos droits n'affecte pas la qualité du service.</li>
    </ul>
    <p>Pour exercer vos droits : paramètres du compte ou contact@baakal.ai</p>

    <SectionTitle>7. Conservation des données</SectionTitle>
    <p>Vos données sont conservées tant que votre compte est actif. En cas de suppression du compte, toutes les données sont définitivement supprimées immédiatement. Baakalai ne conserve pas de sauvegardes des données supprimées au-delà des cycles de backup standard (maximum 7 jours).</p>

    <SectionTitle>8. Sécurité des données</SectionTitle>
    <p>Toutes les données sont chiffrées en transit (TLS/HTTPS). Les clés API et identifiants d'intégration sont chiffrés au repos (AES-256-GCM). Les mots de passe sont hashés avec bcrypt (facteur de coût 12). L'accès est protégé par des tokens JWT à courte durée de vie (15 minutes).</p>

    <SectionTitle>9. Partage de données avec des tiers</SectionTitle>
    <p>Baakalai partage des données avec des tiers uniquement pour fournir le service. Nous ne vendons pas de données.</p>
    <ul>
      <li><strong>Anthropic (Claude API)</strong>, Paramètres de campagne pour la génération IA. Aucun email individuel de contact n'est envoyé.</li>
      <li><strong>CRM</strong>, Données contacts et deals synchronisées selon votre configuration.</li>
      <li><strong>Outils d'outreach</strong>, Séquences de campagne et données prospects pour la livraison email/LinkedIn.</li>
      <li><strong>Brave Search</strong>, Noms d'entreprises pour la recherche de prospects.</li>
    </ul>

    <SectionTitle>10. Cookies</SectionTitle>
    <p>Baakalai n'utilise pas de cookies tiers ni de tracking. Seuls des tokens d'authentification sont stockés dans le localStorage du navigateur.</p>

    <SectionTitle>11. Extension Chrome « baakalai, LinkedIn Connect »</SectionTitle>
    <p>L'extension Chrome optionnelle a une finalité unique : relier votre session LinkedIn à votre compte Baakalai, à votre demande explicite.</p>
    <ul>
      <li><strong>Données traitées</strong>, Votre cookie de session LinkedIn (li_at), lu uniquement après un clic explicite de votre part dans l'extension, puis transmis chiffré (TLS) à votre compte et stocké chiffré (AES-256-GCM). Votre token de session Baakalai est conservé localement par l'extension pour vous authentifier.</li>
      <li><strong>Ce que l'extension ne fait pas</strong>, Aucune lecture du contenu des pages, aucune collecte de navigation, aucune action sans votre premier clic, aucun partage ni revente.</li>
      <li><strong>Maintien de la connexion</strong>, Après votre première connexion, l'extension met à jour le cookie auprès de votre compte quand LinkedIn le renouvelle, jusqu'à ce que vous déconnectiez LinkedIn.</li>
      <li><strong>Déconnexion</strong>, À tout moment depuis l'extension ou depuis Réglages → LinkedIn ; le cookie est alors supprimé de nos serveurs.</li>
    </ul>
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
      <li><strong>Claude API (Anthropic)</strong>, AI content generation, performance analysis</li>
      <li><strong>Lemlist</strong>, Email/LinkedIn campaign execution</li>
      <li><strong>Brave Search</strong>, Web-based prospect research</li>
      <li><strong>Resend</strong>, Transactional emails (verification, password reset)</li>
    </ul>

    <SectionTitle>3. Data Storage</SectionTitle>
    <p>Data is stored on European servers:</p>
    <ul>
      <li><strong>Supabase</strong>, PostgreSQL database (EU-West)</li>
      <li><strong>Railway</strong>, Backend hosting (EU-West)</li>
    </ul>

    <SectionTitle>4. Sub-processors</SectionTitle>
    <p>Anthropic (USA), Lemlist (France), Brave (USA), Resend (USA), Supabase (USA/EU), Railway (USA/EU).</p>

    <SectionTitle>5. Your Rights (GDPR)</SectionTitle>
    <p>Under GDPR, you have the following rights:</p>
    <ul>
      <li><strong>Access</strong>, Obtain a copy of your data</li>
      <li><strong>Rectification</strong>, Correct your data</li>
      <li><strong>Erasure</strong>, Request deletion of your data</li>
      <li><strong>Portability</strong>, Export your data</li>
      <li><strong>Objection</strong>, Object to data processing</li>
    </ul>
    <p>Contact: contact@baakal.ai</p>

    <SectionTitle>6. Your Rights (CCPA, California/US Residents)</SectionTitle>
    <p>If you are a California resident or US-based user, you have the following rights under the CCPA:</p>
    <ul>
      <li><strong>Right to Know</strong>, You may request what personal information we collect, use, and share.</li>
      <li><strong>Right to Delete</strong>, You may request deletion of your personal information. Use the "Delete Account" option in your account settings for immediate, permanent deletion.</li>
      <li><strong>Right to Opt-Out of Sale</strong>, Baakalai does not sell personal information to third parties.</li>
      <li><strong>Non-Discrimination</strong>, You will not receive different service quality for exercising your rights.</li>
    </ul>
    <p>To exercise these rights, use your account settings or contact: contact@baakal.ai</p>

    <SectionTitle>7. Data Retention</SectionTitle>
    <p>Your data is retained as long as your account is active. Upon account deletion, all data is permanently removed immediately. Baakalai does not retain backups of deleted user data beyond standard database backup cycles (maximum 7 days).</p>

    <SectionTitle>8. Data Security</SectionTitle>
    <p>All data is encrypted in transit (TLS/HTTPS). API keys and integration credentials are encrypted at rest using AES-256-GCM. Passwords are hashed with bcrypt (cost factor 12). Access is protected by JWT tokens with short expiration (15 minutes).</p>

    <SectionTitle>9. Third-Party Data Sharing</SectionTitle>
    <p>Baakalai shares data with third parties only to provide the service. We do not sell data. Shared data includes:</p>
    <ul>
      <li><strong>Anthropic (Claude API)</strong>, Campaign parameters and content for AI generation. No individual contact emails are sent.</li>
      <li><strong>CRM providers</strong>, Contact and deal data synced bidirectionally per your configuration.</li>
      <li><strong>Outreach tools</strong>, Campaign sequences and prospect data for email/LinkedIn delivery.</li>
      <li><strong>Brave Search</strong>, Company names for prospect research queries.</li>
    </ul>

    <SectionTitle>10. Cookies</SectionTitle>
    <p>Baakalai does not use third-party cookies or tracking. Only authentication tokens are stored in the browser's localStorage.</p>

    <SectionTitle>11. Chrome Extension "baakalai, LinkedIn Connect"</SectionTitle>
    <p>The optional Chrome extension has a single purpose: linking your LinkedIn session to your Baakalai account, at your explicit request.</p>
    <ul>
      <li><strong>Data processed</strong>, Your LinkedIn session cookie (li_at), read only after an explicit click in the extension, then transmitted encrypted (TLS) to your account and stored encrypted (AES-256-GCM). Your Baakalai session token is kept locally by the extension to authenticate you.</li>
      <li><strong>What the extension does not do</strong>, No page content reading, no browsing data collection, no action without your initial click, no sharing or selling.</li>
      <li><strong>Keeping the connection alive</strong>, After your first connection, the extension updates the cookie on your account whenever LinkedIn rotates it, until you disconnect LinkedIn.</li>
      <li><strong>Disconnecting</strong>, At any time from the extension or from Settings → LinkedIn; the cookie is then deleted from our servers.</li>
    </ul>
  </>);
}
