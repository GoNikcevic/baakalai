/**
 * Deal lifecycle sync · maps each CRM's native won/lost signal onto opportunities:
 * status, won_date/lost_date, deal_value, lost_reason, next activity, pipeline stage.
 *
 * Extracted from crm-agent's stepSync so the manual Settings sync (lib/crm-sync.js)
 * runs it too: before this, a fresh « Analyser le CRM » imported contacts but left
 * every status on 'imported' until the next 9AM cron · so a new user saw no clients
 * (won) anywhere, and staging (orchestrator off) never mapped them at all.
 *
 * Every provider's getDeals() is normalized to the same shape ({ personId,
 * status: 'won'|'lost'|'open', value, updatedAt }), so this loop treats them
 * identically · status is always taken from the CRM's own native won/lost signal
 * (Pipedrive/Odoo: deal/stage flag; Salesforce: IsWon/IsClosed; HubSpot:
 * hs_is_closed_won/hs_is_closed), authoritative regardless of the opportunity's
 * current status · a deal the CRM now shows as lost must stop being treated as a
 * client even if it was won before (manual correction in the CRM is the source of
 * truth).
 *
 * ── Un contact, un deal (arbitrage Goran 29/09) ─────────────────────────────
 *
 * Une ligne d'opportunité est un CONTACT. Elle ne peut porter qu'un deal, donc
 * plusieurs deals visant le même contact ne tiennent pas : le plus récemment
 * modifié réclame la ligne, les autres sont comptés (`collisions`) et laissés
 * de côté. Avant ça, ils se succédaient et le dernier écrasait le montant et
 * l'étape du précédent sans écraser le dénouement · d'où des lignes
 * contradictoires en base. Le vrai remède est une ligne par deal (modèle
 * compte/deal/contact, plan du 28/09) ; en attendant, mieux vaut une ligne
 * cohérente et un compteur que trois écritures qui se contredisent.
 *
 * `crm_deal_id` et `crm_deal_attribution` (migration 123) disent de quel deal
 * vient le chiffre, et si le lien vers le contact a été affirmé par le CRM ou
 * supposé par baakalai · voir api/salesforce.js pour la règle de déduction et
 * lib/deal-attribution.js pour ce qu'un lien supposé interdit de dire.
 *
 * Best-effort: never throws · deal sync is optional on top of the contact sync.
 */

const db = require('../db');
const logger = require('./logger');
const { setPlannedFollowupDate } = require('./reactivation-queue');

async function syncDealLifecycle(userId, token, crmProvider, report = {}) {
  const result = {
    fetched: 0, processed: 0, updated: 0,
    unlinked: 0, unmatched: 0, collisions: 0, released: 0,
    // Lot 4 · ce que la table `deals` a reçu, à distinguer de ce que le miroir
    // sur `opportunities` a su représenter. Les deux nombres diffèrent, et
    // c'est exactement l'écart que le lot 4 vient combler.
    dealsWritten: 0, dealsWithoutContact: 0,
    error: null,
  };
  try {
    // Lecture du CRM isolée dans son propre catch · tout ce bloc était couvert
    // par le catch de fin, donc un connecteur qui échouait (jeton refusé,
    // endpoint changé, quota) se lisait exactement comme un CRM sans deals :
    // zéro ligne touchée, zéro trace, et personne pour faire la différence.
    // C'est ce qui a laissé 47 deals Pipedrive invisibles sans qu'aucun écran
    // ni aucun journal ne le dise.
    let deals = [];
    try {
      if (crmProvider === 'pipedrive') { const pipedrive = require('../api/pipedrive'); deals = await pipedrive.getDeals(token, 500); }
      else if (crmProvider === 'salesforce') { const sf = require('../api/salesforce'); deals = await sf.getDeals(token.instanceUrl, token.accessToken); }
      else if (crmProvider === 'hubspot') { const hs = require('../api/hubspot'); deals = await hs.getDeals(token); }
      else if (crmProvider === 'odoo') { const odooApi = require('../api/odoo'); deals = await odooApi.getDeals(token, { limit: 500 }); }
    } catch (err) {
      result.error = `getDeals: ${err.message}`;
      logger.warn('deal-lifecycle-sync', `${crmProvider} · lecture des deals refusée pour ${userId} : ${err.message}`);
    }
    result.fetched = deals.length;

    // Étapes de pipeline (migration 092) : carte id → libellé résolue une fois
    // par sync pour les providers qui ne renvoient qu'un id d'étape.
    const { getStageLabelMap, extractStage, trackStage } = require('./stage-tracking');
    const stageLabelMap = await getStageLabelMap(crmProvider, token);

    // Prefer the CRM's own close date over "now" · "now" is only a fair proxy for a
    // transition happening in this very sync, never for backfilling an older won/lost deal.
    const safeDateISO = (value) => {
      if (!value) return null;
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };

    // Un contact, un deal (arbitrage Goran 29/09).
    //
    // `opportunities` porte une ligne par CONTACT : un seul crm_deal_id, un
    // seul montant, une seule étape. Traiter à la suite plusieurs deals visant
    // le même contact laissait le dernier écraser le montant et l'étape du
    // précédent, sans jamais écraser le dénouement · d'où les lignes
    // contradictoires observées en base, statut « gagné » posé sur une étape
    // « Value Proposition » encore ouverte.
    //
    // Le deal que le CRM a touché le plus récemment réclame la ligne : c'est
    // celui sur lequel l'équipe travaille. Les autres sont comptés et laissés
    // de côté · tant que baakalai n'a pas de ligne par deal, le surplus n'est
    // pas représentable, et le compter est la seule façon honnête de le dire.
    const ordered = [...deals].sort((a, b) => {
      const ta = Date.parse(a.updatedAt || '');
      const tb = Date.parse(b.updatedAt || '');
      const sa = Number.isFinite(ta) ? ta : 0;
      const sb = Number.isFinite(tb) ? tb : 0;
      if (sa !== sb) return sb - sa;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
    // Les comptes déjà connus, indexés par leur identifiant CRM · sert au
    // repli ci-dessous. Une seule lecture par synchro.
    const { loadAccountsByCrmId, writeDeals } = require('./deals');
    const comptesParCrmId = await loadAccountsByCrmId(userId, crmProvider);

    // Ce que chaque affaire a fini par trouver comme interlocuteur · alimente
    // la table `deals` (migration 126) à la fin de la passe. AUCUNE affaire
    // n'en est écartée, pas même celles que les trois `continue` ci-dessous
    // laissent de côté : c'est tout l'objet du lot 4. Voir lib/deals.js.
    const rattachements = [];

    const claimed = new Set();
    // Lignes qu'un deal DEVINÉ vient de réclamer · toute autre ligne dont le
    // rattachement n'est pas affirmé par le CRM a donc perdu son deal (voir
    // plus bas). On retient la LIGNE et non le deal : quand la répartition se
    // décale, le même deal passe d'un contact à l'autre, et le comparer par son
    // id laisserait les deux lignes le revendiquer, donc compter son montant
    // deux fois dans les totaux et les prévisions.
    const claimedGuessed = [];

    for (const deal of ordered) {
      const personId = deal.personId ? String(deal.personId) : null;
      // Deux façons de perdre un deal, et elles n'appellent pas le même
      // remède : `unlinked` veut dire que le CRM ne nomme personne (repli de
      // rattachement à écrire pour ce provider), `unmatched` que la personne
      // est nommée mais absente de nos contacts (import incomplet). Les
      // confondre dans un `continue` muet a coûté deux enquêtes.
      //
      // Les trois sorties ci-dessous ne perdent plus l'affaire : elles la
      // laissent seulement hors du MIROIR sur `opportunities`, qui ne sait
      // représenter qu'un deal par contact. La ligne, elle, part dans `deals`
      // avec ce qu'on a su rattacher, fût-ce la seule société.
      if (!personId) {
        result.unlinked++;
        rattachements.push({ deal, contact: null });
        continue;
      }

      const opp = await db.query(
        `SELECT id, status, won_date, lost_date, deal_value, planned_followup_date, last_activity_at, crm_stage, crm_stage_id, lost_reason, crm_deal_id, crm_deal_attribution, account_id, company, account_role, role_source, close_date FROM opportunities WHERE user_id = $1 AND crm_contact_id = $2 LIMIT 1`,
        [userId, personId]
      );
      if (!opp.rows[0]) {
        result.unmatched++;
        rattachements.push({ deal, contact: null });
        continue;
      }
      const o = opp.rows[0];
      if (claimed.has(o.id)) {
        // Le contact est bien celui-ci, c'est la LIGNE d'opportunité qui est
        // déjà prise. Avant le lot 4 cette affaire était perdue ; elle a
        // désormais sa propre ligne, avec son montant et son étape à elle.
        result.collisions++;
        rattachements.push({
          deal, contact: o,
          attribution: deal.personIdInferred ? 'inferred' : 'crm_role',
        });
        continue;
      }
      claimed.add(o.id);
      if (deal.personIdInferred) claimedGuessed.push(o.id);
      result.processed++;

      const updates = {};
      if (deal.value && deal.value !== parseFloat(o.deal_value)) updates.deal_value = deal.value;

      // Traçabilité du rattachement · crm_deal_id n'était écrit que par le push
      // VERS le CRM (routes/crm.js), jamais par l'import : NULL sur 100% des
      // lignes importées, y compris celles qui portaient déjà un montant et un
      // dénouement. Sans lui, impossible de savoir de quel deal vient un
      // chiffre, ni de rendre la main quand un rattachement deviné cesse de
      // l'être.
      if (deal.id != null && String(deal.id) !== String(o.crm_deal_id || '')) {
        updates.crm_deal_id = String(deal.id);
      }
      // 'user' ne redescend jamais à 'inferred' : le user a dit que ce porteur
      // était le bon, une resynchro ne le contredit pas. Un contact role qui
      // apparaît vraiment, lui, promeut la ligne en 'crm_role'.
      // La SOCIÉTÉ portée par le deal, quand le CRM ne l'a pas mise sur la
      // personne · repli décidé avec Goran le 29/09.
      //
      // Pipedrive a deux associations distinctes : deal -> organisation et
      // personne -> organisation. Beaucoup d'équipes ne remplissent que la
      // première, parce que c'est celle qu'on voit sur le tableau des deals.
      // Le regroupement des comptes lit `company`, qui vient de la seconde :
      // sans ce repli, une base entièrement renseignée côté deals produit zéro
      // compte, ce qui est exactement ce qui s'est passé ici.
      //
      // Ce n'est pas une supposition de même nature que le porteur deviné : un
      // deal qui relie explicitement une personne ET une organisation dit bien
      // où cette personne travaille. On rattache donc au compte RÉEL par son
      // identifiant natif, sans passer par le nom.
      if (deal.accountId) {
        const compte = comptesParCrmId.get(String(deal.accountId));
        if (compte) {
          if (o.account_id !== compte.id) updates.account_id = compte.id;
          // Le nom ne s'écrase jamais · si le CRM a déjà dit où travaille
          // cette personne, c'est lui qui a raison, pas le deal.
          if (!o.company && compte.name) updates.company = compte.name;
        }
      }

      // Le rôle que le CRM déclare sur ce contact · il passe devant toute
      // déduction faite sur l'intitulé de poste, et une correction manuelle
      // ('user') ne se fait jamais écraser par lui (lot 3, migration 125).
      if (deal.personRole && o.role_source !== 'user') {
        const { roleFromCrm } = require('./contact-role');
        const role = roleFromCrm(deal.personRole);
        if (role && (o.account_role !== role || o.role_source !== 'crm')) {
          updates.account_role = role;
          updates.role_source = 'crm';
        }
      }

      const attribution = deal.personIdInferred ? 'inferred' : 'crm_role';
      if (o.crm_deal_attribution !== attribution
          && !(o.crm_deal_attribution === 'user' && attribution === 'inferred')) {
        updates.crm_deal_attribution = attribution;
      }

      const closeDate = safeDateISO(deal.closeDate);
      // La date de clôture PRÉVUE, qui n'avait jusqu'ici aucune colonne où
      // atterrir (migration 126). Salesforce et HubSpot la remontaient depuis
      // toujours et elle était jetée · pendant ce temps
      // routes/analytics.js:1193 lisait `o.close_date`, inexistante, donc
      // l'export renouvellement retombait systématiquement sur won_date + 365
      // jours. Le seul fait de la renseigner rend cette branche vivante.
      if (closeDate && closeDate !== o.close_date) updates.close_date = closeDate;
      if (deal.status === 'won' && o.status !== 'won') {
        updates.status = 'won';
        updates.won_date = closeDate || new Date().toISOString();
      } else if (deal.status === 'won' && o.status === 'won' && !o.won_date && closeDate) {
        // Backfill: already won locally, just never got a real close date recorded.
        updates.won_date = closeDate;
      }
      if (deal.status === 'lost' && o.status !== 'lost') {
        updates.status = 'lost';
        updates.lost_date = closeDate || new Date().toISOString();
      } else if (deal.status === 'lost' && o.status === 'lost' && !o.lost_date && closeDate) {
        updates.lost_date = closeDate;
      }
      // Rapatrie la raison de perte native (Pipedrive) · jamais si une valeur
      // existe déjà (CRM ou saisie manuelle), pour ne jamais écraser une
      // correction humaine par une resynchro.
      if (deal.lostReason && !o.lost_reason) {
        updates.lost_reason = deal.lostReason;
        updates.lost_reason_source = 'crm';
      }
      // The CRM's native "next activity" date feeds planned_followup_date · it wins over
      // whatever Baakalai had planned (a rep changing the date in the CRM is the source of
      // truth), but never overwrites a manually-set date with null. Routed through
      // setPlannedFollowupDate (not batched into `updates`) so the change lands in
      // followup_date_history with the previous value, not just silently overwritten.
      if (deal.nextActivityDate && deal.nextActivityDate !== o.planned_followup_date) {
        await setPlannedFollowupDate(userId, o.id, deal.nextActivityDate, { source: 'crm_sync', reason: 'crm_sync' });
      }
      // The CRM's own "last modified" timestamp is the real activity signal · `updated_at`
      // gets reset to now() by a DB trigger on every internal write (e.g. churn scoring),
      // so it can't be trusted for staleness. Only advance last_activity_at forward, never back.
      if (deal.updatedAt) {
        const crmUpdated = new Date(deal.updatedAt);
        const stored = o.last_activity_at ? new Date(o.last_activity_at) : null;
        if (!isNaN(crmUpdated.getTime()) && (!stored || crmUpdated > stored)) {
          updates.last_activity_at = crmUpdated.toISOString();
        }
      }

      // Étape de pipeline réelle : transition historisée quand l'id change,
      // simple rafraîchissement de libellé sinon (renommage côté CRM).
      try {
        const stageUpdates = await trackStage(
          userId, o, extractStage(crmProvider, deal, stageLabelMap),
          { status: deal.status, source: 'delta_sync' }
        );
        Object.assign(updates, stageUpdates);
      } catch { /* stage tracking best-effort */ }

      if (Object.keys(updates).length > 0) {
        // Attribution: if deal moves to 'won' from lost/stagnant, check for reactivation email in last 90 days
        if (updates.status === 'won' && ['lost', 'stagnant', 'imported', 'new'].includes(o.status)) {
          const reactivationEmail = await db.query(
            `SELECT id, pattern_ids FROM nurture_emails
             WHERE opportunity_id = $1 AND user_id = $2 AND status = 'sent'
               AND metadata->>'chain' = 'deal_reactivation'
               AND created_at > NOW() - INTERVAL '90 days'
             ORDER BY created_at DESC LIMIT 1`,
            [o.id, userId]
          );
          if (reactivationEmail.rows[0]) {
            updates.reactivated_at = new Date().toISOString();
            updates.reactivated_from_email_id = reactivationEmail.rows[0].id;
            report.reactivations = (report.reactivations || 0) + 1;
            logger.info('deal-lifecycle-sync', `Deal reactivated: ${o.id} (email ${reactivationEmail.rows[0].id})`);

            // Renforcement de la boucle d'apprentissage : deal mort → gagné
            // avec email causal identifié, c'est LE signal le plus fort du
            // produit. Les patterns utilisés pour rédiger cet email gagnent
            // une confirmation. Best-effort : ne doit jamais faire échouer
            // le sync.
            const causalPatternIds = reactivationEmail.rows[0].pattern_ids || [];
            if (causalPatternIds.length > 0) {
              try {
                await db.query(
                  `UPDATE memory_patterns
                   SET confirmations = COALESCE(confirmations, 0) + 1, last_confirmed_at = now()
                   WHERE id = ANY($1)`,
                  [causalPatternIds]
                );
                logger.info('deal-lifecycle-sync', `Reactivation win: +1 confirmation on ${causalPatternIds.length} pattern(s)`);
              } catch (err) {
                logger.warn('deal-lifecycle-sync', `Pattern reinforcement failed: ${err.message}`);
              }
            }
          }
        }
        await db.opportunities.update(o.id, updates);
        result.updated++;
      }

      rattachements.push({ deal, contact: o, attribution });
    }

    // ── La table `deals`, écrite en parallèle du miroir ci-dessus ───────────
    //
    // Une ligne par affaire, y compris pour les trois cas que le miroir ne
    // sait pas représenter : deal sans interlocuteur nommé, interlocuteur
    // inconnu de nos contacts, et deuxième deal sur un contact déjà pris.
    // C'est la raison d'être du lot 4.
    //
    // Personne ne LIT encore cette table : `opportunities` reste la source de
    // vérité de tous les écrans jusqu'au lot 5. Si les deux divergent
    // aujourd'hui, c'est `opportunities` qui fait foi. Best-effort, comme le
    // reste : une affaire qui refuse d'entrer ne fait pas échouer la synchro.
    const ecriture = await writeDeals(userId, crmProvider, rattachements);
    result.dealsWritten = ecriture.ecrits;
    result.dealsWithoutContact = ecriture.sansContact;
    if (ecriture.erreur) result.error = result.error || `deals: ${ecriture.erreur}`;

    // Rendre la main sur les rattachements devinés qui ne le sont plus.
    //
    // Un deal deviné sur le contact A, puis rattaché ailleurs (le CRM a rempli
    // son contact role, ou la répartition s'est décalée), laisserait A avec un
    // montant, une étape et un dénouement qui ne lui appartiennent pas · pour
    // toujours, puisque rien ne repasse dessus. On efface donc ce que le deal
    // avait posé sur A. Le statut ne peut être remis qu'à 'imported' : 'gagné'
    // et 'perdu' ne pouvaient venir que du deal, alors qu'un statut ouvert
    // vient du mappage d'étapes, qui le recalculera juste après (voir l'ordre
    // des appels dans lib/crm-agent.js et lib/crm-sync.js).
    //
    // 'user' est concerné autant que 'inferred' : une ligne confirmée à la main
    // reste une ligne dont le CRM n'a jamais nommé l'interlocuteur. Ce que le
    // user a confirmé, c'est CE deal sur CE contact · le deal parti ailleurs,
    // il n'y a plus rien à confirmer, et le garder compterait son montant deux
    // fois. Un rattachement 'crm_role' n'est jamais touché ici : le CRM en est
    // la source, il n'a pas à être libéré.
    //
    // Conditionné à `deals.length` : un appel CRM qui échoue en renvoyant une
    // liste vide ne doit pas se lire comme « plus aucun deal deviné ». La même
    // prudence ne couvre pas une lecture TRONQUÉE (plafond de getDeals) : un
    // rattachement deviné au-delà du plafond serait libéré à tort, puis rendu
    // à la passe suivante.
    if (deals.length > 0) {
      const released = await db.query(
        `UPDATE opportunities
            SET crm_deal_id = NULL, crm_deal_attribution = NULL, deal_value = NULL,
                crm_stage = NULL, crm_stage_id = NULL, crm_stage_changed_at = NULL,
                won_date = NULL, lost_date = NULL,
                status = CASE WHEN status IN ('won', 'lost') THEN 'imported' ELSE status END,
                updated_at = now()
          WHERE user_id = $1 AND crm_provider = $2
            AND crm_deal_attribution IN ('inferred', 'user')
            AND NOT (id = ANY($3))`,
        [userId, crmProvider, claimedGuessed]
      );
      result.released = released.rowCount || 0;
      if (result.released > 0) {
        logger.info('deal-lifecycle-sync',
          `${result.released} rattachement(s) deviné(s) rendu(s) pour ${userId} · le CRM nomme désormais un autre contact`);
      }
    }

    if (result.collisions > 0) {
      logger.info('deal-lifecycle-sync',
        `${result.collisions} deal(s) non représentable(s) dans le miroir pour ${userId} · plusieurs deals sur un même contact, un seul tient dans la ligne d'opportunité. Ils ont bien leur ligne dans \`deals\` (lot 4)`);
    }
  } catch (err) {
    // Avant l'extraction ce catch était muet · c'est précisément ce qui rendait
    // les échecs de mapping won/lost invisibles. On trace, sans faire échouer.
    result.error = result.error || err.message;
    logger.warn('deal-lifecycle-sync', `${crmProvider} deal sync failed for user ${userId}: ${err.message}`);
  }

  // Le résultat part en base, pas seulement dans les journaux · un sync de
  // deals qui ne rattache rien est indiscernable d'un CRM sans deals tant que
  // personne ne peut lire, après coup, combien le connecteur en a vus. C'est
  // ce qui manquait pour comprendre les 47 deals Pipedrive invisibles.
  // Best-effort : track() ne lève jamais.
  try {
    const { track } = require('./track');
    await track(userId, 'deal_sync_done', {
      provider: crmProvider,
      fetched: result.fetched,
      attached: result.processed,
      updated: result.updated,
      unlinked: result.unlinked,
      unmatched: result.unmatched,
      collisions: result.collisions,
      released: result.released,
      dealsWritten: result.dealsWritten,
      dealsWithoutContact: result.dealsWithoutContact,
      error: result.error,
    });
  } catch { /* l'instrumentation ne doit jamais peser sur la synchro */ }

  logger.info('deal-lifecycle-sync',
    `${crmProvider} · ${result.fetched} deal(s) lus, ${result.processed} rattaché(s), ` +
    `${result.unlinked} sans personne, ${result.unmatched} sans contact connu · ` +
    `${result.dealsWritten} affaire(s) en base, dont ${result.dealsWithoutContact} sans interlocuteur` +
    (result.error ? ` · ERREUR ${result.error}` : ''));

  return result;
}

module.exports = { syncDealLifecycle };
