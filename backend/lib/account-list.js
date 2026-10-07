/**
 * La liste des comptes, paginée et filtrée CÔTÉ SERVEUR.
 *
 * ── Ce que ça remplace, et pourquoi ─────────────────────────────────────────
 *
 * `ClientsPage` chargeait `/dashboard/opportunities?limit=500&sort=silence`
 * puis filtrait, regroupait et triait dans le navigateur. Trois conséquences,
 * dont une seule se voit :
 *
 *   1. la page ne connaît que les 500 contacts LES PLUS SILENCIEUX. La
 *      recherche ne cherche donc que là-dedans, et un client actif récemment
 *      est introuvable. Sur les tenants actuels ça ne mord pas (le plus gros
 *      en a 308), mais l'ICP visé est une PME avec au moins douze mois
 *      d'historique CRM : elle en a des milliers, et elle le rencontre le
 *      premier jour.
 *   2. les compteurs des tuiles de tête se calculaient sur cette fenêtre, donc
 *      annonçaient un nombre qui n'était pas celui de la base.
 *   3. tout le corps du CRM traversait le réseau à chaque ouverture de page.
 *
 * ── La clé de regroupement est celle de l'écran, pas celle de la base ───────
 *
 * On ne pagine PAS sur la table `accounts`. Mesuré sur staging le 30/09 : 26
 * contacts sur 565 portent un `account_id`, 380 ont un nom de société sans
 * ligne compte, et 159 n'ont ni l'un ni l'autre. Paginer sur `accounts`
 * montrerait 100 comptes et cacherait 539 contacts.
 *
 * La clé reproduit donc exactement ce que le front faisait :
 *
 *     account_id, sinon le nom de société, sinon le contact lui-même
 *
 * Un contact sans société reste sa propre ligne, sous son nom. Sans ce repli,
 * un CRM dont les personnes n'ont pas d'organisation ferait disparaître
 * presque tout le monde.
 *
 * ── On filtre les CONTACTS, puis on regroupe ────────────────────────────────
 *
 * Et pas l'inverse. Chercher « cheva » doit faire remonter le compte de
 * Sandrine Chevalier avec Sandrine dedans, pas le compte entier ni tous les
 * comptes du CRM. C'est le comportement d'aujourd'hui, et il est juste.
 *
 * ── Les seuils sont ceux du front, au jour près ─────────────────────────────
 *
 * Le front calcule `floor((maintenant - date) / 1 jour)` puis compare avec
 * `>`. « Dort » veut donc dire strictement plus de 30 jours ENTIERS, c'est-à-dire
 * un écart d'au moins 31 jours. D'où les `+ 1` plus bas : sans eux, les
 * compteurs du serveur et les couleurs de la liste se contrediraient d'un jour,
 * et c'est le genre d'écart qu'on met trois semaines à croire.
 */

const db = require('../db');
// Le point de passage unique de la bascule vers `deals` (lot 5). On lui demande
// seulement si la table est PEUPLÉE pour ce tenant : une seule façon de poser
// cette question dans tout le produit.
const { hasDeals } = require('./deal-reads');
const logger = require('./logger');

/** Miroirs exacts des constantes de frontend/src/pages/ClientsPage.jsx. */
const CLIENT_SILENCE_DAYS = 90;
const CLIENT_NEW_DAYS = 90;
const DEAL_DORMANT_DAYS = 30;
const DEAL_STALLED_DAYS = 60;
const AT_RISK_THRESHOLD = 60;

/** Combien de comptes par page. */
const PAGE_SIZE = 25;

/**
 * Une date ISO, il y a N jours.
 *
 * Calculée en JS et passée en paramètre plutôt qu'écrite en
 * `now() - interval '30 days'`. Le motif d'origine : le miroir sqlite compare
 * des CHAÎNES, et sa traduction de `now()` produisait « 2026-09-01 10:00:00 »
 * quand les valeurs stockées sont des ISO « 2026-09-01T10:00:00.000Z ». Le
 * « T » pèse plus lourd que l'espace dans une comparaison lexicale, et le test
 * passait à côté.
 *
 * Ce piège est refermé depuis le 2026-10-02 : le miroir rend désormais le même
 * ISO-8601 en Z partout (voir MAINTENANT_ISO dans db/sqlite-adapter.js), et le
 * contournement n'est plus nécessaire. Il reste en place parce qu'il est juste
 * et explicite, pas parce qu'il est obligatoire.
 */
function ilYAJours(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

/**
 * Les tuiles de tête, traduites en SQL.
 *
 * Une tuile est un FILTRE exclusif, pas une part de camembert : une activité
 * inconnue n'est comptée nulle part, parce que ranger une date absente dans
 * « au point mort » transformerait une donnée manquante en alerte.
 */
function conditionsDeTuile() {
  const c90 = ilYAJours(CLIENT_SILENCE_DAYS);
  const cNouveau = ilYAJours(CLIENT_NEW_DAYS);
  // Voir l'en-tête pour les `+ 1` : le front compte en jours entiers révolus.
  const cDormant = ilYAJours(DEAL_DORMANT_DAYS + 1);
  const cStalled = ilYAJours(DEAL_STALLED_DAYS + 1);
  return {
    // Côté Clients
    seg_new: { sql: 'o.won_date IS NOT NULL AND o.won_date > ?', params: [cNouveau] },
    seg_active: { sql: 'o.last_activity_at IS NOT NULL AND o.last_activity_at > ?', params: [c90] },
    seg_silent: { sql: 'o.last_activity_at IS NOT NULL AND o.last_activity_at <= ?', params: [c90] },
    seg_risk: { sql: 'COALESCE(o.churn_score, 0) >= ?', params: [AT_RISK_THRESHOLD] },
    // Côté Deals. Un deal perdu est sorti du pipeline : le compter aussi dans
    // une tranche de silence le ferait apparaître dans deux tuiles à la fois.
    deal_active: { sql: "o.status <> 'lost' AND o.last_activity_at IS NOT NULL AND o.last_activity_at > ?", params: [cDormant] },
    deal_dormant: { sql: "o.status <> 'lost' AND o.last_activity_at IS NOT NULL AND o.last_activity_at <= ? AND o.last_activity_at > ?", params: [cDormant, cStalled] },
    deal_stalled: { sql: "o.status <> 'lost' AND o.last_activity_at IS NOT NULL AND o.last_activity_at <= ?", params: [cStalled] },
    deal_lost: { sql: "o.status = 'lost'", params: [] },
  };
}

/** Les tuiles affichées de chaque côté, dans l'ordre de l'écran. */
const TUILES_PAR_CADRAGE = {
  clients: ['seg_new', 'seg_active', 'seg_silent', 'seg_risk'],
  deals: ['deal_active', 'deal_dormant', 'deal_stalled', 'deal_lost'],
};

/** Statuts qu'un filtre a le droit de demander · liste blanche, jamais la
 *  valeur brute de l'appelant, elle entre dans du SQL. */
const STATUTS = ['new', 'imported', 'interested', 'meeting', 'negotiation', 'won', 'lost', 'stagnant'];

/**
 * Construit le WHERE commun, en numérotation `$n`.
 *
 * Retourne aussi `params`, dans l'ordre. Tout ce qui vient de l'appelant passe
 * par un paramètre ; les seules chaînes concaténées sont des constantes de ce
 * module ou des valeurs sorties d'une liste blanche.
 */
function construireFiltres(userId, opts = {}) {
  const clauses = ['o.user_id = $1'];
  const params = [userId];
  const P = () => `$${params.length + 1}`;

  // Le rappel d'un écran d'audit : une liste d'identifiants explicite. Elle
  // prime sur le cadrage, sinon un contact gagné disparaîtrait d'un rappel
  // ouvert depuis Deals.
  if (Array.isArray(opts.ids) && opts.ids.length > 0) {
    const trous = opts.ids.map(id => { params.push(id); return `$${params.length}`; });
    clauses.push(`o.id IN (${trous.join(', ')})`);
  } else {
    if (opts.scope === 'deals') clauses.push("o.status <> 'won'");
    else if (opts.scope === 'clients') clauses.push("o.status = 'won'");

    if (opts.filter === 'churn_risk') {
      clauses.push(`o.status = 'won' AND o.churn_score IS NOT NULL AND o.churn_score >= ${P()}`);
      params.push(AT_RISK_THRESHOLD);
    } else if (opts.filter && opts.filter !== 'all' && STATUTS.includes(opts.filter)) {
      clauses.push(`o.status = ${P()}`);
      params.push(opts.filter);
    }

    if (opts.owner && opts.owner !== 'all') {
      clauses.push(`o.owner_id = ${P()}`);
      params.push(opts.owner);
    }
    if (opts.crm && opts.crm !== 'all') {
      clauses.push(`o.crm_provider = ${P()}`);
      params.push(opts.crm);
    }

    const tuiles = conditionsDeTuile();
    const tuile = opts.tile && tuiles[opts.tile];
    if (tuile) {
      // Les `?` de la définition deviennent des `$n` ici : la définition ne
      // peut pas connaître sa position dans la requête finale.
      let sql = tuile.sql;
      for (const v of tuile.params) {
        params.push(v);
        sql = sql.replace('?', `$${params.length}`);
      }
      clauses.push(`(${sql})`);
    }

    if (opts.search && String(opts.search).trim()) {
      const q = `%${String(opts.search).trim().toLowerCase()}%`;
      // Trois colonnes, un seul paramètre répété : le miroir sqlite
      // reconstruit la liste dans l'ordre d'apparition, donc répéter `$n` est
      // sûr des deux côtés.
      const p = P();
      params.push(q);
      clauses.push(
        `(LOWER(COALESCE(o.name, '')) LIKE ${p}` +
        ` OR LOWER(COALESCE(o.company, '')) LIKE ${p}` +
        ` OR LOWER(COALESCE(o.email, '')) LIKE ${p})`
      );
    }
  }

  return { where: clauses.join(' AND '), params };
}

/**
 * La clé de regroupement, identique à celle du front.
 *
 * `||` est la concaténation SQL standard, comprise par Postgres comme par
 * sqlite. Le cast en texte est explicite côté Postgres, transparent côté
 * sqlite, et l'adaptateur retire les `::text` qu'il ne connaît pas.
 */
const CLE_GROUPE = `COALESCE(CAST(o.account_id AS TEXT), NULLIF(TRIM(COALESCE(o.company, '')), ''), 'personne:' || CAST(o.id AS TEXT))`;

/** Les tris proposés · liste blanche, la valeur entre dans du SQL. */
const TRIS = {
  silence: 'derniere_activite ASC',
  value: 'montant DESC',
  name: 'nom ASC',
};

/**
 * Une page de comptes, avec leurs contacts.
 *
 * @returns {Promise<{groups, total, page, pageSize, tiles}>}
 */
async function listAccountPage(userId, opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(Math.max(parseInt(opts.pageSize, 10) || PAGE_SIZE, 1), 100);
  const { where, params } = construireFiltres(userId, opts);

  // Un tri par silence doit montrer les plus muets d'ABORD, et un compte sans
  // activité connue n'est pas le plus actif : NULLS LAST le mettrait en queue
  // alors qu'il est précisément ce qu'on cherche sous Deals.
  const tri = TRIS[opts.sort] || TRIS.silence;

  // 1. Les groupes de la page. Deux requêtes plutôt qu'une fenêtre
  //    `COUNT(*) OVER ()` : le miroir sqlite des tests ne garantit pas les
  //    fonctions de fenêtrage sur toutes les versions, et un total faux est
  //    pire qu'un aller-retour de plus.
  // ── Le montant vient des AFFAIRES, plus de la ligne du contact ──
  //
  // Mesuré sur staging le 2026-10-01, au même instant : `opportunities` voyait
  // 32 affaires ouvertes pour 936 700 €, `deals` en voit 47 pour 1 396 400 €.
  // La cause est structurelle : une ligne de contact porte UN montant, donc
  // deux affaires sur la même personne n'y tiennent pas et la plus récemment
  // modifiée réclame la ligne.
  //
  // La correction se fait en SQL et non en JS après coup, parce que `montant`
  // est aussi une CLÉ DE TRI (`TRIS.value`) : corrigé seulement à l'affichage,
  // le classement par montant resterait celui des chiffres faux.
  //
  // `MAX(da.total)` et non `SUM` : la jointure est au plus 1 pour 1, `da` ayant
  // une ligne par compte, et toutes les lignes d'un groupe partagent le même
  // `account_id`. Un groupe formé sur un nom de société en texte libre ou sur
  // une personne sans entreprise a `account_id` NULL, donc `da.total` NULL,
  // donc le COALESCE retombe sur la somme des contacts · ces groupes n'ont
  // aucune affaire dans `deals` à quoi se raccrocher.
  const surDeals = await hasDeals(userId);

  // ── OUVERT et GAGNÉ séparés, pas un seul total ──────────────────────────
  //
  // Les voir ENSEMBLE est la définition de l'upsell : une société qui a déjà
  // signé et qui a encore une affaire en cours est exactement la cible du job
  // numéro deux du produit. Un montant unique agrégé ne le dit pas, et c'est
  // pourtant ce que l'écran affichait.
  //
  // `CASE WHEN` et non `FILTER (WHERE ...)` : l'agrégat filtré est du SQL
  // standard que Postgres connaît, mais s'appuyer dessus ferait dépendre la
  // testabilité de la version de sqlite embarquée. Le `CASE` marche partout.
  const jointureDeals = surDeals
    ? `LEFT JOIN (
         SELECT account_id,
                SUM(deal_value) AS total,
                SUM(CASE WHEN status NOT IN ('won', 'lost') THEN deal_value ELSE 0 END) AS ouvert,
                SUM(CASE WHEN status = 'won' THEN deal_value ELSE 0 END) AS gagne
           FROM deals
          WHERE user_id = $1 AND account_id IS NOT NULL
          GROUP BY account_id
       ) da ON CAST(da.account_id AS TEXT) = CAST(o.account_id AS TEXT)`
    : '';

  const colonneMontant = surDeals
    ? `COALESCE(MAX(da.total), COALESCE(SUM(o.deal_value), 0)) AS montant`
    : `COALESCE(SUM(o.deal_value), 0) AS montant`;

  // Le repli quand `deals` est vide est calculé sur la ligne du contact, avec
  // la même coupure de statut. Il reste FAUX dès qu'une personne porte deux
  // affaires · c'est la limite connue d'`opportunities`, pas une nouvelle. Mais
  // il vaut mieux qu'un zéro, qui se lirait comme « rien de gagné ».
  const colonnesOuvertGagne = surDeals
    ? `COALESCE(MAX(da.ouvert), SUM(CASE WHEN o.status NOT IN ('won', 'lost') THEN COALESCE(o.deal_value, 0) ELSE 0 END)) AS ouvert,
       COALESCE(MAX(da.gagne),  SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.deal_value, 0) ELSE 0 END)) AS gagne`
    : `SUM(CASE WHEN o.status NOT IN ('won', 'lost') THEN COALESCE(o.deal_value, 0) ELSE 0 END) AS ouvert,
       SUM(CASE WHEN o.status = 'won' THEN COALESCE(o.deal_value, 0) ELSE 0 END) AS gagne`;

  // ── Le risque et le propriétaire viennent de la SOCIÉTÉ ─────────────────
  //
  // `MAX()` sur les deux, pour la raison déjà écrite plus haut à propos de
  // `da.total` : toutes les lignes d'un groupe partagent le même `account_id`,
  // donc la jointure est au plus 1 pour 1 et `MAX` rend la valeur, pas un
  // maximum. Un groupe sans `account_id` les reçoit NULL, ce qui est juste ·
  // il n'a pas de société, donc ni score ni propriétaire de société.
  //
  // Le propriétaire retombe sur celui des contacts quand la société n'en porte
  // pas : c'est la dette d'import du §6 du CLAUDE.md, et tant qu'elle n'est pas
  // soldée, afficher « non rattaché » partout serait plus faux que le repli.
  const jointureComptes = `LEFT JOIN accounts ac ON CAST(ac.id AS TEXT) = CAST(o.account_id AS TEXT)`;
  const colonnesCompte = `MAX(ac.churn_score) AS risque,
       COALESCE(MAX(ac.owner_email), MAX(o.owner_email)) AS proprietaire`;

  // ── LES SOCIETES SANS AUCUN INTERLOCUTEUR ────────────────────────────────
  //
  // La liste part d'`opportunities`, donc une societe a laquelle aucun contact
  // n'est rattache n'y apparaissait PAS DU TOUT. Mesure sur staging le
  // 2026-10-07 : 54 comptes dans ce cas, tous importes de Pipedrive et tous
  // porteurs d'un `crm_account_id` · ce sont de vraies organisations, pas des
  // comptes que baakalai aurait derives.
  //
  // Le cas est courant dans un vrai CRM : une organisation existe
  // independamment des personnes, et on en cree tous les jours avant de
  // connaitre l'interlocuteur. Les cacher revient a cacher de l'argent · l'une
  // d'elles porte 15 600 € de pipeline ouvert que personne ne voyait.
  //
  // Elles sont montrees dans LES DEUX cadrages, et c'est volontaire : sans
  // contact, on ne peut pas savoir si c'est un client ou un prospect. Les
  // ranger d'un cote serait une affirmation que rien ne soutient ; les cacher
  // des deux est le defaut qu'on corrige.
  //
  // En revanche elles disparaissent des qu'un FILTRE de contact est actif
  // (statut, tuile, rappel d'identifiants) : une tuile « Silencieux 90 j »
  // se calcule sur des contacts, et une societe qui n'en a aucun ne peut ni
  // la satisfaire ni la contredire. L'y faire figurer rendrait le compteur de
  // la tuile faux.
  const filtreDeContactActif = Boolean(
    (Array.isArray(opts.ids) && opts.ids.length > 0)
    || (opts.filter && opts.filter !== 'all')
    || opts.tile
  );

  const paramsUnion = [...params];
  let brancheSansContact = '';
  if (!filtreDeContactActif) {
    const condAgence = [];
    if (opts.owner && opts.owner !== 'all') {
      paramsUnion.push(opts.owner);
      condAgence.push(`a.owner_id = $${paramsUnion.length}`);
    }
    if (opts.crm && opts.crm !== 'all') {
      paramsUnion.push(opts.crm);
      condAgence.push(`a.crm_provider = $${paramsUnion.length}`);
    }
    if (opts.search) {
      paramsUnion.push(`%${String(opts.search).trim().toLowerCase()}%`);
      condAgence.push(`LOWER(a.name) LIKE $${paramsUnion.length}`);
    }

    const montantsCompte = surDeals
      ? `COALESCE((SELECT SUM(CASE WHEN d.status NOT IN ('won','lost') THEN d.deal_value ELSE 0 END)
                     FROM deals d WHERE d.account_id = a.id), 0)`
      : '0';
    const gagnesCompte = surDeals
      ? `COALESCE((SELECT SUM(CASE WHEN d.status = 'won' THEN d.deal_value ELSE 0 END)
                     FROM deals d WHERE d.account_id = a.id), 0)`
      : '0';

    brancheSansContact = `
      UNION ALL
      SELECT CAST(a.id AS TEXT) AS cle,
             a.name AS nom,
             0 AS contacts,
             ${montantsCompte} + ${gagnesCompte} AS montant,
             ${montantsCompte} AS ouvert,
             ${gagnesCompte} AS gagne,
             a.churn_score AS risque,
             a.owner_email AS proprietaire,
             a.last_activity_at AS derniere_activite,
             1 AS sans_interlocuteur
        FROM accounts a
       WHERE a.user_id = $1
         AND NOT EXISTS (SELECT 1 FROM opportunities o2 WHERE o2.account_id = a.id)
         ${condAgence.length ? 'AND ' + condAgence.join(' AND ') : ''}`;
  }

  const groupes = await db.query(
    `SELECT * FROM (
       SELECT ${CLE_GROUPE} AS cle,
              MAX(COALESCE(NULLIF(TRIM(COALESCE(o.company, '')), ''), o.name)) AS nom,
              COUNT(*) AS contacts,
              ${colonneMontant},
              ${colonnesOuvertGagne},
              ${colonnesCompte},
              MAX(o.last_activity_at) AS derniere_activite,
              0 AS sans_interlocuteur
         FROM opportunities o
         ${jointureDeals}
         ${jointureComptes}
        WHERE ${where}
        GROUP BY ${CLE_GROUPE}
       ${brancheSansContact}
     ) tous
     ORDER BY ${tri}
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    paramsUnion
  );

  const total = await db.query(
    `SELECT COUNT(*) AS n FROM (
       SELECT ${CLE_GROUPE} AS cle FROM opportunities o WHERE ${where} GROUP BY ${CLE_GROUPE}
       ${brancheSansContact ? brancheSansContact.replace(/SELECT CAST\(a\.id AS TEXT\) AS cle,[\s\S]*?FROM accounts a/, 'SELECT CAST(a.id AS TEXT) AS cle FROM accounts a') : ''}
     ) g`,
    paramsUnion
  );

  // 2. Les contacts des groupes de CETTE page, et d'eux seuls. C'est ce qui
  //    fait tenir la promesse : la page ne transporte plus tout le CRM.
  const cles = groupes.rows.map(g => String(g.cle));
  let contacts = [];
  if (cles.length > 0) {
    const paramsContacts = [...params];
    const trous = cles.map(c => { paramsContacts.push(c); return `$${paramsContacts.length}`; });
    const res = await db.query(
      `SELECT o.* FROM opportunities o
        WHERE ${where} AND ${CLE_GROUPE} IN (${trous.join(', ')})`,
      paramsContacts
    );
    contacts = res.rows;
  }

  // Le rattachement se refait en JS · une seule passe, et ça évite un
  // `json_agg` dont la traduction sqlite ne garantit pas l'ordre.
  const parCle = new Map(groupes.rows.map(g => [String(g.cle), {
    key: String(g.cle),
    name: g.nom || ' ',
    contacts: [],
    value: Number(g.montant) || 0,
    // Ouvert et gagné côte à côte · lot 7, écran 1.
    openValue: Number(g.ouvert) || 0,
    wonValue: Number(g.gagne) || 0,
    // Le score de la SOCIÉTÉ, et `null` quand elle n'est pas scorée · un compte
    // sans interlocuteur n'est pas « sain à 0 », il est NON SCORABLE, et
    // confondre les deux ferait passer un compte muet pour un compte en bonne
    // santé. L'écran doit pouvoir faire la différence, donc on ne replie pas
    // sur zéro ici.
    churnScore: g.risque == null ? null : Number(g.risque),
    owner: g.proprietaire || null,
    lastActivityAt: g.derniere_activite || null,
    // Un groupe qui n'est qu'une personne sans société · l'écran le dit, pour
    // ne pas faire passer un contact pour une entreprise.
    orphan: String(g.cle).startsWith('personne:'),
    // Une SOCIETE a laquelle aucun contact n'est rattache. Distinct d'`orphan`,
    // qui designe l'inverse · une personne sans societe. L'ecran doit pouvoir
    // dire « aucun interlocuteur », parce que ca explique d'un coup pourquoi
    // elle n'est ni scorable ni demarchable.
    sansInterlocuteur: Number(g.sans_interlocuteur) === 1,
    // L'identifiant de la SOCIÉTÉ, quand le groupe en est vraiment une, pour
    // que l'écran puisse ouvrir sa fiche (lot 7). Renseigné plus bas à partir
    // des contacts : la clé de groupe vaut soit un `account_id`, soit un nom de
    // société en texte libre, soit `personne:<id>`, et les distinguer par la
    // forme de la chaîne serait une heuristique qui casserait au premier compte
    // dont le nom ressemble à un identifiant. Le serveur le DIT.
    accountId: Number(g.sans_interlocuteur) === 1 ? String(g.cle) : null,
  }]));
  for (const c of contacts) {
    const cle = c.account_id != null ? String(c.account_id)
      : ((c.company || '').trim() || `personne:${c.id}`);
    const groupe = parCle.get(cle);
    if (!groupe) continue;
    groupe.contacts.push(c);
    if (c.account_id != null) groupe.accountId = String(c.account_id);
  }

  const [tiles, stats] = await Promise.all([
    countTiles(userId, opts),
    pageStats(userId, opts),
  ]);

  return {
    groups: groupes.rows.map(g => parCle.get(String(g.cle))),
    total: Number(total.rows[0]?.n) || 0,
    page,
    pageSize,
    tiles,
    stats,
  };
}

/**
 * Les agrégats de tête : répartition par statut, par CRM, et l'état du
 * pipeline. Ils alimentent les listes déroulantes et la ligne de résumé.
 *
 * Calculés sur le CADRAGE SEUL (Deals ou Clients), sans les filtres actifs :
 * une liste déroulante de statuts dont chaque option annonce zéro parce qu'un
 * autre filtre est actif ne sert plus à rien, elle empêche d'en sortir.
 *
 * Ils ne peuvent plus être calculés dans le navigateur : celui-ci ne reçoit
 * plus qu'une page. Un compteur de tête qui ne compterait que la page annonce
 * un nombre qui n'existe nulle part, et c'est déjà ce que faisait la fenêtre
 * de 500.
 */
async function pageStats(userId, opts = {}) {
  const { where, params } = construireFiltres(userId, { scope: opts.scope, ids: opts.ids });
  const tousParams = [...params];
  tousParams.push(ilYAJours(DEAL_DORMANT_DAYS + 1));
  const pDormant = `$${tousParams.length}`;

  tousParams.push(AT_RISK_THRESHOLD);
  const pRisque = `$${tousParams.length}`;

  const res = await db.query(
    `SELECT o.status AS statut, o.crm_provider AS crm, COUNT(*) AS n,
            COUNT(*) FILTER (WHERE o.deal_value IS NOT NULL) AS valorises,
            COALESCE(SUM(o.deal_value), 0) AS montant,
            COUNT(*) FILTER (WHERE o.status <> 'lost' AND o.last_activity_at IS NOT NULL
                               AND o.last_activity_at <= ${pDormant}) AS dorment,
            COUNT(*) FILTER (WHERE o.status = 'won' AND o.churn_score IS NOT NULL
                               AND o.churn_score >= ${pRisque}) AS a_risque
       FROM opportunities o
      WHERE ${where}
      GROUP BY o.status, o.crm_provider`,
    tousParams
  );

  const byStatus = {};
  const byProvider = {};
  let dormant = 0, valued = 0, value = 0, atRisk = 0, totalScope = 0;
  for (const r of res.rows) {
    const n = Number(r.n) || 0;
    totalScope += n;
    byStatus[r.statut || 'unknown'] = (byStatus[r.statut || 'unknown'] || 0) + n;
    if (r.crm) byProvider[r.crm] = (byProvider[r.crm] || 0) + n;
    dormant += Number(r.dorment) || 0;
    valued += Number(r.valorises) || 0;
    value += Number(r.montant) || 0;
    atRisk += Number(r.a_risque) || 0;
  }

  // ── Le montant de tête vient des AFFAIRES, comme celui des lignes ──
  //
  // Les comptages ci-dessus portent sur des CONTACTS et restent justes : c'est
  // bien une répartition de personnes par statut et par CRM. Le MONTANT, lui,
  // doit sortir de `deals`, sinon la tuile de tête annoncerait moins que la
  // somme des lignes visibles sous elle · deux chiffres faux de la même façon
  // valent mieux qu'un seul corrigé, et deux chiffres qui se contredisent sont
  // le plus sûr moyen de faire douter de tout l'écran.
  //
  // Le périmètre est défini par un filtre de CONTACTS : une affaire y entre si
  // sa société est celle d'un contact du périmètre, ou, à défaut de société, si
  // son interlocuteur en fait partie. Les affaires rattachées à une société
  // dont aucun contact n'est dans le périmètre en sortent, ce qui est la même
  // règle que pour les lignes.
  if (await hasDeals(userId)) {
    try {
      const vd = await db.query(
        `SELECT COALESCE(SUM(d.deal_value), 0) AS montant,
                COUNT(*) FILTER (WHERE d.deal_value IS NOT NULL) AS valorisees
           FROM deals d
          WHERE d.user_id = $1
            AND (
              d.account_id IN (
                SELECT o.account_id FROM opportunities o
                 WHERE ${where} AND o.account_id IS NOT NULL
              )
              OR (d.account_id IS NULL AND d.primary_contact_id IN (
                SELECT o.id FROM opportunities o WHERE ${where}
              ))
            )`,
        params
      );
      value = Number(vd.rows[0]?.montant) || 0;
      valued = Number(vd.rows[0]?.valorisees) || 0;
    } catch (err) {
      // Environnement en retard de migration : on garde les chiffres lus sur le
      // contact plutôt que de vider la ligne de résumé.
      logger.warn('account-list', `Montant des affaires indisponible pour ${userId}: ${err.message}`);
    }
  }
  // `atRisk` au seuil du PRODUIT (60), et non au 50 que l'onglet de la page
  // employait de son côté : il annonçait donc un autre nombre que le badge de
  // la navigation et que la page Clients à risque pour exactement la même
  // question. Même correctif que celui déjà fait sur AT_RISK_THRESHOLD.
  return { byStatus, byProvider, dormant, valued, value, atRisk, totalScope };
}

/**
 * Les compteurs des tuiles, sur TOUT le périmètre filtré et pas sur la page.
 *
 * C'est la raison d'être de cette fonction : un compteur qui ne compte que la
 * page affichée annonce un nombre qui n'existe nulle part, et c'est
 * exactement ce que faisait la version navigateur avec sa fenêtre de 500.
 *
 * La tuile ACTIVE est retirée du filtre avant de compter, sinon cliquer une
 * tuile mettrait les trois autres à zéro et il deviendrait impossible de
 * passer de l'une à l'autre.
 */
async function countTiles(userId, opts = {}) {
  const cadrage = opts.scope === 'clients' ? 'clients' : 'deals';
  const cles = TUILES_PAR_CADRAGE[cadrage];
  const defs = conditionsDeTuile();

  const { where, params } = construireFiltres(userId, { ...opts, tile: null });
  const morceaux = [];
  const tousParams = [...params];
  for (const cle of cles) {
    let sql = defs[cle].sql;
    for (const v of defs[cle].params) {
      tousParams.push(v);
      sql = sql.replace('?', `$${tousParams.length}`);
    }
    morceaux.push(`COUNT(*) FILTER (WHERE ${sql}) AS "${cle}"`);
  }

  const res = await db.query(
    `SELECT ${morceaux.join(', ')} FROM opportunities o WHERE ${where}`,
    tousParams
  );
  const ligne = res.rows[0] || {};
  return cles.map(cle => ({ key: cle, count: Number(ligne[cle]) || 0 }));
}

module.exports = {
  PAGE_SIZE,
  CLIENT_SILENCE_DAYS,
  CLIENT_NEW_DAYS,
  DEAL_DORMANT_DAYS,
  DEAL_STALLED_DAYS,
  AT_RISK_THRESHOLD,
  TUILES_PAR_CADRAGE,
  listAccountPage,
  countTiles,
  pageStats,
};
