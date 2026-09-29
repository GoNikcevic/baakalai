/* ===============================================================================
   BAKAL · État de santé d'une connexion CRM
   ---------------------------------------------------------------------------
   « Connecté » a longtemps voulu dire « on a un token en base qui se
   déchiffre ». C'est une vérification locale : elle ne prouve que la lisibilité
   du token, jamais sa validité. Un refresh token révoqué laissait donc l'écran
   au vert pendant que la synchro échouait en silence.

   Ce module tient le seul signal qui ne mente pas : le refus du CRM lui-même.
   On ne marque JAMAIS une connexion invalide sur un problème de notre côté
   (clé applicative absente, refresh token jamais stocké) · demander un nouvel
   OAuth ne réparerait rien et rendrait l'alerte inutile à force de fausses
   demandes. Voir la migration 122.
   =============================================================================== */

const db = require('../db');
const { decrypt } = require('../config/crypto');

const STATE_ABSENT = 'absent';
const STATE_CONNECTED = 'connected';
const STATE_NEEDS_RECONNECT = 'needs_reconnect';

const PROVIDER_LABELS = {
  salesforce: 'Salesforce', hubspot: 'HubSpot', pipedrive: 'Pipedrive',
  odoo: 'Odoo', folk: 'Folk', notion: 'Notion', airtable: 'Airtable',
};

/**
 * Le CRM a refusé le refresh token : seul un nouvel OAuth répare.
 *
 * Le WHERE ... invalid_since IS NULL fait deux choses d'un coup. Il garde la
 * date du PREMIER refus, pour pouvoir dire « arrêtée depuis le 24 septembre »
 * plutôt que « depuis la dernière tentative », qui ne veut rien dire. Et il
 * rend la notification unique : une synchro qui réessaie toutes les heures ne
 * doit pas produire une alerte par heure.
 */
async function markInvalid(userId, provider, reason = 'refresh_rejected') {
  try {
    const res = await db.query(
      `UPDATE user_integrations
          SET invalid_since = now(),
              invalid_reason = $3
        WHERE user_id = $1 AND provider = $2 AND invalid_since IS NULL
        RETURNING id`,
      [userId, provider, reason]
    );
    if (res.rowCount === 0) return; // déjà signalée, on ne réalerte pas

    const label = PROVIDER_LABELS[provider] || provider;
    const { createNotification } = require('./notify');
    await createNotification(userId, {
      type: 'crm_connection_lost',
      title: `${label} disconnected`,
      body: `${label} refused the stored credentials, so syncing has stopped. Reconnect it in Settings to resume.`,
      metadata: { provider, reason },
    });
  } catch {
    // Marquer l'état ne doit jamais faire échouer l'appel qui l'a découvert.
  }
}

/**
 * Le CRM vient d'honorer un échange de token : la connexion est vivante.
 */
async function markValid(userId, provider) {
  try {
    await db.query(
      `UPDATE user_integrations
          SET invalid_since = NULL,
              invalid_reason = NULL,
              last_verified_at = now()
        WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
  } catch {
    /* idem */
  }
}

/**
 * État lisible d'une ligne user_integrations.
 *
 * Un token illisible reste « absent » et non « à reconnecter » : c'est le choix
 * déjà fait par getValidatedIntegrations (config/index.js), qui écarte
 * volontairement les lignes semées à la main en base. Le changer ici ferait
 * apparaître des invitations à reconnecter sur des données de test.
 *
 * @param {object|null} row ligne user_integrations, ou null
 * @returns {'absent'|'connected'|'needs_reconnect'}
 */
function connectionState(row) {
  if (!row?.access_token) return STATE_ABSENT;
  try {
    if (!decrypt(row.access_token)) return STATE_ABSENT;
  } catch {
    return STATE_ABSENT;
  }
  return row.invalid_since ? STATE_NEEDS_RECONNECT : STATE_CONNECTED;
}

/**
 * États de plusieurs providers d'un coup, pour les écrans qui listent les
 * connexions sans vouloir faire une requête par ligne.
 * @returns {Promise<Record<string, {state: string, invalidSince: string|null, invalidReason: string|null, lastVerifiedAt: string|null}>>}
 */
async function getConnectionStates(userId, providers) {
  const out = {};
  for (const p of providers) out[p] = { state: STATE_ABSENT, invalidSince: null, invalidReason: null, lastVerifiedAt: null };

  const result = await db.query(
    `SELECT provider, access_token, invalid_since, invalid_reason, last_verified_at
       FROM user_integrations
      WHERE user_id = $1 AND provider = ANY($2)`,
    [userId, providers]
  );

  for (const row of result.rows) {
    out[row.provider] = {
      state: connectionState(row),
      invalidSince: row.invalid_since || null,
      invalidReason: row.invalid_reason || null,
      lastVerifiedAt: row.last_verified_at || null,
    };
  }
  return out;
}

module.exports = {
  markInvalid,
  markValid,
  connectionState,
  getConnectionStates,
  STATE_ABSENT,
  STATE_CONNECTED,
  STATE_NEEDS_RECONNECT,
};
