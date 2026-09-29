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

/**
 * Les deux lignes d'une ligne de liste quand on regarde des AFFAIRES, pas des
 * personnes.
 *
 * Sous Deals et sous Clients, on cherche une société : « qui sont mes clients »
 * et « quelles affaires dorment » sont des questions de compte. La page mettait
 * pourtant le nom de la personne en gras et la société en dessous, en gris.
 * Sur une liste de deux cents lignes, on lit deux cents prénoms et aucune
 * entreprise.
 *
 * La société passe donc devant, et la personne devient ce qu'elle est à ce
 * niveau : l'interlocuteur. Repli sur la personne quand la société manque, pour
 * qu'une ligne ne soit jamais vide en gras · c'est le cas d'un CRM dont les
 * contacts n'ont pas d'organisation, et il est fréquent.
 *
 * @returns {{ primary: string, secondary: string }}
 */
export function accountFirstLines(contact) {
  const company = contact?.company && String(contact.company).trim() ? contact.company : null;
  if (!company) {
    return { primary: contact?.name || '', secondary: contactSubline(contact) };
  }
  const who = [contact?.name, contact?.title].filter(p => p && String(p).trim()).join(' · ');
  return { primary: company, secondary: who || contact?.email || '' };
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
