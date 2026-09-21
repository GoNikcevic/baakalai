/* ===============================================================================
   BAKAL · ContactSubline
   Seconde ligne d'identité d'un contact : fonction, puis société.

   La fonction est en base et remplie par les sept importeurs CRM (`opportunities.title`,
   Contact.Title côté Salesforce, jobtitle côté HubSpot, job_title côté Pipedrive…),
   mais elle n'apparaissait quasiment nulle part : chaque écran affichait `name` puis
   `company`, et la fonction ne sortait qu'en repli, quand la société manquait. Or
   c'est elle qui dit à qui on parle, donc s'il faut relancer un acheteur ou un
   dirigeant. La règle est écrite ici une seule fois pour qu'elle ne rediverge pas
   d'une page à l'autre.

   Séparateur ponctuel volontaire : aucun mot à traduire, donc rien à maintenir
   dans fr.json / en.json pour cette ligne.
   =============================================================================== */

/**
 * « Directrice Marketing · Groupe Belfort », « Groupe Belfort » si la fonction
 * manque, l'email en dernier recours quand les deux manquent (`withEmail`).
 */
export function contactSubline(contact, { withEmail = true } = {}) {
  const parts = [contact?.title, contact?.company].filter(p => p && String(p).trim());
  if (parts.length > 0) return parts.join(' · ');
  return withEmail ? (contact?.email || '') : '';
}

export default function ContactSubline({ contact, withEmail = true, style }) {
  const text = contactSubline(contact, { withEmail });
  if (!text) return null;
  return (
    <div style={{
      fontSize: 12, color: 'var(--text-muted)',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      ...style,
    }}>
      {text}
    </div>
  );
}
