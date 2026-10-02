/**
 * L'ACCELERATEUR du lot 6 : une inscription, plusieurs interlocuteurs.
 *
 * ── Le probleme qu'on resout ────────────────────────────────────────────────
 *
 * Jusqu'ici une inscription visait UN contact (`sequence_enrollments` porte un
 * `opportunity_id NOT NULL` et rien d'autre). Ecrire a trois personnes d'une
 * meme societe demandait trois inscriptions independantes, qui ne se voyaient
 * pas entre elles. Le lot 5 en a montre le resultat : huit interlocuteurs d'un
 * compte, huit relances au meme domaine.
 *
 * ── Pourquoi ce module existe APRES le frein ────────────────────────────────
 *
 * Le plan classe ce lot en risque « tres eleve », et pour une raison precise :
 * trois destinataires au meme domaine la meme semaine est un motif de spam, et
 * une reputation d'expediteur met des mois a revenir. Le plafond par societe
 * (lib/account-cadence.js) a donc ete construit d'abord.
 *
 * Et il a fallu le REPARER avant d'ecrire une ligne ici : il ne comptait que
 * `nurture_emails`, alors que le moteur de sequence · le chemin que ce module
 * etend · journalise dans `campaign_sends`. Le plafond etait donc verifie a
 * chaque envoi mais jamais incremente par le moteur. Decoratif exactement la ou
 * il compte. Corrige le 2026-10-02.
 *
 * ── Les trois garde-fous, et ce que chacun empeche ──────────────────────────
 *
 *   1. LE PLAFOND (lib/account-cadence.js, pose au transport) : jamais plus de
 *      N messages par societe et par semaine, tous destinataires confondus.
 *   2. L'ESPACEMENT (ici) : jamais deux destinataires d'une meme societe dans
 *      la meme journee. Le plafond borne le NOMBRE sur la semaine, l'espacement
 *      borne la CONCENTRATION · deux messages a dix minutes d'intervalle
 *      respecteraient un plafond de deux par semaine et rateraient son esprit.
 *   3. L'EXCLUSIVITE (ici) : un contact n'est destinataire que d'une sequence
 *      vivante a la fois. C'est l'equivalent, au niveau destinataire, de
 *      l'index `idx_enrollments_one_live_per_opp` qui tient les inscriptions.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Ordre dans lequel on aborde les interlocuteurs d'un compte.
 *
 * Le decideur d'abord : c'est lui qui tranche, et un message qui lui arrive
 * apres que deux collegues ont ete sollicites ressemble a de l'insistance.
 * `other` et les roles inconnus ferment la marche.
 *
 * Vocabulaire fixe par la migration 125 (lot 1), pas redefini ici.
 */
const ROLE_PRIORITE = { decision_maker: 0, influencer: 1, operational: 2, other: 3 };
const PRIORITE_INCONNUE = 4;

/** Deux interlocuteurs d'une meme societe ne recoivent pas le meme jour. */
const HEURES_ENTRE_DESTINATAIRES = 24;

/**
 * Nombre d'interlocuteurs abordes au maximum sur un meme compte.
 *
 * Trois, parce qu'au-dela ce n'est plus du multi-threading, c'est du ratissage
 * de domaine · et parce que le plafond par defaut (2 par semaine) mettrait de
 * toute facon des semaines a en servir davantage.
 */
const MAX_DESTINATAIRES = 3;

/** Les statuts de destinataire qui comptent comme vivants. */
const STATUTS_VIVANTS = ['active', 'suspended'];

/** Les statuts d'inscription qui comptent comme vivants (cf. migration 103). */
const STATUTS_INSCRIPTION_VIVANTS = ['draft', 'active', 'paused'];

function prioriteDe(role) {
  const p = ROLE_PRIORITE[role];
  return p === undefined ? PRIORITE_INCONNUE : p;
}

/**
 * Les interlocuteurs d'un compte qu'on peut aborder, dans l'ordre.
 *
 * Exclut ceux qu'on ne peut pas joindre (pas d'email, email rebondi) et ceux
 * qui sont deja destinataires d'une sequence vivante ailleurs · l'exclusivite
 * du garde-fou 3.
 *
 * @returns {Promise<Array<{id, name, email, title, account_role, is_primary_contact}>>}
 */
async function listCandidates(userId, accountId, { limit = MAX_DESTINATAIRES } = {}) {
  const { rows } = await db.query(
    `SELECT o.id, o.name, o.email, o.title, o.account_role, o.is_primary_contact,
            o.last_activity_at
       FROM opportunities o
      WHERE o.user_id = $1
        AND o.account_id = $2
        AND o.email IS NOT NULL AND o.email <> ''
        AND o.email_bounced_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM sequence_recipients sr
           JOIN sequence_enrollments se ON se.id = sr.enrollment_id
          WHERE sr.opportunity_id = o.id
            AND sr.status IN ('active', 'suspended')
            AND se.status IN ('draft', 'active', 'paused')
        )`,
    [userId, accountId]
  );

  // Le tri se fait en JS et non en SQL : l'ordre de priorite des roles est une
  // decision produit qui vit dans ce fichier, et un `CASE WHEN` en SQL la
  // dupliquerait a un endroit ou personne ne penserait a la relire.
  // Les desabonnes sont retires ICI et pas dans la requete : la table
  // `contact_optouts` s'interroge par `email_hash` et non par `email` (choix
  // RGPD de lib/contact-optout.js, la colonne en clair peut etre vide). Un
  // `lower(co.email) = lower(o.email)` aurait donc rendu FAUX en silence et
  // laisse des desabonnes entrer dans une sequence. On passe par le helper qui
  // detient la regle de hachage.
  //
  // Le transport refuse de toute facon un desabonne (email-outbound.js) · le
  // filtrer en amont evite seulement d'inscrire quelqu'un qui ne recevra rien.
  const { isOptedOut } = require('./contact-optout');
  const joignables = [];
  for (const r of rows) {
    if (!(await isOptedOut(userId, r.email))) joignables.push(r);
  }
  rows.length = 0;
  rows.push(...joignables);

  rows.sort((a, b) => {
    const pa = prioriteDe(a.account_role);
    const pb = prioriteDe(b.account_role);
    if (pa !== pb) return pa - pb;
    // A role egal, l'interlocuteur principal du compte passe devant.
    const ia = a.is_primary_contact ? 0 : 1;
    const ib = b.is_primary_contact ? 0 : 1;
    if (ia !== ib) return ia - ib;
    // Puis le plus recemment actif · il a plus de chances de repondre.
    const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return String(a.id).localeCompare(String(b.id));   // deterministe
  });

  return rows.slice(0, Math.max(0, limit));
}

/**
 * Inscrit un COMPTE, avec ses destinataires.
 *
 * `opportunity_id` de l'inscription reste renseigne et designe le contact
 * d'ANCRAGE (le premier de la liste). Ce n'est pas de la compatibilite pour la
 * forme : une bonne partie du moteur et des ecrans joint dessus, et le rendre
 * nullable aurait demande de revoir chacun de ces chemins pour un gain nul.
 *
 * @returns {Promise<{enrollmentId, recipients}|null>} null si aucun
 *   interlocuteur n'est joignable · on ne cree pas une inscription vide.
 */
async function enrollAccount(userId, {
  accountId, goal, rationale = null, createdBy = 'agent', enrollmentSource = 'agent',
  limit = MAX_DESTINATAIRES,
  // Rattachements de l'automatisation · passes tels quels, pour qu'une
  // inscription de compte soit tracee comme n'importe quelle autre.
  status = 'draft', triggerId = null, workflowId = null, signalId = null, dedupKey = null,
} = {}) {
  const candidats = await listCandidates(userId, accountId, { limit });
  if (candidats.length === 0) {
    logger.info('account-sequences', `Aucun interlocuteur joignable sur le compte ${accountId}`);
    return null;
  }

  const ancre = candidats[0];
  const { rows } = await db.query(
    `INSERT INTO sequence_enrollments
       (user_id, opportunity_id, account_id, goal, status, rationale, created_by,
        enrollment_source, trigger_id, workflow_id, signal_id, dedup_key, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $5 = 'active' THEN now() ELSE NULL END)
     RETURNING id`,
    [userId, ancre.id, accountId, goal, status, rationale, createdBy,
      enrollmentSource, triggerId, workflowId, signalId, dedupKey]
  );
  const enrollmentId = rows[0].id;

  const recipients = [];
  for (const c of candidats) {
    // `ON CONFLICT DO NOTHING` sur (enrollment_id, opportunity_id) : deux
    // passages concurrents ne doivent pas doubler un destinataire.
    const r = await db.query(
      `INSERT INTO sequence_recipients (user_id, enrollment_id, opportunity_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (enrollment_id, opportunity_id) DO NOTHING
       RETURNING id`,
      [userId, enrollmentId, c.id, c.account_role || null]
    );
    if (r.rows[0]) recipients.push({ id: r.rows[0].id, opportunityId: c.id, role: c.account_role || null });
  }

  return { enrollmentId, recipients };
}

/**
 * Les destinataires d'une inscription, avec leur contact.
 *
 * ── Les inscriptions d'AVANT ce lot ─────────────────────────────────────────
 *
 * Elles n'ont aucune ligne dans `sequence_recipients`. On en fabrique une a la
 * volee depuis `opportunity_id`, plutot que de les migrer : une inscription
 * mono-contact EST une inscription a un destinataire, et une migration de
 * donnees pour exprimer ca aurait touche des lignes vivantes sans rien y
 * ajouter. Le destinataire synthetique porte `id: null`, ce qui le distingue
 * nettement · aucune ecriture ne doit le viser.
 */
async function recipientsOf(userId, enrollment) {
  const { rows } = await db.query(
    `SELECT sr.id, sr.opportunity_id, sr.role, sr.status, sr.last_sent_at, sr.sent_count,
            o.name, o.email, o.title, o.account_role, o.is_primary_contact
       FROM sequence_recipients sr
       JOIN opportunities o ON o.id = sr.opportunity_id
      WHERE sr.enrollment_id = $1
      ORDER BY sr.created_at`,
    [enrollment.id]
  );

  if (rows.length > 0) {
    return rows.map(r => ({
      recipientId: r.id,
      status: r.status,
      role: r.role,
      lastSentAt: r.last_sent_at,
      sentCount: Number(r.sent_count) || 0,
      prospect: { id: r.opportunity_id, name: r.name, email: r.email, title: r.title, account_role: r.account_role },
    }));
  }

  const prospect = await db.opportunities.get(enrollment.opportunity_id);
  if (!prospect) return [];
  return [{
    recipientId: null,
    status: 'active',
    role: prospect.account_role || null,
    lastSentAt: null,
    sentCount: 0,
    prospect,
  }];
}

/**
 * Le destinataire a servir maintenant, ou null.
 *
 * Sert UN seul destinataire par passage, meme quand plusieurs sont dus. C'est
 * le garde-fou 2 : le moteur tourne plusieurs fois par jour, et laisser deux
 * destinataires partir dans le meme passage annulerait l'espacement.
 *
 * @param {Array} recipients ce que rend recipientsOf
 * @param {number} dernierEnvoiCompte horodatage du dernier envoi a CE compte,
 *   tous destinataires confondus · 0 si aucun.
 */
function chooseNext(recipients, dernierEnvoiCompte = 0, maintenant = Date.now()) {
  const vivants = recipients.filter(r => r.status === 'active');
  if (vivants.length === 0) return null;

  // Un destinataire jamais servi passe avant un destinataire deja relance :
  // aborder un nouvel interlocuteur vaut mieux que de reinsister aupres du
  // meme, et c'est tout l'objet du multi-threading.
  const jamaisServi = vivants.filter(r => r.sentCount === 0);
  const file = jamaisServi.length > 0 ? jamaisServi : vivants;

  // L'espacement ne s'applique qu'entre destinataires DIFFERENTS. Relancer la
  // meme personne suit le rythme de sa sequence (les delais entre steps), pas
  // celui-ci : sinon un parcours a deux jours d'intervalle serait bride par une
  // regle qui ne le visait pas.
  if (jamaisServi.length > 0 && dernierEnvoiCompte > 0) {
    const ecoule = maintenant - dernierEnvoiCompte;
    if (ecoule < HEURES_ENTRE_DESTINATAIRES * 3600000) return null;
  }

  file.sort((a, b) => {
    const pa = prioriteDe(a.role ?? a.prospect?.account_role);
    const pb = prioriteDe(b.role ?? b.prospect?.account_role);
    if (pa !== pb) return pa - pb;
    const ta = a.lastSentAt ? new Date(a.lastSentAt).getTime() : 0;
    const tb = b.lastSentAt ? new Date(b.lastSentAt).getTime() : 0;
    if (ta !== tb) return ta - tb;   // le plus anciennement servi d'abord
    return String(a.prospect?.id).localeCompare(String(b.prospect?.id));
  });

  return file[0];
}

/**
 * Le dernier envoi parti vers n'importe quel interlocuteur d'un compte.
 *
 * Lit les DEUX journaux, pour la meme raison que le plafond : les relances
 * vont dans `nurture_emails`, le moteur de sequence dans `campaign_sends`. Ne
 * regarder qu'un seul rendrait l'espacement aveugle a la moitie des envois.
 *
 * @returns {Promise<number>} horodatage, ou 0 si aucun envoi.
 */
async function lastSendToAccount(userId, accountId) {
  try {
    const { rows } = await db.query(
      `SELECT max(quand) AS dernier FROM (
         SELECT ne.sent_at AS quand
           FROM nurture_emails ne
           JOIN opportunities o ON o.id = ne.opportunity_id
          WHERE ne.user_id = $1 AND o.account_id = $2 AND ne.status = 'sent'
         UNION ALL
         SELECT cs.sent_at AS quand
           FROM campaign_sends cs
           JOIN opportunities oc ON oc.id = cs.opportunity_id
          WHERE cs.user_id = $1 AND oc.account_id = $2
            AND cs.status = 'sent' AND cs.channel = 'email'
       ) envois`,
      [userId, accountId]
    );
    const d = rows[0]?.dernier;
    return d ? new Date(d).getTime() : 0;
  } catch (err) {
    // On ne sait pas quand on a ecrit pour la derniere fois. On rend « jamais »,
    // donc l'espacement ne bloque pas : c'est le plafond, lui, qui refuse en cas
    // de doute. Deux gardes qui echouent dans le meme sens laisseraient passer
    // un envoi groupe sur une panne de lecture.
    logger.warn('account-sequences', `Dernier envoi illisible pour le compte ${accountId}: ${err.message}`);
    return 0;
  }
}

/**
 * Ce qui a DEJA ete dit aux collegues, pour ne pas le redire.
 *
 * C'est la moitie « mais coherents » de « messages differencies par role mais
 * coherents entre eux ». Sans ca, deux interlocuteurs d'une meme societe
 * recoivent deux fois la meme accroche, se le disent, et le procede se voit.
 *
 * On ne rend que l'OBJET et le role du destinataire, pas les corps : il s'agit
 * d'eviter la redite, pas de recopier. Et `campaign_sends` ne garde de toute
 * facon ni objet ni corps, d'ou la lecture sur `nurture_emails` seule, assumee.
 */
async function siblingContext(userId, accountId, exceptOpportunityId) {
  try {
    const { rows } = await db.query(
      `SELECT ne.subject, o.name, o.title, o.account_role, ne.sent_at
         FROM nurture_emails ne
         JOIN opportunities o ON o.id = ne.opportunity_id
        WHERE ne.user_id = $1 AND o.account_id = $2
          AND ne.opportunity_id <> $3
          AND ne.status = 'sent'
        ORDER BY ne.sent_at DESC
        LIMIT 5`,
      [userId, accountId, exceptOpportunityId]
    );
    return rows.map(r => ({
      subject: r.subject,
      collegue: r.name,
      titre: r.title,
      role: r.account_role,
      quand: r.sent_at,
    }));
  } catch (err) {
    logger.warn('account-sequences', `Contexte des collegues illisible (${accountId}): ${err.message}`);
    return [];
  }
}

/**
 * Un contact a repondu · on se TAIT sur les autres fils de son compte.
 *
 * ── Pourquoi suspendre et non arreter ───────────────────────────────────────
 *
 * Une reponse d'un interlocuteur rend toute relance a ses collegues au mieux
 * inutile, au pire contre-productive : la societe a repondu, continuer a
 * solliciter trois personnes donne l'image d'un systeme qui ne lit pas ses
 * propres reponses.
 *
 * Mais la conversation peut retomber sans rien conclure, et il faut alors
 * pouvoir reprendre. D'ou `suspended` et non `stopped` : l'etat dit « pas
 * maintenant », pas « jamais ». C'est la distinction que la migration 132 pose
 * dans la contrainte de statut.
 *
 * @returns {Promise<number>} nombre de destinataires suspendus.
 */
async function suspendSiblings(userId, { accountId, exceptOpportunityId, reason = 'colleague_replied' } = {}) {
  if (!accountId) return 0;
  try {
    const { rowCount } = await db.query(
      `UPDATE sequence_recipients
          SET status = 'suspended', suspend_reason = $4, suspended_at = now(), updated_at = now()
        WHERE user_id = $1
          AND status = 'active'
          AND opportunity_id <> $3
          AND opportunity_id IN (
            SELECT id FROM opportunities WHERE user_id = $1 AND account_id = $2
          )`,
      [userId, accountId, exceptOpportunityId, reason]
    );
    if (rowCount > 0) {
      logger.info('account-sequences', `${rowCount} destinataire(s) suspendu(s) sur le compte ${accountId} (${reason})`);
    }
    return rowCount || 0;
  } catch (err) {
    logger.warn('account-sequences', `Suspension impossible (${accountId}): ${err.message}`);
    return 0;
  }
}

/** Le destinataire qui a repondu passe a `replied` · sa sequence s'arrete la. */
async function markReplied(userId, opportunityId) {
  try {
    await db.query(
      `UPDATE sequence_recipients
          SET status = 'replied', updated_at = now()
        WHERE user_id = $1 AND opportunity_id = $2 AND status IN ('active', 'suspended')`,
      [userId, opportunityId]
    );
  } catch (err) {
    logger.warn('account-sequences', `markReplied impossible (${opportunityId}): ${err.message}`);
  }
}

/** Un envoi est parti vers ce destinataire. */
async function markSent(recipientId) {
  if (!recipientId) return;   // destinataire synthetique d'une inscription d'avant
  try {
    await db.query(
      `UPDATE sequence_recipients
          SET sent_count = sent_count + 1, last_sent_at = now(), updated_at = now()
        WHERE id = $1`,
      [recipientId]
    );
  } catch (err) {
    logger.warn('account-sequences', `markSent impossible (${recipientId}): ${err.message}`);
  }
}

/**
 * Ce destinataire a epuise son parcours, ou on l'arrete.
 *
 * `stopped` et non un statut « termine » dedie : la contrainte de la migration
 * 132 en compte quatre, et un parcours epuise comme un rebond ont la meme
 * consequence · on n'ecrit plus a cette personne dans cette inscription. La
 * raison, elle, est conservee et les distingue.
 */
async function stopRecipient(recipientId, reason = 'sequence_done') {
  if (!recipientId) return;
  try {
    await db.query(
      `UPDATE sequence_recipients
          SET status = 'stopped', suspend_reason = $2, updated_at = now()
        WHERE id = $1`,
      [recipientId, reason]
    );
  } catch (err) {
    logger.warn('account-sequences', `stopRecipient impossible (${recipientId}): ${err.message}`);
  }
}

/**
 * Plus aucun destinataire vivant sur cette inscription ?
 *
 * C'est ce qui decide qu'une inscription de compte est terminee. Un
 * destinataire SUSPENDU compte comme vivant : il attend de voir si la
 * conversation du collegue aboutit, et terminer l'inscription le priverait de
 * sa reprise.
 */
async function allRecipientsDone(enrollmentId) {
  try {
    const { rows } = await db.query(
      `SELECT count(*) AS n FROM sequence_recipients
        WHERE enrollment_id = $1 AND status IN ('active', 'suspended')`,
      [enrollmentId]
    );
    return Number(rows[0]?.n) === 0;
  } catch (err) {
    // On ne sait pas : on NE termine PAS. Terminer a tort fermerait un parcours
    // encore dû, et personne ne le verrait repartir.
    logger.warn('account-sequences', `allRecipientsDone illisible (${enrollmentId}): ${err.message}`);
    return false;
  }
}

module.exports = {
  ROLE_PRIORITE, PRIORITE_INCONNUE, HEURES_ENTRE_DESTINATAIRES, MAX_DESTINATAIRES,
  STATUTS_VIVANTS, STATUTS_INSCRIPTION_VIVANTS,
  prioriteDe, listCandidates, enrollAccount, recipientsOf, chooseNext,
  lastSendToAccount, siblingContext, suspendSiblings, markReplied, markSent,
  stopRecipient, allRecipientsDone,
};
