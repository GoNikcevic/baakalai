/**
 * Ce qu'il faut faire APRÈS avoir importé des contacts : les comptes, puis les
 * deals, puis les étapes.
 *
 * Importer des contacts ne suffit pas. Sans cette passe, une ligne
 * d'opportunité reste sur 'imported' pour toujours : pas de société, pas de
 * montant, pas d'étape, pas de gagné, pas de perdu, et le mappage de pipeline
 * n'a rien à quoi s'appliquer.
 *
 * ── Pourquoi ce module existe ───────────────────────────────────────────────
 *
 * Le produit a TROIS chemins qui importent des contacts, et un seul faisait ce
 * travail :
 *
 *   lib/crm-sync.js           · « Analyser le CRM » depuis les Réglages ·  OUI
 *   lib/crm-agent.js          · le cron de 9h                            ·  OUI
 *   routes/crm.js /import/:p  · « Actualiser » sur Deals, le wizard,
 *                               les raccourcis du chat                   ·  NON
 *
 * Le troisième est celui que l'utilisateur déclenche le plus souvent, et c'est
 * précisément celui qui ne lisait jamais les deals. Mesuré le 29/09 : 443
 * lignes sur 443 en production avec `crm_deal_id` à NULL, tous CRM confondus,
 * et 47 deals Pipedrive parfaitement visibles dans le CRM mais absents de
 * baakalai. Ce n'était pas un défaut de connecteur, c'était un appel manquant.
 *
 * Le bloc vivait en double dans crm-sync.js et crm-agent.js. Le mettre ici est
 * ce qui garantit qu'un quatrième chemin d'import ne réintroduira pas le même
 * trou.
 *
 * ── L'ordre n'est pas négociable ────────────────────────────────────────────
 *
 * Le cycle de vie AVANT le mappage d'étapes. Le premier tranche gagné et perdu
 * sur les drapeaux natifs du deal ; le second ne réécrit que les statuts
 * ouverts. Dans cet ordre, un deal conclu ne repasse jamais par « négociation »
 * le temps d'une synchro.
 *
 * Best-effort de bout en bout : compléter des contacts est utile même quand le
 * CRM refuse de rendre ses deals. Un échec ici ne fait jamais échouer l'import.
 */

const logger = require('./logger');

/** CRM dont les deals et les étapes sont des notions structurées. */
const WITH_DEALS = ['salesforce', 'hubspot', 'pipedrive', 'odoo'];

/**
 * @param {string} userId
 * @param {string} provider · le CRM qui vient d'être importé
 * @param {object} [opts]
 * @param {object} [opts.creds] · évite un second resolveCrmForUser quand l'appelant les a déjà
 * @param {object} [opts.report] · rapport de l'agent, enrichi des réactivations attribuées
 * @returns {Promise<{ran, lifecycle, stages, mapped, repositioned, error}>}
 */
async function refreshDealsAndStages(userId, provider, opts = {}) {
  // `stages` compte ce que le CRM expose, `mapped` ce que baakalai a su ranger :
  // deux nombres différents, et les confondre ferait dire « 16 étapes comprises »
  // à un pipeline dont la moitié est restée sans traduction.
  const out = {
    ran: false, lifecycle: null, crmAccounts: null, accounts: null,
    stages: 0, mapped: 0, repositioned: 0, error: null,
  };

  // Les identifiants EN PREMIER · deux des trois chemins d'import ne les
  // passent pas, et les résoudre plus bas priverait ces deux-là de la lecture
  // des vraies sociétés. Un utilisateur peut avoir plusieurs CRM connectés :
  // on n'agit que si le résolveur parle bien de celui qu'on vient d'importer,
  // sinon on lirait les deals d'un CRM avec les identifiants d'un autre.
  let creds = opts.creds || null;
  if (!creds && WITH_DEALS.includes(provider)) {
    try {
      const { resolveCrmForUser } = require('./crm-token');
      const resolved = await resolveCrmForUser(userId);
      if (resolved.provider !== provider || !resolved.creds) {
        out.error = `creds indisponibles pour ${provider} (résolu : ${resolved.provider || 'aucun'})`;
        logger.warn('crm-deal-refresh', `${provider} · ${out.error} pour ${userId}`);
      } else {
        creds = resolved.creds;
      }
    } catch (err) {
      out.error = err.message;
    }
  }

  // 1. Les VRAIES sociétés du CRM · elles portent l'identifiant natif, la date
  // de création et le secteur. En premier, parce que la synchro des deals a
  // besoin qu'elles existent pour y rattacher un contact par cet identifiant.
  try {
    const { importCrmAccounts } = require('./accounts');
    if (creds) out.crmAccounts = await importCrmAccounts(userId, provider, creds);
  } catch (err) {
    out.accountsError = err.message;
    logger.warn('crm-deal-refresh', `sociétés non lues pour ${userId} : ${err.message}`);
  }

  // 2. Les DEALS · ils posent montants, dénouements, étapes, et rattachent au
  // passage les contacts dont seul le deal connaît la société.
  const avecDeals = WITH_DEALS.includes(provider) && !!creds;
  if (avecDeals) {
    try {
      const { syncDealLifecycle } = require('./deal-lifecycle-sync');
      // `report` suit jusqu'au bout : c'est lui qui recueille les réactivations
      // attribuées à un email, le signal d'apprentissage le plus fort du produit.
      out.lifecycle = await syncDealLifecycle(userId, creds, provider, opts.report || {});
      out.ran = true;
    } catch (err) {
      out.error = out.error || err.message;
      logger.warn('crm-deal-refresh', `${provider} deals échoués pour ${userId} : ${err.message}`);
    }
  }

  // 3. Le REGROUPEMENT par société, APRÈS les deals et non avant · c'est la
  // synchro des deals qui renseigne la société des contacts que seul le deal
  // rattache à une organisation. Placé avant, ce regroupement travaillait sur
  // un monde encore sans sociétés et annonçait « 169 sans société » alors que
  // 26 venaient d'en recevoir une. Il fallait un second passage pour rattraper.
  //
  // Hors du `if` ci-dessus : Notion, Airtable et Folk n'ont ni deal ni étape,
  // mais ont bien des sociétés, et les en priver réserverait le modèle de
  // comptes aux quatre CRM structurés.
  try {
    const { syncAccountsForUser, syncContactRoles } = require('./accounts');
    out.accounts = await syncAccountsForUser(userId, { provider });
    // Les RÔLES en dernier · élire l'interlocuteur principal d'un compte
    // suppose que le compte existe et que ses contacts y soient rattachés.
    out.roles = await syncContactRoles(userId, { provider });
  } catch (err) {
    out.accountsError = out.accountsError || err.message;
    logger.warn('crm-deal-refresh', `comptes non reconstruits pour ${userId} : ${err.message}`);
  }

  // Les comptes aussi partent en base, pas seulement dans les journaux · la
  // leçon du même jour, apprise sur les deals : un chiffre qu'on ne peut pas
  // relire après coup ne permet pas de distinguer « rien à faire » de « ça a
  // échoué ». Sans cet événement, zéro compte créé se lit exactement pareil
  // que du code non déployé.
  try {
    const { track } = require('./track');
    await track(userId, 'accounts_sync_done', {
      provider,
      credsPresent: !!creds,
      societesLues: out.crmAccounts?.fetched ?? null,
      societesEnregistrees: out.crmAccounts?.upserted ?? null,
      derivesAbsorbes: out.crmAccounts?.absorbed ?? null,
      erreurLecture: out.crmAccounts?.error ?? null,
      comptes: out.accounts?.accounts ?? null,
      crees: out.accounts?.created ?? null,
      contactsRattaches: out.accounts?.linked ?? null,
      sansSociete: out.accounts?.skipped ?? null,
      erreur: out.accountsError || null,
    });
  } catch { /* l'instrumentation ne doit jamais peser sur la synchro */ }

  if (!avecDeals) return out;

  // 4. Le MAPPAGE d'étapes, en dernier · le cycle de vie tranche gagné et
  // perdu sur les drapeaux natifs, celui-ci ne réécrit que les statuts
  // ouverts. Dans cet ordre, un deal conclu ne repasse jamais par
  // « négociation » le temps d'une synchro.
  try {
    const { analyzeStageArchitecture, applyStageMapping } = require('./crm-stage-mapper');
    const arch = await analyzeStageArchitecture(userId, { provider, creds });
    const applied = await applyStageMapping(userId, provider);
    out.stages = arch.stages || 0;
    out.mapped = (arch.byRule || 0) + (arch.byAi || 0);
    out.repositioned = applied.updated || 0;

    logger.info('crm-deal-refresh',
      `${provider} · ${out.lifecycle?.updated ?? 0}/${out.lifecycle?.processed ?? 0} opportunité(s) mise(s) à jour, ` +
      `${out.stages} étape(s) lue(s), ${out.repositioned} repositionnée(s)`);
  } catch (err) {
    out.error = err.message;
    logger.warn('crm-deal-refresh', `${provider} échoué pour ${userId} : ${err.message}`);
  }
  return out;
}

module.exports = { WITH_DEALS, refreshDealsAndStages };
