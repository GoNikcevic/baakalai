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
  const out = { ran: false, lifecycle: null, accounts: null, stages: 0, mapped: 0, repositioned: 0, error: null };

  // Les COMPTES d'abord, et pour TOUS les providers · y compris Notion,
  // Airtable et Folk, qui n'ont ni deal ni étape mais ont bien des sociétés.
  // Avant le `return` ci-dessous, donc, sinon la moitié des CRM n'aurait
  // jamais de comptes. Reconstruit depuis opportunities.company, voir
  // lib/accounts.js pour pourquoi ce n'est pas fait dans les connecteurs.
  try {
    const { syncAccountsForUser } = require('./accounts');
    out.accounts = await syncAccountsForUser(userId, { provider });
  } catch (err) {
    logger.warn('crm-deal-refresh', `comptes non reconstruits pour ${userId} : ${err.message}`);
  }

  if (!WITH_DEALS.includes(provider)) return out;

  try {
    let creds = opts.creds;
    if (!creds) {
      const { resolveCrmForUser } = require('./crm-token');
      const resolved = await resolveCrmForUser(userId);
      // Un utilisateur peut avoir plusieurs CRM connectés · n'agir que si le
      // résolveur parle bien de celui qu'on vient d'importer, sinon on lirait
      // les deals d'un autre CRM avec les mauvais identifiants de contact.
      if (resolved.provider !== provider || !resolved.creds) {
        out.error = `creds indisponibles pour ${provider} (résolu : ${resolved.provider || 'aucun'})`;
        logger.warn('crm-deal-refresh', `${provider} · ${out.error} pour ${userId}`);
        return out;
      }
      creds = resolved.creds;
    }

    const { syncDealLifecycle } = require('./deal-lifecycle-sync');
    // `report` suit jusqu'au bout : c'est lui qui recueille les réactivations
    // attribuées à un email, le signal d'apprentissage le plus fort du produit.
    out.lifecycle = await syncDealLifecycle(userId, creds, provider, opts.report || {});
    out.ran = true;

    const { analyzeStageArchitecture, applyStageMapping } = require('./crm-stage-mapper');
    const arch = await analyzeStageArchitecture(userId, { provider, creds });
    const applied = await applyStageMapping(userId, provider);
    out.stages = arch.stages || 0;
    out.mapped = (arch.byRule || 0) + (arch.byAi || 0);
    out.repositioned = applied.updated || 0;

    logger.info('crm-deal-refresh',
      `${provider} · ${out.lifecycle.updated}/${out.lifecycle.processed} opportunité(s) mise(s) à jour, ` +
      `${out.stages} étape(s) lue(s), ${out.repositioned} repositionnée(s)`);
  } catch (err) {
    out.error = err.message;
    logger.warn('crm-deal-refresh', `${provider} échoué pour ${userId} : ${err.message}`);
  }
  return out;
}

module.exports = { WITH_DEALS, refreshDealsAndStages };
