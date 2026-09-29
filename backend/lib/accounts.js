/**
 * Les COMPTES · lot 2 du modèle compte/deal/contact (migration 124).
 *
 * Reconstruit les sociétés à partir des contacts déjà importés, et rattache
 * chaque contact au sien.
 *
 * ── Pourquoi depuis la base et non depuis chaque connecteur ─────────────────
 *
 * Le produit aplatit les contacts en SEPT branches réparties dans DEUX
 * fonctions d'import. Ajouter l'identifiant de société dans chacune, c'est
 * quatorze endroits où l'oublier, et c'est exactement le mécanisme qui a fait
 * disparaître la date de création CRM puis l'owner (deux régressions déjà
 * payées, cf. le commentaire de importContactsForUser).
 *
 * `opportunities.company` est déjà renseignée par les sept branches. Partir
 * d'elle fait donc marcher les comptes pour tous les CRM d'un coup, y compris
 * Notion, Airtable, Folk et les imports CSV qui n'ont aucun objet société.
 *
 * ── Ce qui est délibérément laissé à plus tard ──────────────────────────────
 *
 * `crm_account_id` reste NULL ici, et les comptes sont donc créés en source
 * 'derived'. Renseigner le vrai identifiant demande de le faire traverser les
 * quatorze branches, ce que le lot 2 fera quand les connecteurs auront tous
 * été alignés · Salesforce l'expose déjà (`listContacts` le remonte depuis
 * aujourd'hui). Un compte dérivé se laisse écraser par le compte réel au
 * premier import qui le fournit : l'index unique porte sur le nom normalisé
 * tant que l'identifiant est absent.
 *
 * `crm_created_at` reste NULL aussi, et c'est un choix. On pourrait y mettre la
 * date du contact le plus ancien, mais ce serait recopier précisément le chiffre
 * faux qu'`icp_crm_history_months` utilise déjà (lib/icp-signals.js) : un
 * contact naît en même temps que son compte ou après, jamais avant. Un NULL
 * honnête vaut mieux qu'une valeur qui a l'air juste.
 */

const db = require('../db');
const logger = require('./logger');
const { normalizeAccountName } = require('./account-name');

/**
 * Crée ou met à jour les comptes d'un utilisateur, puis rattache ses contacts.
 *
 * Idempotent : rejouer la passe ne crée pas de doublon et ne déplace aucun
 * contact déjà bien rattaché.
 *
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.provider] · restreint à un CRM, sinon tous
 * @returns {Promise<{accounts: number, created: number, linked: number, skipped: number}>}
 */
async function syncAccountsForUser(userId, { provider = null } = {}) {
  const out = { accounts: 0, created: 0, linked: 0, skipped: 0 };
  try {
    const rows = await db.query(
      `SELECT id, company, owner_id, owner_email, crm_owner_id, crm_provider, account_id
         FROM opportunities
        WHERE user_id = $1 AND ($2::text IS NULL OR crm_provider = $2)`,
      [userId, provider]
    );

    // Regroupement par nom normalisé · c'est ici, et nulle part ailleurs, que
    // se décide ce qui est « la même société ».
    const groupes = new Map();
    for (const r of rows.rows) {
      const cle = normalizeAccountName(r.company);
      // Un contact sans société exploitable n'est rattaché à rien. Le ranger
      // dans un compte « inconnu » partagé mettrait des dizaines d'entreprises
      // sans lien dans le même dossier, et c'est écarté au §8.3 du plan.
      if (!cle) { out.skipped++; continue; }
      if (!groupes.has(cle)) groupes.set(cle, { nom: r.company, contacts: [], owners: [] });
      const g = groupes.get(cle);
      g.contacts.push(r);
      if (r.owner_email) g.owners.push(r.owner_email);
    }
    out.accounts = groupes.size;

    for (const [cle, g] of groupes) {
      // L'owner du COMPTE : le plus représenté parmi ses contacts, l'ordre
      // alphabétique pour départager afin que deux passes donnent le même
      // résultat. Ce n'est pas l'owner que le CRM déclare sur la société (il
      // faudra aller le lire), mais c'est déjà mieux que l'actuel, où un
      // compte a autant de commerciaux que de contacts.
      const compte = new Map();
      for (const o of g.owners) compte.set(o, (compte.get(o) || 0) + 1);
      const owner = [...compte.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] || null;

      const res = await db.query(
        `INSERT INTO accounts (user_id, crm_provider, name, name_normalized, owner_email, source)
         VALUES ($1, $2, $3, $4, $5, 'derived')
         ON CONFLICT (user_id, name_normalized) WHERE crm_account_id IS NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           owner_email = COALESCE(EXCLUDED.owner_email, accounts.owner_email),
           updated_at = now()
         RETURNING id, (xmax = 0) AS cree`,
        [userId, g.contacts[0]?.crm_provider || provider, g.nom, cle, owner]
      );
      const accountId = res.rows[0]?.id;
      if (!accountId) continue;
      if (res.rows[0].cree) out.created++;

      // Ne réécrit que ce qui change · sans ce filtre, chaque passe toucherait
      // toutes les lignes et ferait bouger updated_at pour rien, ce que le
      // scoring de récence lit ensuite comme de l'activité.
      const aLier = g.contacts.filter(c => c.account_id !== accountId).map(c => c.id);
      if (aLier.length > 0) {
        const maj = await db.query(
          `UPDATE opportunities SET account_id = $1 WHERE id = ANY($2)`,
          [accountId, aLier]
        );
        out.linked += maj.rowCount || 0;
      }
    }

    logger.info('accounts',
      `${userId} · ${out.accounts} compte(s), ${out.created} créé(s), ${out.linked} contact(s) rattaché(s), ${out.skipped} sans société`);
  } catch (err) {
    // Best-effort comme tout ce qui complète un import : un compte manquant
    // n'empêche aucun écran de fonctionner, account_id étant nullable partout.
    logger.warn('accounts', `Reconstruction des comptes échouée pour ${userId} : ${err.message}`);
  }
  return out;
}

/** Les comptes d'un utilisateur, avec ce qu'ils portent. */
async function listAccounts(userId, { limit = 500 } = {}) {
  const res = await db.query(
    `SELECT a.id, a.name, a.owner_email, a.source, a.crm_provider,
            count(o.id)::int AS contacts,
            count(*) FILTER (WHERE o.status = 'won')::int AS deals_gagnes,
            count(*) FILTER (WHERE o.status NOT IN ('won', 'lost'))::int AS deals_ouverts,
            COALESCE(sum(o.deal_value), 0) AS montant,
            max(o.last_activity_at) AS last_activity_at
       FROM accounts a
       LEFT JOIN opportunities o ON o.account_id = a.id
      WHERE a.user_id = $1
      GROUP BY a.id
      ORDER BY montant DESC NULLS LAST, a.name
      LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}

module.exports = { syncAccountsForUser, listAccounts };
