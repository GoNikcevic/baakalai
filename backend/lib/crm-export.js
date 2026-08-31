/**
 * Écriture Baakalai → CRM
 *
 * Repousse vers le CRM ce que Baakalai a calculé (risque de churn et ses
 * facteurs, stagnation, score de lead) sous forme de note attachée au contact
 * existant.
 *
 * ─── Ce que cette version corrige ───
 *
 * L'implémentation précédente CRÉAIT un contact (`POST /persons`,
 * `POST /crm/v3/objects/contacts`, `POST /sobjects/Contact`) au lieu de mettre
 * à jour celui dont on vient. Or nos opportunités sont importées DEPUIS le CRM
 * et portent déjà `crm_contact_id` : exporter dupliquait donc chaque contact
 * dans la base du client. Pour un produit dont l'un des quatre métiers est de
 * détecter et fusionner les doublons, c'était intenable. On ancre désormais
 * toute écriture sur `crm_contact_id`, et un contact sans cet identifiant est
 * ignoré — il n'existe pas côté CRM, il n'y a rien à y mettre à jour.
 *
 * Elle poussait aussi des propriétés personnalisées (`bakal_score`,
 * `bakal_status` chez HubSpot) qui n'existent dans aucun compte client : ces
 * appels échouaient en 400. On écrit maintenant une NOTE, seul mécanisme
 * disponible chez les cinq providers sans configuration préalable et sans
 * toucher au modèle de données du client.
 *
 * Enfin elle parcourait hubspot → salesforce → pipedrive dans un ordre codé en
 * dur et prenait le premier connecté, en ignorant `users.active_crm_provider` —
 * contraire à la règle 2 du CLAUDE.md. Sur un compte à plusieurs CRM connectés,
 * l'export partait vers le mauvais.
 */

const db = require('../db');
const logger = require('./logger');
const { getUserCrmToken } = require('./crm-token');

// Providers sachant écrire une note sur un contact existant. Notion et Airtable
// en sont absents volontairement : leurs connecteurs sont en création seule
// (voir api/notion-crm.js, api/airtable-crm.js), il n'existe aucune primitive
// de mise à jour à appeler.
const WRITABLE_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'folk'];

/**
 * Résout le CRM cible.
 *
 * Règle : quand l'utilisateur a désigné un CRM actif, c'est celui-là ou rien.
 * Pas de repli silencieux vers un autre — même si un autre est connecté et
 * saurait écrire. Écrire dans un CRM que l'utilisateur n'a pas désigné, c'est
 * déposer des notes dans une base qu'il ne regarde pas, et c'est le défaut de
 * l'implémentation précédente (parcours hubspot → salesforce → pipedrive codé
 * en dur, premier connecté gagnant).
 *
 * Cas réel rencontré : un compte dont le CRM actif est Notion (connecteur en
 * création seule) mais qui a aussi Pipedrive, HubSpot et Salesforce connectés.
 * Le repli y aurait écrit dans Pipedrive alors que toutes ses données viennent
 * de Notion. On renvoie plutôt un motif explicite, remonté à l'appelant.
 *
 * L'ordre de WRITABLE_PROVIDERS ne sert que lorsque aucun CRM actif n'est
 * défini — un compte en cours d'onboarding, typiquement.
 */
async function resolveTargetCrm(userId) {
  const row = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [userId]);
  const active = row.rows[0]?.active_crm_provider;

  if (active) {
    if (!WRITABLE_PROVIDERS.includes(active)) {
      return { provider: null, reason: 'active_crm_not_writable', activeCrm: active };
    }
    const creds = await getUserCrmToken(userId, active);
    if (!creds) return { provider: null, reason: 'active_crm_not_connected', activeCrm: active };
    return { provider: active, creds };
  }

  for (const provider of WRITABLE_PROVIDERS) {
    const creds = await getUserCrmToken(userId, provider);
    if (creds) return { provider, creds };
  }
  return { provider: null, reason: 'no_crm_connected' };
}

/**
 * Contenu de la note, et son empreinte.
 *
 * L'empreinte gouverne la ré-écriture : tant qu'elle ne change pas, on ne
 * réécrit pas. Un score stable ne produit donc aucune écriture, quel que soit
 * le temps écoulé — c'est ce qui empêche la note quotidienne en double.
 *
 * Le score est toujours accompagné de ses facteurs : un score nu (« 72/100 »)
 * n'apprend rien au commercial qui le lit dans son CRM et ne déclenche aucune
 * action. C'est la seule forme qui justifie d'écrire chez le client.
 */
function buildInsight(opp) {
  const lines = [];
  const parts = [];

  if (opp.churn_score != null && opp.status === 'won') {
    const band = opp.churn_score >= 76 ? 'critique'
      : opp.churn_score >= 51 ? 'élevé'
      : opp.churn_score >= 26 ? 'moyen' : 'faible';
    lines.push(`Risque de churn : ${opp.churn_score}/100 (${band})`);
    parts.push(`churn:${opp.churn_score}`);

    let factors = opp.churn_factors;
    if (typeof factors === 'string') { try { factors = JSON.parse(factors); } catch { factors = null; } }
    if (Array.isArray(factors) && factors.length) {
      const top = factors.slice(0, 4).map(f => `${f.signal} (${f.weight > 0 ? '+' : ''}${f.weight})${f.detail ? ` — ${f.detail}` : ''}`);
      lines.push('Facteurs : ' + top.join(' · '));
      parts.push('f:' + factors.slice(0, 4).map(f => f.signal).join(','));
    }
  }

  const lastActivity = opp.last_activity_at || opp.created_at;
  if (lastActivity && !['won', 'lost'].includes(opp.status)) {
    const days = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000);
    if (days >= 14) {
      lines.push(`Sans activité depuis ${days} jours — deal candidat à une relance.`);
      // Tranche de 7 jours dans l'empreinte : sinon le compteur de jours change
      // chaque nuit et réécrit une note quotidienne, exactement le défaut qu'on
      // vient de supprimer.
      parts.push(`stale:${Math.floor(days / 7)}`);
    }
  }

  if (opp.score != null) {
    lines.push(`Score de lead : ${opp.score}/100`);
    parts.push(`lead:${opp.score}`);
  }

  if (!lines.length) return null;
  return {
    content: 'baakalai — analyse CRM\n' + lines.join('\n'),
    fingerprint: parts.join('|'),
  };
}

/** Écrit une note sur le contact existant, selon le provider. */
async function writeNote(provider, creds, userId, opp, content) {
  switch (provider) {
    case 'pipedrive':
      return require('../api/pipedrive').createNote(creds, {
        personId: parseInt(opp.crm_contact_id, 10),
        content: content.replace(/\n/g, '<br>'),
      });
    case 'hubspot':
      return require('../api/hubspot').createNote(creds, content, { contactId: opp.crm_contact_id });
    case 'salesforce': {
      const integration = await db.userIntegrations.get(userId, 'salesforce');
      if (!integration?.instance_url) throw new Error('Salesforce instance URL manquante — reconnecter Salesforce');
      return require('../api/salesforce').createNote(integration.instance_url, creds, {
        parentId: opp.crm_contact_id,
        title: 'baakalai — analyse CRM',
        body: content,
      });
    }
    case 'odoo':
      // res_id attend un entier côté Odoo ; crm_contact_id est stocké en texte.
      return require('../api/odoo').createNote(creds, {
        contactId: parseInt(opp.crm_contact_id, 10),
        content,
      });
    case 'folk':
      // api/folk.js attend `personId` — pas `contactId`, qui serait ignoré et
      // produirait une note flottante, rattachée à personne.
      return require('../api/folk').createNote(creds, {
        personId: opp.crm_contact_id,
        content,
      });
    default:
      throw new Error(`Écriture non supportée pour ${provider}`);
  }
}

/**
 * Pousse les analyses Baakalai vers le CRM actif de l'utilisateur.
 *
 * @param {string} userId
 * @param {Array}  opportunities  contacts à considérer
 * @param {{dryRun?: boolean}} options  dryRun : calcule tout, n'écrit rien —
 *        à utiliser pour vérifier ce qui partirait avant d'écrire chez un client.
 */
async function exportScoresToCRM(userId, opportunities, { dryRun = false } = {}) {
  const { provider, creds, reason, activeCrm } = await resolveTargetCrm(userId);
  if (!provider) {
    const messages = {
      active_crm_not_writable: `Le CRM actif (${activeCrm}) ne permet pas l'écriture — connecteur en création seule. Providers supportés : ${WRITABLE_PROVIDERS.join(', ')}.`,
      active_crm_not_connected: `Le CRM actif (${activeCrm}) n'est pas connecté.`,
      no_crm_connected: 'Aucun CRM inscriptible connecté.',
    };
    throw Object.assign(new Error(messages[reason] || 'CRM cible indéterminé'), { code: reason });
  }

  const report = { provider, dryRun, pushed: 0, skipped: 0, unchanged: 0, errors: [], reasons: {} };
  const skip = (reason) => {
    report.skipped++;
    report.reasons[reason] = (report.reasons[reason] || 0) + 1;
  };

  for (const opp of opportunities) {
    // Un contact sans identifiant CRM n'existe pas côté CRM : rien à mettre à
    // jour, et surtout pas de création — c'est ce qui dupliquait la base.
    if (!opp.crm_contact_id) { skip('no_crm_id'); continue; }
    // Ne jamais écrire dans un CRM dont ce contact ne provient pas.
    if (opp.crm_provider && opp.crm_provider !== provider) { skip('other_provider'); continue; }

    const insight = buildInsight(opp);
    if (!insight) { skip('nothing_to_say'); continue; }

    let state = opp.crm_push_state || {};
    if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = {}; } }
    if (state.insight?.fingerprint === insight.fingerprint) { report.unchanged++; continue; }

    if (dryRun) { report.pushed++; continue; }

    try {
      await writeNote(provider, creds, userId, opp, insight.content);
      await db.query(
        `UPDATE opportunities
            SET crm_push_state = COALESCE(crm_push_state, '{}'::jsonb)
                                 || jsonb_build_object('insight', jsonb_build_object('fingerprint', $1::text, 'at', now()))
          WHERE id = $2`,
        [insight.fingerprint, opp.id]
      );
      report.pushed++;
    } catch (err) {
      report.errors.push(`${opp.name || opp.id}: ${err.message}`);
    }
  }

  const reasons = Object.entries(report.reasons).map(([r, n]) => `${r}:${n}`).join(' ');
  logger.info('crm-export', `${provider}${dryRun ? ' (dry-run)' : ''} user=${userId} écrits=${report.pushed} inchangés=${report.unchanged} ignorés=${report.skipped}${reasons ? ` (${reasons})` : ''} erreurs=${report.errors.length}`);
  return report;
}

async function exportScoresToCSV(opportunities) {
  const headers = ['Nom', 'Titre', 'Entreprise', 'Statut', 'Score lead', 'Score churn', 'Dernière activité'];
  const rows = opportunities.map(o => [
    o.name || '',
    o.title || '',
    o.company || '',
    o.status || '',
    o.score ?? '',
    o.churn_score ?? '',
    o.last_activity_at ? new Date(o.last_activity_at).toISOString().slice(0, 10) : '',
  ]);

  return [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
}

module.exports = { exportScoresToCRM, exportScoresToCSV, resolveTargetCrm, buildInsight, WRITABLE_PROVIDERS };
