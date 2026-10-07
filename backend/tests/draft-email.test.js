/**
 * baakalai ecrit le premier jet d'un email a un contact.
 *
 * ── Ce que cette route remplace ─────────────────────────────────────────────
 *
 * Le bouton « Envoyer un email » de la fiche contact ouvrait DEUX `prompt()`
 * natifs du navigateur et laissait l'utilisateur ecrire a partir de rien. Un
 * produit qui promet de lire le CRM et d'ecrire la relance ne devrait pas
 * demander a son utilisateur de taper un email dans une boite grise.
 *
 * ── Ce que ces tests tiennent ───────────────────────────────────────────────
 *
 * Pas la qualite de l'email · elle depend du modele. Ce qui doit etre tenu par
 * un test, c'est ce qui peut mettre une BETISE sous les yeux d'un client :
 *
 *   · un contact qui n'est pas a moi n'est pas redigeable ;
 *   · une generation ratee ne produit AUCUN repli · ni la consigne, ni un
 *     gabarit creux, qui partiraient tels quels si quelqu'un cliquait Envoyer ;
 *   · la consigne ne raconte que ce qu'on sait. Une date inconnue ne doit pas
 *     devenir « client depuis des mois » dans un email lu par un vrai contact.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

/** Le generateur est remplace : on observe la CONSIGNE qu'on lui passe. */
function interceptLeRedacteur(reponse) {
  const chemin = require.resolve('../lib/workflow-step-email');
  const vrai = require.cache[chemin];
  const vus = [];
  require.cache[chemin] = {
    id: chemin, filename: chemin, loaded: true,
    exports: {
      CONSIGNE_MARKER: 'consigne',
      isConsigneStep: () => true,
      async generateStepEmail(args) { vus.push(args); return reponse; },
    },
  };
  return { vus, restaurer: () => { if (vrai) require.cache[chemin] = vrai; else delete require.cache[chemin]; } };
}

async function contact(db, userId, champs) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, name, email, status, last_activity_at, deal_value, churn_factors)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, champs.nom, champs.email || null, champs.status || 'open',
      champs.derniereActivite || null, champs.montant ?? null,
      champs.facteurs ? JSON.stringify(champs.facteurs) : null]
  );
  return r.rows[0].id;
}

test('la consigne ne raconte que ce qu on sait', async (t) => {
  await setup();
  t.after(teardown);

  const i = interceptLeRedacteur({ subject: 'Objet', body: 'Corps' });
  t.after(i.restaurer);

  const db = require('../db');
  const { token, user } = await registerAndLogin();
  const id = await contact(db, user.id, {
    nom: 'Mehdi Mercier', email: 'mehdi@bastion.fr', status: 'won',
    derniereActivite: new Date(Date.now() - 7 * 86400000).toISOString(),
  });

  const res = await request('POST', `/api/crm/client/${id}/draft-email`, { token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.subject, 'Objet');

  const consigne = i.vus[0].consigne;
  assert.match(consigne, /client/i, 'le statut gagne est dit');
  assert.match(consigne, /7 jours/, 'le silence reel est dit');
  // Le montant n'est pas renseigne : la consigne ne doit pas en inventer un.
  assert.doesNotMatch(consigne, /Montant associe/, 'rien sur un montant inconnu');
});

test('un silence inconnu se dit, il ne se devine pas', async (t) => {
  await setup();
  t.after(teardown);

  const i = interceptLeRedacteur({ subject: 'O', body: 'C' });
  t.after(i.restaurer);

  const db = require('../db');
  const { token, user } = await registerAndLogin();
  const id = await contact(db, user.id, { nom: 'Jamais Vu', email: 'jv@x.fr' });

  await request('POST', `/api/crm/client/${id}/draft-email`, { token });
  const consigne = i.vus[0].consigne;
  // « Aucune activite connue » et non « 0 jours », qui se lirait comme un
  // echange d'aujourd'hui, soit l'inverse de la verite.
  assert.match(consigne, /Aucune activite connue/);
  assert.doesNotMatch(consigne, /depuis 0 jours/);
});

test('les facteurs de risque donnent l angle, jamais le chiffre', async (t) => {
  await setup();
  t.after(teardown);

  const i = interceptLeRedacteur({ subject: 'O', body: 'C' });
  t.after(i.restaurer);

  const db = require('../db');
  const { token, user } = await registerAndLogin();
  const id = await contact(db, user.id, {
    nom: 'A Risque', email: 'ar@x.fr',
    facteurs: [
      { signal: 'inactivity', weight: 30, detail: '128d sans activité' },
      { signal: 'status_won_offset', weight: -15, detail: 'Client actif' },
    ],
  });

  await request('POST', `/api/crm/client/${id}/draft-email`, { token });
  const consigne = i.vus[0].consigne;
  assert.match(consigne, /128d sans activité/, 'le fait est repris');
  // Un abattement negatif n'est pas un point d'attention : le reprendre ferait
  // ecrire « point d'attention : client actif », ce qui n'a aucun sens.
  assert.doesNotMatch(consigne, /Client actif/, 'un facteur negatif n est pas une alerte');
  assert.match(consigne, /Ne jamais mentionner de score/, 'l interdiction est dans la consigne');
});

test('une generation ratee ne produit AUCUN repli', async (t) => {
  await setup();
  t.after(teardown);

  // Le redacteur rend null · c'est son contrat quand il echoue.
  const i = interceptLeRedacteur(null);
  t.after(i.restaurer);

  const db = require('../db');
  const { token, user } = await registerAndLogin();
  const id = await contact(db, user.id, { nom: 'X', email: 'x@x.fr' });

  const res = await request('POST', `/api/crm/client/${id}/draft-email`, { token });
  // Surtout pas 200 avec la consigne dans le corps : elle partirait telle
  // quelle si l'utilisateur cliquait Envoyer sans relire.
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.error, 'generation_failed');
  assert.strictEqual(res.body.subject, undefined);
  assert.strictEqual(res.body.body, undefined);
});

test('un contact sans email n est pas redigeable', async (t) => {
  await setup();
  t.after(teardown);

  const i = interceptLeRedacteur({ subject: 'O', body: 'C' });
  t.after(i.restaurer);

  const db = require('../db');
  const { token, user } = await registerAndLogin();
  const id = await contact(db, user.id, { nom: 'Sans Email' });

  const res = await request('POST', `/api/crm/client/${id}/draft-email`, { token });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'no_email');
  assert.strictEqual(i.vus.length, 0, 'et le redacteur n est meme pas appele');
});

test('le contact d un autre utilisateur est refuse', async (t) => {
  await setup();
  t.after(teardown);

  const i = interceptLeRedacteur({ subject: 'O', body: 'C' });
  t.after(i.restaurer);

  const db = require('../db');
  const premier = await registerAndLogin();
  const id = await contact(db, premier.user.id, { nom: 'Prive', email: 'p@x.fr' });

  const second = await registerAndLogin();
  const res = await request('POST', `/api/crm/client/${id}/draft-email`, { token: second.token });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(i.vus.length, 0, 'rien n est redige sur le contact d un autre');
});
