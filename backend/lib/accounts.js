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
 * ── Deux passes, et elles ne font pas la même chose ─────────────────────────
 *
 * `importCrmAccounts` lit les VRAIES sociétés du CRM, avec leur identifiant
 * natif. C'est ce qui donne aux comptes une IDENTITÉ : un renommage reste le
 * même compte, deux homonymes restent deux comptes, et surtout un deal pourra
 * se rattacher par son identifiant de société au lieu d'être deviné. Elle
 * apporte aussi `crm_created_at`, donc la vraie ancienneté de la relation, et
 * répare au passage la sous-estimation d'`icp_crm_history_months`.
 *
 * `syncAccountsForUser` regroupe les contacts et les rattache. Quand le CRM
 * n'expose aucune société (Notion, Airtable, Folk, CSV) ou que sa lecture n'a
 * pas encore été écrite, elle crée des comptes DÉRIVÉS, clés sur le nom
 * normalisé. Ces comptes-là groupent sans identifier, et c'est assumé : ils se
 * font absorber par le compte réel dès qu'il arrive, contacts compris.
 *
 * L'ordre importe : les vraies sociétés d'abord, le regroupement ensuite, pour
 * que les contacts se rattachent directement au bon compte plutôt que de
 * transiter par un dérivé.
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

    // Les comptes déjà connus, réels ET dérivés, indexés par nom normalisé. Un
    // compte réel importé du CRM doit être RÉUTILISÉ, jamais doublé par un
    // dérivé portant le même nom.
    const connus = await db.query(
      `SELECT id, name_normalized, owner_email, crm_account_id FROM accounts WHERE user_id = $1`,
      [userId]
    );
    const parNom = new Map();
    for (const a of connus.rows) {
      const existant = parNom.get(a.name_normalized);
      // À égalité de nom, le compte RÉEL gagne : c'est lui qui porte l'identité.
      if (!existant || (!existant.crm_account_id && a.crm_account_id)) parNom.set(a.name_normalized, a);
    }

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

      let accountId = parNom.get(cle)?.id || null;

      if (accountId) {
        // Compte déjà connu · on ne complète que ce qui manque. Écraser
        // l'owner d'un compte réel par une déduction faite sur ses contacts
        // remplacerait une information du CRM par une supposition.
        if (owner && !parNom.get(cle).owner_email) {
          await db.query(
            `UPDATE accounts SET owner_email = $2, updated_at = now() WHERE id = $1`,
            [accountId, owner]
          );
        }
      } else {
        // `DO NOTHING` puis relecture, plutôt qu'un `DO UPDATE ... RETURNING
        // (xmax = 0)` : `xmax` est une colonne système propre à Postgres, que
        // le miroir sqlite des tests ne connaît pas. La distinction créé /
        // existait se lit alors sur la présence d'une ligne rendue, ce qui est
        // vrai partout. Un conflit ici ne peut venir que d'une passe
        // concurrente, puisque `parNom` contenait déjà tous les comptes connus.
        const res = await db.query(
          `INSERT INTO accounts (user_id, crm_provider, name, name_normalized, owner_email, source)
           VALUES ($1, $2, $3, $4, $5, 'derived')
           ON CONFLICT (user_id, name_normalized) WHERE crm_account_id IS NULL
           DO NOTHING
           RETURNING id`,
          [userId, g.contacts[0]?.crm_provider || provider, g.nom, cle, owner]
        );
        if (res.rows[0]?.id) {
          accountId = res.rows[0].id;
          out.created++;
        } else {
          const existant = await db.query(
            `SELECT id FROM accounts WHERE user_id = $1 AND name_normalized = $2`,
            [userId, cle]
          );
          accountId = existant.rows[0]?.id || null;
        }
      }
      if (!accountId) continue;

      // Ne réécrit que ce qui change · sans ce filtre, chaque passe toucherait
      // toutes les lignes et ferait bouger updated_at pour rien, ce que le
      // scoring de récence lit ensuite comme de l'activité.
      const aLier = g.contacts.filter(c => c.account_id !== accountId).map(c => c.id);
      if (aLier.length > 0) {
        // `IN (...)` et non `= ANY($n)` : ANY est du Postgres pur, et le miroir
        // sqlite des tests s'arrête dessus avec « no such function: ANY ». Le
        // catch de fin avalant l'erreur, la passe rendait silencieusement zéro
        // rattachement, et AUCUN test ne pouvait le voir. Les identifiants
        // restent des paramètres, rien n'est concaténé.
        const params = [accountId, ...aLier];
        const trous = aLier.map((_, i) => `$${i + 2}`).join(', ');
        const maj = await db.query(
          `UPDATE opportunities SET account_id = $1 WHERE id IN (${trous})`,
          params
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

/**
 * Rattache UN contact à sa société, à l'instant où il est créé.
 *
 * ── Pourquoi ça ne pouvait pas rester à la charge de l'import ───────────────
 *
 * `syncAccountsForUser` tourne à la fin de chaque import CRM, et les trois
 * chemins d'import l'appellent. Mais cinq autres chemins créent des contacts
 * sans jamais passer par là : le webhook Pipedrive, l'extension Chrome,
 * l'import de campagne, la création manuelle depuis le tableau de bord et les
 * signaux.
 *
 * Un contact né par l'un de ces chemins reste donc sans `account_id` jusqu'à
 * la prochaine synchro complète du CRM, qui peut ne jamais venir. Et tant
 * qu'il l'est, sa société apparaît DEUX FOIS dans les listes : une ligne pour
 * les contacts rattachés au compte, une autre pour ceux qui ne le sont pas
 * encore et se regroupent par leur nom de société. Mesuré sur staging le
 * 30/09 : trois sociétés déjà coupées en deux.
 *
 * Rattacher à la création ferme la fenêtre à la source. C'est la seule façon
 * de tenir l'invariant dont dépend le lot 5 : un contact qui porte un nom de
 * société porte un `account_id`.
 *
 * Best-effort, et ça compte : un rattachement raté ne doit jamais empêcher la
 * création du contact. Une ligne sans compte se comporte exactement comme
 * avant ce lot.
 *
 * @returns {Promise<string|null>} l'id du compte, ou null
 */
async function attachContactToAccount(userId, { contactId, company, crmProvider = null } = {}) {
  try {
    const cle = normalizeAccountName(company);
    // Pas de société exploitable : on ne rattache à rien, et surtout pas à un
    // compte « inconnu » partagé, qui mettrait des dizaines d'entreprises sans
    // lien dans le même dossier (écarté au §8.3 du plan).
    if (!userId || !contactId || !cle) return null;

    // Le compte RÉEL d'abord : à égalité de nom, c'est lui qui porte
    // l'identité, et un dérivé homonyme finira absorbé par importCrmAccounts.
    const connus = await db.query(
      `SELECT id, crm_account_id FROM accounts WHERE user_id = $1 AND name_normalized = $2`,
      [userId, cle]
    );
    let accountId = connus.rows.find(a => a.crm_account_id)?.id || connus.rows[0]?.id || null;

    if (!accountId) {
      const res = await db.query(
        `INSERT INTO accounts (user_id, crm_provider, name, name_normalized, source)
         VALUES ($1, $2, $3, $4, 'derived')
         ON CONFLICT (user_id, name_normalized) WHERE crm_account_id IS NULL
         DO NOTHING
         RETURNING id`,
        [userId, crmProvider, company, cle]
      );
      accountId = res.rows[0]?.id || null;
      if (!accountId) {
        // Conflit : une passe concurrente vient de le créer, on le relit.
        const relu = await db.query(
          `SELECT id FROM accounts WHERE user_id = $1 AND name_normalized = $2`,
          [userId, cle]
        );
        accountId = relu.rows[0]?.id || null;
      }
    }
    if (!accountId) return null;

    await db.query(
      `UPDATE opportunities SET account_id = $1 WHERE id = $2 AND account_id IS NULL`,
      [accountId, contactId]
    );
    return accountId;
  } catch (err) {
    logger.warn('accounts', `Rattachement du contact ${contactId} échoué : ${err.message}`);
    return null;
  }
}

/**
 * Importe les VRAIES sociétés du CRM, avec leur identifiant natif.
 *
 * C'est ce qui sépare un compte qui groupe d'un compte qui IDENTIFIE. Sans
 * `crm_account_id` :
 *   · un renommage côté CRM crée un second compte en silence, et l'ancien
 *     reste là, vide, avec son historique ;
 *   · deux sociétés homonymes fusionnent, et rien ne le signale ;
 *   · surtout, un deal ne peut pas se rattacher par son identifiant de compte,
 *     donc baakalai continue de deviner son interlocuteur (voir §12.7 du plan
 *     et lib/deal-attribution.js). C'est toute la promesse du modèle.
 *
 * `crm_created_at` arrive avec, et c'est elle qui répare
 * `icp_crm_history_months` : lib/icp-signals.js le calcule aujourd'hui sur le
 * contact le plus ancien, alors qu'un contact naît en même temps que son compte
 * ou après. L'ancienneté de la relation était donc sous-estimée, avec des faux
 * négatifs sur le critère « au moins 12 mois ».
 *
 * Un compte DÉRIVÉ portant le même nom est absorbé : ses contacts déménagent
 * vers le compte réel et il disparaît. C'est ce qui rend la reconstruction par
 * nom sans regret, puisqu'elle se laisse remplacer dès que la vérité arrive.
 */
async function importCrmAccounts(userId, provider, creds) {
  const out = { fetched: 0, upserted: 0, absorbed: 0, error: null };
  try {
    let raw = [];
    if (provider === 'salesforce') {
      const sf = require('../api/salesforce');
      raw = await sf.listAccounts(creds.instanceUrl, creds.accessToken);
    } else if (provider === 'pipedrive') {
      const pd = require('../api/pipedrive');
      raw = await pd.listAllOrganizations(creds);
    } else if (provider === 'hubspot') {
      const hs = require('../api/hubspot');
      raw = await hs.listAllCompanies(creds);
    } else if (provider === 'odoo') {
      const odooApi = require('../api/odoo');
      // Les identifiants Odoo voyagent tantôt en objet, tantôt en JSON · les
      // autres appelants font le même désencapsulage.
      let parsed = creds;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return out; }
      }
      raw = await odooApi.listAllCompanies(parsed);
    } else {
      // Notion, Airtable et Folk n'ont aucun objet société : il n'y a rien à
      // lire, et les comptes dérivés par nom restent la bonne réponse.
      return out;
    }
    out.fetched = raw.length;

    // Le commercial que le CRM déclare SUR LA SOCIÉTÉ · c'est le bon owner
    // d'un compte, et il n'a aucune raison d'être celui d'un de ses contacts.
    // Sans cette résolution on ne stocke qu'un identifiant CRM, illisible à
    // l'écran. Best-effort : une carte vide laisse simplement l'email vide, et
    // le repli sur le contact majoritaire (syncAccountsForUser) prend le
    // relais.
    let ownerMap = new Map();
    try {
      const { buildOwnerMap } = require('./crm-owner-resolver');
      ownerMap = await buildOwnerMap(provider, creds, userId);
    } catch { /* pas de carte d'owners : on garde l'identifiant brut */ }

    for (const a of raw) {
      const cle = normalizeAccountName(a.name);
      if (!cle) continue;

      const crmOwnerId = a.ownerId ? String(a.ownerId) : null;
      const info = crmOwnerId ? ownerMap.get(crmOwnerId) : null;

      const res = await db.query(
        `INSERT INTO accounts
           (user_id, crm_provider, crm_account_id, name, name_normalized,
            industry, crm_owner_id, owner_email, owner_id, crm_created_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'crm')
         ON CONFLICT (user_id, crm_provider, crm_account_id) WHERE crm_account_id IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           name_normalized = EXCLUDED.name_normalized,
           industry = COALESCE(EXCLUDED.industry, accounts.industry),
           crm_owner_id = COALESCE(EXCLUDED.crm_owner_id, accounts.crm_owner_id),
           -- L'owner déclaré par le CRM ÉCRASE celui déduit des contacts · ici
           -- le CRM affirme, ailleurs baakalai supposait.
           owner_email = COALESCE(EXCLUDED.owner_email, accounts.owner_email),
           owner_id = COALESCE(EXCLUDED.owner_id, accounts.owner_id),
           crm_created_at = COALESCE(EXCLUDED.crm_created_at, accounts.crm_created_at),
           source = 'crm',
           updated_at = now()
         RETURNING id`,
        [userId, provider, String(a.id), a.name, cle,
         a.industry || null, crmOwnerId, info?.email || null, info?.baakalaiUserId || null,
         a.createdAt || null]
      );
      const reel = res.rows[0]?.id;
      if (!reel) continue;
      out.upserted++;

      // Le jumeau dérivé, s'il existe, rend ses contacts et s'efface.
      const jumeau = await db.query(
        `SELECT id FROM accounts
          WHERE user_id = $1 AND name_normalized = $2 AND crm_account_id IS NULL`,
        [userId, cle]
      );
      if (jumeau.rows[0] && jumeau.rows[0].id !== reel) {
        await db.query(`UPDATE opportunities SET account_id = $1 WHERE account_id = $2`,
          [reel, jumeau.rows[0].id]);
        await db.query(`DELETE FROM accounts WHERE id = $1`, [jumeau.rows[0].id]);
        out.absorbed++;
      }
    }

    logger.info('accounts',
      `${provider} · ${out.fetched} société(s) lue(s), ${out.upserted} enregistrée(s), ${out.absorbed} compte(s) dérivé(s) absorbé(s)`);
  } catch (err) {
    out.error = err.message;
    logger.warn('accounts', `Import des sociétés ${provider} échoué pour ${userId} : ${err.message}`);
  }
  return out;
}

/**
 * Les RÔLES et l'interlocuteur principal · lot 3 (migration 125).
 *
 * Deux passes en une, parce qu'elles lisent les mêmes lignes :
 *
 *   · le rôle de chaque contact, déduit de son intitulé de poste quand le CRM
 *     n'en déclare pas. Une ligne déjà marquée 'crm' ou 'user' n'est jamais
 *     touchée : le CRM affirme, l'utilisateur tranche, baakalai comble.
 *   · l'interlocuteur principal de chaque compte, un seul, élu selon des
 *     critères ordonnés (voir lib/contact-role.js).
 *
 * À faire APRÈS le rattachement aux comptes, sinon il n'y a pas de compte sur
 * lequel élire quoi que ce soit.
 */
async function syncContactRoles(userId, { provider = null } = {}) {
  const out = { roles: 0, primaries: 0 };
  try {
    const { roleFromTitle, electPrimary } = require('./contact-role');

    const rows = await db.query(
      `SELECT id, account_id, title, last_activity_at, account_role, role_source, is_primary_contact
         FROM opportunities
        WHERE user_id = $1 AND ($2::text IS NULL OR crm_provider = $2)`,
      [userId, provider]
    );

    // ── Les rôles ──
    for (const c of rows.rows) {
      // Ni le CRM ni l'utilisateur ne se font corriger par une déduction.
      if (c.role_source === 'crm' || c.role_source === 'user') continue;
      const role = roleFromTitle(c.title);
      if (!role || role === c.account_role) continue;
      await db.query(
        `UPDATE opportunities SET account_role = $2, role_source = 'inferred' WHERE id = $1`,
        [c.id, role]
      );
      c.account_role = role;
      c.role_source = 'inferred';
      out.roles++;
    }

    // ── Le principal, un par compte ──
    const parCompte = new Map();
    for (const c of rows.rows) {
      if (!c.account_id) continue;
      if (!parCompte.has(c.account_id)) parCompte.set(c.account_id, []);
      parCompte.get(c.account_id).push(c);
    }

    for (const [accountId, contacts] of parCompte) {
      const elu = electPrimary(contacts);
      if (!elu) continue;
      // Deux écritures ciblées plutôt qu'un UPDATE global : ne toucher que ce
      // qui change évite de faire bouger updated_at sur tout le compte, ce que
      // le scoring de récence relirait ensuite comme de l'activité.
      const aRetirer = contacts.filter(c => c.is_primary_contact && c.id !== elu.id).map(c => c.id);
      if (aRetirer.length > 0) {
        await db.query(`UPDATE opportunities SET is_primary_contact = false WHERE id = ANY($1)`, [aRetirer]);
      }
      if (!elu.is_primary_contact) {
        await db.query(`UPDATE opportunities SET is_primary_contact = true WHERE id = $1`, [elu.id]);
        out.primaries++;
      }
      void accountId;
    }

    logger.info('accounts',
      `${userId} · ${out.roles} rôle(s) déduit(s), ${out.primaries} interlocuteur(s) principal(aux) élu(s)`);
  } catch (err) {
    logger.warn('accounts', `Rôles non calculés pour ${userId} : ${err.message}`);
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

/**
 * La FICHE d'une société · lot 7.
 *
 * L'écran qui manquait : jusqu'ici une société n'existait qu'en ligne dans une
 * liste, et cliquer dessus ne menait nulle part. Tout ce qui est vrai d'une
 * entreprise était donc introuvable ou répété autant de fois qu'elle a
 * d'interlocuteurs.
 *
 * Les affaires viennent de `deals` (migration 126), jamais de la ligne du
 * contact. C'est la seule façon de montrer un gagné et un ouvert ensemble, ce
 * qui est la définition même de l'upsell et restait invisible par construction.
 *
 * Renvoie null si le compte n'existe pas OU n'appartient pas à cet utilisateur :
 * l'appelant répond 404 dans les deux cas, sans dire lequel des deux.
 *
 * @returns {Promise<object|null>}
 */
async function getAccountSheet(userId, accountId) {
  const compte = await db.query(
    `SELECT id, name, domain, industry, size, source, crm_provider, crm_account_id,
            owner_id, owner_email, crm_owner_id, crm_created_at, last_activity_at,
            churn_score, churn_factors, churn_scored_at, churn_flagged_at, created_at
       FROM accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId]
  );
  const a = compte.rows[0];
  if (!a) return null;

  const affaires = await db.query(
    `SELECT id, name, status, deal_value, currency, crm_stage, crm_pipeline_name,
            won_date, lost_date, lost_reason, close_date, renewal_date,
            last_activity_at, crm_created_at, crm_updated_at, updated_at, source,
            crm_deal_attribution
       FROM deals
      WHERE account_id = $1 AND user_id = $2
      ORDER BY status = 'open' DESC, deal_value DESC NULLS LAST`,
    [accountId, userId]
  );

  const contacts = await db.query(
    `SELECT id, name, email, title, status, account_role, role_source,
            is_primary_contact, last_activity_at, email_bounced_at, cooldown_until,
            churn_score
       FROM opportunities
      WHERE account_id = $1 AND user_id = $2
      ORDER BY is_primary_contact DESC, last_activity_at DESC NULLS LAST`,
    [accountId, userId]
  );

  // ── Les agrégats, calculés ici et pas à l'écran ──
  // Un montant qui se recalcule dans le composant est un montant qui finira par
  // différer de celui de la liste. Une seule source pour les deux.
  const somme = (filtre) => affaires.rows
    .filter(filtre)
    .reduce((n, d) => n + Number(d.deal_value || 0), 0);

  const ouvertes = affaires.rows.filter(d => d.status !== 'won' && d.status !== 'lost');
  const gagnees = affaires.rows.filter(d => d.status === 'won');

  // Les devises ne s'additionnent JAMAIS (arbitrage du 30/09) : on dit laquelle
  // domine et on signale les autres au lieu de produire un total qui mente.
  const devises = [...new Set(affaires.rows.map(d => d.currency).filter(Boolean))];

  // Injoignable au sens du plan §8.1, dérivé et jamais stocké. La distinction
  // compte : « aucun contact rattaché » est un trou de notre import, « des
  // contacts dont les adresses sont mortes » est une équipe qui a quitté la
  // société.
  const joignables = contacts.rows.filter(c => c.email && !c.email_bounced_at);

  let facteurs = a.churn_factors;
  if (typeof facteurs === 'string') {
    try { facteurs = JSON.parse(facteurs); } catch { facteurs = null; }
  }

  return {
    compte: {
      id: a.id,
      name: a.name,
      domain: a.domain,
      industry: a.industry,
      size: a.size,
      source: a.source,
      crmProvider: a.crm_provider,
      ownerEmail: a.owner_email,
      crmCreatedAt: a.crm_created_at,
      lastActivityAt: a.last_activity_at,
      churnScore: a.churn_score,
      churnFactors: Array.isArray(facteurs) ? facteurs : [],
      churnScoredAt: a.churn_scored_at,
      churnFlaggedAt: a.churn_flagged_at,
    },
    affaires: affaires.rows,
    // `is_primary_contact` est normalisé en booléen : Postgres rend `true`,
    // le miroir SQLite rend `1`. Laisser passer les deux obligerait l'écran à
    // gérer la différence, et c'est exactement le genre d'écart qui se découvre
    // en production sur un `=== true` silencieusement faux.
    contacts: contacts.rows.map(c => ({ ...c, is_primary_contact: Boolean(c.is_primary_contact) })),
    resume: {
      ouvert: somme(d => d.status !== 'won' && d.status !== 'lost'),
      gagne: somme(d => d.status === 'won'),
      perdu: somme(d => d.status === 'lost'),
      affairesOuvertes: ouvertes.length,
      affairesGagnees: gagnees.length,
      // L'upsell n'est pas une opinion : un compte qui porte à la fois un gagné
      // et un ouvert, c'est exactement ça.
      upsell: gagnees.length > 0 && ouvertes.length > 0,
      devises,
      devisesMelangees: devises.length > 1,
      contacts: contacts.rows.length,
      joignables: joignables.length,
      // NULL et non false quand il n'y a aucun contact : « personne n'est
      // joignable » et « personne n'est rattaché » sont deux faits différents.
      injoignable: contacts.rows.length === 0 ? null : joignables.length === 0,
      sansInterlocuteur: contacts.rows.length === 0,
      // Les champs vides de la SOCIÉTÉ. Se corrigent une fois pour tous ses
      // interlocuteurs, au lieu d'une fois par contact.
      champsManquants: [
        !a.industry && 'industry',
        !a.domain && 'domain',
        !a.owner_email && !a.crm_owner_id && 'owner',
      ].filter(Boolean),
    },
  };
}

module.exports = {
  syncAccountsForUser,
  attachContactToAccount,
  importCrmAccounts,
  syncContactRoles,
  listAccounts,
  getAccountSheet,
};
