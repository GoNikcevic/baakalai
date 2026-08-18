import { useState } from 'react';
import { useI18n } from '../i18n';

const FAQ_FR = [
  {
    category: 'Démarrage',
    items: [
      { q: 'Comment connecter mon CRM ?', a: 'Va dans Paramètres → Intégrations. Baakalai supporte Pipedrive, HubSpot, Salesforce et Odoo. Clique sur "Connecter" et suis les instructions (clé API ou OAuth).' },
      { q: 'Comment lancer ma première campagne ?', a: 'Tape dans le chat : "Crée une campagne de prospection pour [ton secteur cible]". L\'IA génère une séquence email + LinkedIn que tu peux déployer sur Lemlist, Apollo ou Smartlead.' },
      { q: 'Comment connecter mon email (Gmail/Outlook) ?', a: 'Va dans Paramètres → Comptes Email → "Connecter Gmail" ou "Connecter Microsoft". L\'authentification OAuth sécurisée se fait en un clic.' },
      { q: 'Qu\'est-ce que l\'extension Chrome ?', a: 'L\'extension Baakalai te permet d\'ajouter des contacts depuis LinkedIn, voir leur statut CRM et envoyer des emails — sans quitter LinkedIn. Installe-la depuis les paramètres.' },
    ],
  },
  {
    category: 'Activation & Nurture',
    items: [
      { q: 'Qu\'est-ce qu\'un trigger ?', a: 'Un trigger déclenche automatiquement un email personnalisé quand une condition est remplie (lead stagnant depuis 14j, contact inactif, lead gagné...). Configure-les dans Activation → Triggers.' },
      { q: 'Quelle est la différence entre mode "auto" et "approbation" ?', a: 'En mode auto, l\'email est envoyé immédiatement. En mode approbation, il est mis en file d\'attente pour que tu le valides avant envoi.' },
      { q: 'Comment fonctionne le A/B testing ?', a: 'Active le A/B sur un trigger → Baakalai génère 2 variantes pour chaque email → après 7 jours, il déclare un gagnant statistiquement. Le système apprend et alloue plus de trafic à la variante gagnante.' },
      { q: 'Qu\'est-ce que le churn score ?', a: 'Un score de 0 à 100 qui prédit le risque de perte d\'un client. Basé sur : inactivité, sentiment des derniers emails, durée du lead, et retard de paiement.' },
    ],
  },
  {
    category: 'Mémoire IA & Apprentissage',
    items: [
      { q: 'Comment l\'IA apprend-elle ?', a: 'Chaque email envoyé et chaque réponse reçue alimentent la mémoire. L\'IA identifie les patterns qui marchent (meilleur timing, meilleur ton, meilleur angle) et les applique automatiquement.' },
      { q: 'Qu\'est-ce qu\'un pattern "Approuvé" ?', a: 'Un pattern que tu as validé manuellement dans la Mémoire IA. Les patterns approuvés sont toujours prioritaires dans la génération d\'emails.' },
      { q: 'Les patterns se dégradent-ils ?', a: 'Oui. Un pattern non confirmé depuis 60 jours perd un tier de confiance (Haute → Moyenne → Faible). Les patterns approuvés ne sont jamais dégradés.' },
      { q: 'Qu\'est-ce que pgvector / recherche sémantique ?', a: 'Baakalai utilise des embeddings vectoriels pour trouver les patterns les plus pertinents pour chaque email. Plus intelligent qu\'un simple filtre par catégorie.' },
    ],
  },
  {
    category: 'Équipe & Sécurité',
    items: [
      { q: 'Comment inviter un membre d\'équipe ?', a: 'Va dans Profil → Équipe → "Inviter". Chaque membre peut avoir un rôle (admin, prospection, activation, viewer). Max 5 membres par équipe.' },
      { q: 'Les données sont-elles partagées entre les membres ?', a: 'Oui : contacts, campagnes, patterns et triggers sont partagés au sein de l\'équipe. Chaque membre envoie depuis son propre email.' },
      { q: 'Mes données sont-elles sécurisées ?', a: 'Oui. Chiffrement AES-256 pour les clés API, authentification JWT, headers Helmet, et passwords hashés en bcrypt 12. Voir notre politique de confidentialité.' },
    ],
  },
  {
    category: 'Facturation',
    items: [
      { q: 'Combien coûte Baakalai ?', a: 'Baakalai est à 75€/mois par utilisateur. Inclut : IA illimitée, toutes les intégrations, support prioritaire, et accès à tous les agents stratégiques.' },
      { q: 'Puis-je annuler à tout moment ?', a: 'Oui, sans engagement. Tu gardes l\'accès jusqu\'à la fin de ta période facturée.' },
    ],
  },
];

const FAQ_EN = [
  {
    category: 'Getting Started',
    items: [
      { q: 'How do I connect my CRM?', a: 'Go to Settings → Integrations. Baakalai supports Pipedrive, HubSpot, Salesforce and Odoo. Click "Connect" and follow the instructions (API key or OAuth).' },
      { q: 'How do I launch my first campaign?', a: 'Type in chat: "Create a prospecting campaign for [your target sector]". The AI generates a full email + LinkedIn sequence you can deploy to Lemlist, Apollo or Smartlead.' },
      { q: 'How do I connect my email (Gmail/Outlook)?', a: 'Go to Settings → Email Accounts → "Connect Gmail" or "Connect Microsoft". Secure OAuth authentication in one click.' },
      { q: 'What is the Chrome extension?', a: 'The Baakalai extension lets you add contacts from LinkedIn, see their CRM status and send emails — without leaving LinkedIn. Install it from settings.' },
    ],
  },
  {
    category: 'Activation & Nurture',
    items: [
      { q: 'What is a trigger?', a: 'A trigger automatically sends a personalized email when a condition is met (lead stagnant for 14 days, inactive contact, lead won...). Configure them in Activation → Triggers.' },
      { q: 'What\'s the difference between "auto" and "approval" mode?', a: 'In auto mode, the email is sent immediately. In approval mode, it\'s queued for you to validate before sending.' },
      { q: 'How does A/B testing work?', a: 'Enable A/B on a trigger → Baakalai generates 2 variants per email → after 7 days, it declares a statistically significant winner. The system learns and allocates more traffic to the winning variant.' },
      { q: 'What is the churn score?', a: 'A 0-100 score predicting client loss risk. Based on: inactivity, recent email sentiment, lead duration, and payment delays.' },
    ],
  },
  {
    category: 'AI Memory & Learning',
    items: [
      { q: 'How does the AI learn?', a: 'Every sent email and every response feeds the memory. The AI identifies winning patterns (best timing, tone, angle) and applies them automatically.' },
      { q: 'What is an "Applied" pattern?', a: 'A pattern you manually approved in the AI Memory. Applied patterns always take priority in email generation.' },
      { q: 'Do patterns decay?', a: 'Yes. A pattern not confirmed in 60 days loses a confidence tier (High → Medium → Low). Applied patterns never decay.' },
      { q: 'What is pgvector / semantic search?', a: 'Baakalai uses vector embeddings to find the most relevant patterns for each email. Smarter than simple category filtering.' },
    ],
  },
  {
    category: 'Team & Security',
    items: [
      { q: 'How do I invite a team member?', a: 'Go to Profile → Team → "Invite". Each member can have a role (admin, prospection, activation, viewer). Max 5 members per team.' },
      { q: 'Is data shared between members?', a: 'Yes: contacts, campaigns, patterns and triggers are shared within the team. Each member sends from their own email.' },
      { q: 'Is my data secure?', a: 'Yes. AES-256 encryption for API keys, JWT authentication, Helmet headers, and bcrypt 12 password hashing. See our privacy policy.' },
    ],
  },
  {
    category: 'Billing',
    items: [
      { q: 'How much does Baakalai cost?', a: 'Baakalai is €75/month per user. Includes: unlimited AI, all integrations, priority support, and access to all strategic agents.' },
      { q: 'Can I cancel anytime?', a: 'Yes, no commitment. You keep access until the end of your billing period.' },
    ],
  },
];

export default function HelpPage() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const faq = en ? FAQ_EN : FAQ_FR;
  const [openItems, setOpenItems] = useState({});

  const toggle = (key) => setOpenItems(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1 className="page-title">{en ? 'Help Center' : 'Centre d\'aide'}</h1>
        <div className="page-subtitle">{en ? 'Frequently asked questions' : 'Questions fréquentes'}</div>
      </div>

      <div style={{ maxWidth: 720 }}>
        {faq.map((section, si) => (
          <div key={si} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {section.category}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {section.items.map((item, ii) => {
                const key = `${si}-${ii}`;
                const isOpen = openItems[key];
                return (
                  <div key={key} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                    overflow: 'hidden', transition: 'all 0.15s',
                  }}>
                    <button
                      onClick={() => toggle(key)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '14px 18px',
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span>{item.q}</span>
                      <span style={{ fontSize: 16, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                    </button>
                    {isOpen && (
                      <div style={{
                        padding: '0 18px 14px', fontSize: 13, lineHeight: 1.7,
                        color: 'var(--text-secondary)', borderTop: '1px solid var(--border)',
                        paddingTop: 12,
                      }}>
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 32, padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {en ? 'Still have questions?' : 'Encore des questions ?'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            {en ? 'Chat with us directly or email support.' : 'Discute avec nous directement ou envoie un email.'}
          </div>
          <a href="mailto:goran@baakal.ai" style={{
            display: 'inline-block', background: 'var(--accent)', color: '#fff',
            padding: '10px 24px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600,
          }}>
            {en ? 'Contact support' : 'Contacter le support'}
          </a>
        </div>
      </div>
    </div>
  );
}
