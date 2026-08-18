/* ===============================================================================
   BAKAL — Floating Help Widget
   FAQ accordion in a slide-up panel, always accessible via "?" button.
   =============================================================================== */

import { useState } from 'react';
import { useI18n } from '../i18n';

const FAQ_FR = [
  {
    category: 'Demarrage',
    items: [
      { q: 'Comment connecter mon CRM ?', a: 'Va dans Parametres → Integrations. Baakalai supporte Pipedrive, HubSpot, Salesforce et Odoo. Clique sur "Connecter" et suis les instructions.' },
      { q: 'Comment lancer ma premiere campagne ?', a: 'Tape dans le chat : "Cree une campagne de prospection pour [ton secteur cible]". L\'IA genere une sequence email + LinkedIn deployable sur Lemlist, Apollo ou Smartlead.' },
      { q: 'Comment connecter mon email ?', a: 'Va dans Parametres → Comptes Email → "Connecter Gmail" ou "Connecter Microsoft". Authentification OAuth en un clic.' },
    ],
  },
  {
    category: 'Activation & Nurture',
    items: [
      { q: 'Qu\'est-ce qu\'un trigger ?', a: 'Un trigger envoie automatiquement un email personnalise quand une condition est remplie (lead stagnant, contact inactif, lead gagne...). Configure-les dans Activation → Triggers.' },
      { q: 'Mode "auto" vs "approbation" ?', a: 'En auto, l\'email part immediatement. En approbation, il est mis en file d\'attente pour validation.' },
      { q: 'Qu\'est-ce que le churn score ?', a: 'Score de 0 a 100 qui predit le risque de perte d\'un client. Base sur : inactivite, sentiment, duree du lead, retard de paiement.' },
    ],
  },
  {
    category: 'Memoire IA',
    items: [
      { q: 'Comment l\'IA apprend-elle ?', a: 'Chaque email envoye et chaque reponse alimentent la memoire. L\'IA identifie les patterns qui marchent et les applique automatiquement.' },
      { q: 'Les patterns se degradent-ils ?', a: 'Oui. Un pattern non confirme depuis 60 jours perd un tier de confiance. Les patterns approuves ne sont jamais degrades.' },
    ],
  },
  {
    category: 'Equipe & Securite',
    items: [
      { q: 'Comment inviter un membre ?', a: 'Va dans Parametres → Equipe → "Inviter". Roles : admin, prospection, activation, viewer. Max 5 membres.' },
      { q: 'Mes donnees sont-elles securisees ?', a: 'Oui. Chiffrement AES-256, JWT, Helmet, bcrypt 12. Voir notre politique de confidentialite.' },
    ],
  },
];

const FAQ_EN = [
  {
    category: 'Getting Started',
    items: [
      { q: 'How do I connect my CRM?', a: 'Go to Settings → Integrations. Baakalai supports Pipedrive, HubSpot, Salesforce and Odoo. Click "Connect" and follow the instructions.' },
      { q: 'How do I launch my first campaign?', a: 'Type in chat: "Create a prospecting campaign for [your target sector]". The AI generates a full sequence deployable to Lemlist, Apollo or Smartlead.' },
      { q: 'How do I connect my email?', a: 'Go to Settings → Email Accounts → "Connect Gmail" or "Connect Microsoft". One-click OAuth authentication.' },
    ],
  },
  {
    category: 'Activation & Nurture',
    items: [
      { q: 'What is a trigger?', a: 'A trigger automatically sends a personalized email when a condition is met (stagnant lead, inactive contact, lead won...). Configure them in Activation → Triggers.' },
      { q: '"Auto" vs "approval" mode?', a: 'In auto mode, the email is sent immediately. In approval mode, it\'s queued for validation.' },
      { q: 'What is the churn score?', a: 'A 0-100 score predicting client loss risk. Based on: inactivity, sentiment, lead duration, payment delays.' },
    ],
  },
  {
    category: 'AI Memory',
    items: [
      { q: 'How does the AI learn?', a: 'Every sent email and response feeds the memory. The AI identifies winning patterns and applies them automatically.' },
      { q: 'Do patterns decay?', a: 'Yes. A pattern not confirmed in 60 days loses a confidence tier. Applied patterns never decay.' },
    ],
  },
  {
    category: 'Team & Security',
    items: [
      { q: 'How do I invite a team member?', a: 'Go to Settings → Team → "Invite". Roles: admin, prospection, activation, viewer. Max 5 members.' },
      { q: 'Is my data secure?', a: 'Yes. AES-256 encryption, JWT auth, Helmet headers, bcrypt 12 hashing. See our privacy policy.' },
    ],
  },
];

export default function HelpWidget() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const faq = en ? FAQ_EN : FAQ_FR;
  const [open, setOpen] = useState(false);
  const [openItems, setOpenItems] = useState({});

  const toggle = (key) => setOpenItems(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          width: 44, height: 44, borderRadius: '50%',
          background: 'var(--accent, #6E57FA)', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: 18, fontWeight: 700,
          boxShadow: '0 4px 16px rgba(110,87,250,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        title={en ? 'Help' : 'Aide'}
      >
        {open ? '\u2715' : '?'}
      </button>

      {/* Panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9998,
              background: 'rgba(0,0,0,0.15)',
            }}
          />
          {/* Content */}
          <div style={{
            position: 'fixed', bottom: 80, right: 24, zIndex: 9999,
            width: 380, maxWidth: 'calc(100vw - 48px)',
            maxHeight: 'calc(100vh - 120px)',
            background: 'var(--bg-card, white)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 12px 48px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            animation: 'slideUp 0.2s ease',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {en ? 'Help Center' : 'Centre d\'aide'}
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 16, color: 'var(--text-muted)', padding: '2px 6px',
                }}
              >
                {'\u2715'}
              </button>
            </div>

            {/* FAQ content */}
            <div style={{ overflowY: 'auto', padding: '12px 16px', flex: 1 }}>
              {faq.map((section, si) => (
                <div key={si} style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
                  }}>
                    {section.category}
                  </div>
                  {section.items.map((item, ii) => {
                    const key = `${si}-${ii}`;
                    const isOpen = openItems[key];
                    return (
                      <div key={key} style={{
                        background: 'var(--bg-elevated, var(--paper-2))',
                        borderRadius: 8, marginBottom: 4, overflow: 'hidden',
                      }}>
                        <button
                          onClick={() => toggle(key)}
                          style={{
                            width: '100%', textAlign: 'left', padding: '10px 14px',
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
                            fontFamily: 'inherit', gap: 8,
                          }}
                        >
                          <span>{item.q}</span>
                          <span style={{
                            fontSize: 14, color: 'var(--text-muted)', flexShrink: 0,
                            transition: 'transform 0.2s',
                            transform: isOpen ? 'rotate(180deg)' : 'none',
                          }}>
                            &#9662;
                          </span>
                        </button>
                        {isOpen && (
                          <div style={{
                            padding: '0 14px 10px', fontSize: 12, lineHeight: 1.7,
                            color: 'var(--text-secondary)',
                          }}>
                            {item.a}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Contact support */}
              <div style={{
                padding: 16, background: 'var(--bg-elevated, var(--paper-2))',
                borderRadius: 10, textAlign: 'center', marginTop: 8,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  {en ? 'Still have questions?' : 'Encore des questions ?'}
                </div>
                <a href="mailto:goran@baakal.ai" style={{
                  display: 'inline-block', background: 'var(--accent)', color: '#fff',
                  padding: '8px 20px', borderRadius: 8, textDecoration: 'none',
                  fontSize: 12, fontWeight: 600,
                }}>
                  {en ? 'Contact support' : 'Contacter le support'}
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
