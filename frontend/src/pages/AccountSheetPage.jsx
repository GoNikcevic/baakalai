/* ═══════════════════════════════════════════════════
   La FICHE d'une société, en PAGE · lot 7.

   Cette page ne porte plus que l'enveloppe : l'adresse, le chargement, le fil
   d'Ariane et le titre. Tout le contenu vit dans `components/AccountSheet.jsx`,
   partagé avec le panneau latéral de la page Clients.

   Pourquoi la page reste alors qu'une société s'ouvre maintenant en panneau :
   une adresse se partage, se met en favori, et s'ouvre dans un nouvel onglet
   depuis la liste (un clic avec Ctrl ou Cmd y mène toujours). Retirer la route
   aurait cassé tous les liens déjà échangés.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { request } from '../services/api-client';
import { useT } from '../i18n';
import AccountSheet from '../components/AccountSheet';

export default function AccountSheetPage() {
  const t = useT();
  const { id } = useParams();
  const [fiche, setFiche] = useState(null);
  const [etat, setEtat] = useState('chargement');

  // L'état n'est posé que dans les retours de la promesse, jamais de façon
  // synchrone dans l'effet : c'est le patron de la page Comptes, et le seul que
  // `react-hooks/set-state-in-effect` accepte. `etat` démarre déjà à
  // « chargement », donc il n'y a rien à réinitialiser ici.
  useEffect(() => {
    let vivant = true;
    request(`/crm/accounts/${id}`)
      .then(data => { if (vivant) { setFiche(data); setEtat('ok'); } })
      // Un compte inexistant et un compte d'un autre utilisateur rendent le
      // même 404, et l'écran dit la même chose dans les deux cas.
      .catch(() => { if (vivant) setEtat('introuvable'); });
    return () => { vivant = false; };
  }, [id]);

  if (etat === 'chargement') return null;

  if (etat === 'introuvable') {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">{t('accountSheet.notFoundTitle')}</h1>
          <div className="page-subtitle">{t('accountSheet.notFoundBody')}</div>
        </div>
        <Link to="/clients" style={{ fontSize: 13 }}>{t('accountSheet.backToClients')}</Link>
      </div>
    );
  }

  const { compte } = fiche;

  return (
    <div className="page">
      {/* Fil d'Ariane vers la page d'où l'on vient. Il n'existe pas d'entrée
          « Comptes » dans le menu (arbitrage du 29/09) : Deals et Clients SONT
          les listes de sociétés, et c'est vers elles qu'on remonte. */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        <Link to="/clients" style={{ color: 'inherit' }}>{t('nav.sectionClients')}</Link>
        {' / '}{compte.name}
      </div>

      <div className="page-header">
        <h1 className="page-title">{compte.name}</h1>
        <div className="page-subtitle">
          {[
            compte.industry,
            compte.crmProvider,
            compte.ownerEmail ? compte.ownerEmail.split('@')[0] : null,
            compte.source === 'derived' ? t('accounts.derived') : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>

      <AccountSheet fiche={fiche} />
    </div>
  );
}
