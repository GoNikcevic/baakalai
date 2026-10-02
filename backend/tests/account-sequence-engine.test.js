/**
 * Le moteur face a une inscription DE COMPTE · lot 6.
 *
 * Ces tests tapent dans le vrai SQL (miroir SQLite) et n'interceptent que le
 * TRANSPORT. C'est deliberé : ce qu'il faut prouver ici est une regle
 * d'indexation du journal d'envoi, donc du SQL, et un faux `db` ne la
 * prouverait pas.
 *
 * ── Le piege central du lot ─────────────────────────────────────────────────
 *
 * Le moteur deduit « quelle etape reste a faire » du journal `campaign_sends`,
 * indexe jusqu'ici par `touchpoint_id` seul. Avec plusieurs destinataires sur
 * une meme inscription, la ligne « etape 1 envoyee » d'Anne faisait croire que
 * l'etape 1 de Bruno etait faite : Bruno sautait a l'etape 2, ou etait declare
 * « parcours termine » sans avoir jamais rien recu.
 *
 * C'est une panne silencieuse de bout en bout · aucune erreur, un rapport
 * d'envoi normal, et un interlocuteur qui recoit une relance sans avoir recu de
 * premier message.
 */

const test = require('node:test');
const assert = require('node:assert');

// Le transport est remplace AVANT de charger le moteur. On garde la trace de
// chaque appel : c'est elle qui dit qui a recu quoi, et dans quel ordre.
const envois = [];
const transportPath = require.resolve('../lib/email-outbound');
require.cache[transportPath] = {
  id: transportPath,
  filename: transportPath,
  loaded: true,
  exports: {
    async sendPersonalEmail(userId, opts) {
      envois.push({ userId, to: opts.to, subject: opts.subject, body: opts.body });
      return { success: true, messageId: `msg-${envois.length}`, accountId: 'boite-1' };
    },
  },
};

const { setup, teardown, registerAndLogin } = require('./helpers');
const moteur = require('../lib/native-sequence-engine');
const { enrollAccount } = require('../lib/account-sequences');

const JOUR = 86400000;

/** Un ctx minimal · seules les fonctions que le moteur appelle vraiment. */
function faireCtx(userId, { budget = 10 } = {}) {
  return {
    userId,
    accountId: 'boite-1',
    runBudget: budget,
    budgetFor() { return this.runBudget; },
    consume() { this.runBudget--; },
    async isAccepted() { return false; },
    linkedinExhausted: true,
    async getLinkedinCookie() { return null; },
  };
}

async function societe(db, userId, nom) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, $2, $3, 'crm') RETURNING id`,
    [userId, nom, nom.toLowerCase()]
  );
  return r.rows[0].id;
}

async function contact(db, userId, accountId, { email, nom, role }) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, account_role, status)
     VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id`,
    [userId, accountId, nom, email, role]
  );
  return r.rows[0].id;
}

/** Deux etapes email : la premiere immediate, la seconde a J+2. */
async function deuxEtapes(db, enrollmentId) {
  const etapes = [];
  for (const [i, timing] of [['1', 'J+0'], ['2', 'J+2']]) {
    const r = await db.query(
      `INSERT INTO touchpoints (enrollment_id, step, type, timing, subject, body, sort_order)
       VALUES ($1, $2, 'email', $3, $4, $5, $6) RETURNING id`,
      [enrollmentId, Number(i), timing, `Objet etape ${i}`, `Corps etape ${i}`, Number(i)]
    );
    etapes.push(r.rows[0].id);
  }
  return etapes;
}

async function inscriptionDeCompte(db, userId, { nbContacts = 2, demarreeIlYaJours = 0 } = {}) {
  const acme = await societe(db, userId, 'Acme');
  const roles = ['decision_maker', 'operational', 'influencer'];
  const noms = ['Anne', 'Bruno', 'Chloe'];
  for (let i = 0; i < nbContacts; i++) {
    await contact(db, userId, acme, { email: `${noms[i].toLowerCase()}@acme.fr`, nom: noms[i], role: roles[i] });
  }
  const e = await enrollAccount(userId, { accountId: acme, goal: 'reactivation' });
  const debut = new Date(Date.now() - demarreeIlYaJours * JOUR).toISOString();
  await db.query(
    `UPDATE sequence_enrollments SET status = 'active', started_at = $2, approved_at = $2 WHERE id = $1`,
    [e.enrollmentId, debut]
  );
  await deuxEtapes(db, e.enrollmentId);
  const r = await db.query('SELECT * FROM sequence_enrollments WHERE id = $1', [e.enrollmentId]);
  return { accountId: acme, enrollment: r.rows[0], enrollmentId: e.enrollmentId };
}

test('un seul destinataire est servi par passage', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollment } = await inscriptionDeCompte(db, user.id, { nbContacts: 3 });

  const rapport = await moteur.processEnrollments([enrollment], faireCtx(user.id));

  // Trois destinataires sont dus, le moteur n'en sert qu'un. Le cron repasse
  // plusieurs fois par jour : servir tout le monde d'un coup annulerait
  // l'espacement qui empeche deux messages au meme domaine le meme jour.
  assert.strictEqual(rapport.emailsSent, 1);
  assert.strictEqual(envois.length, 1);
  assert.strictEqual(envois[0].to, 'anne@acme.fr', 'le decideur d abord');
});

test('le decideur sert en premier, puis les autres dans l ordre du role', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollment, enrollmentId } = await inscriptionDeCompte(db, user.id, { nbContacts: 3 });

  // Trois passages, en reculant a chaque fois le dernier envoi au compte pour
  // franchir l'espacement · c'est ce que fait le temps dans la vraie vie.
  for (let i = 0; i < 3; i++) {
    await moteur.processEnrollments([enrollment], faireCtx(user.id));
    await db.query(
      `UPDATE campaign_sends SET sent_at = $2 WHERE enrollment_id = $1`,
      [enrollmentId, new Date(Date.now() - 3 * JOUR).toISOString()]
    );
    await db.query(
      `UPDATE sequence_recipients SET last_sent_at = $2 WHERE enrollment_id = $1 AND last_sent_at IS NOT NULL`,
      [enrollmentId, new Date(Date.now() - 3 * JOUR).toISOString()]
    );
  }

  // Anne est decideuse, Bruno operationnel, Chloe influenceuse · et l'ordre de
  // priorite est decision_maker, influencer, operational. Chloe passe donc
  // AVANT Bruno : un influenceur peut porter le sujet en interne, un
  // operationnel n'a pas la main sur le budget.
  assert.deepStrictEqual(
    envois.map(e => e.to),
    ['anne@acme.fr', 'chloe@acme.fr', 'bruno@acme.fr'],
    'ordre attendu : decideur, influenceur, operationnel'
  );
});

test('l etape 1 d un collegue ne fait pas sauter l etape 1 du suivant', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollment, enrollmentId } = await inscriptionDeCompte(db, user.id, { nbContacts: 2 });

  // Passage 1 : Anne recoit l'etape 1.
  await moteur.processEnrollments([enrollment], faireCtx(user.id));
  assert.strictEqual(envois.length, 1);
  assert.strictEqual(envois[0].subject, 'Objet etape 1');

  // On recule les traces pour franchir l'espacement, puis passage 2 : Bruno.
  const vieux = new Date(Date.now() - 3 * JOUR).toISOString();
  await db.query(`UPDATE campaign_sends SET sent_at = $2 WHERE enrollment_id = $1`, [enrollmentId, vieux]);
  await db.query(`UPDATE sequence_recipients SET last_sent_at = $2 WHERE enrollment_id = $1 AND last_sent_at IS NOT NULL`, [enrollmentId, vieux]);

  await moteur.processEnrollments([enrollment], faireCtx(user.id));

  assert.strictEqual(envois.length, 2);
  assert.strictEqual(envois[1].to, 'bruno@acme.fr');
  // LE COEUR DU TEST. Avant le lot, `done` etait indexe par touchpoint_id seul :
  // la ligne d'Anne sur l'etape 1 valait pour Bruno, qui aurait donc recu
  // « Objet etape 2 » en guise de premier contact.
  assert.strictEqual(envois[1].subject, 'Objet etape 1',
    'Bruno doit recevoir SON etape 1, pas l etape 2 au pretexte qu Anne a eu l etape 1');

  // Et le journal porte bien une ligne par (destinataire, etape).
  const lignes = await db.query(
    `SELECT o.name, cs.touchpoint_id FROM campaign_sends cs
       JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.enrollment_id = $1 AND cs.status = 'sent' ORDER BY o.name`,
    [enrollmentId]
  );
  assert.deepStrictEqual(lignes.rows.map(r => r.name), ['Anne', 'Bruno']);
  assert.notStrictEqual(lignes.rows[0].touchpoint_id, undefined);
});

test('l espacement bloque le second destinataire dans la meme journee', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollment } = await inscriptionDeCompte(db, user.id, { nbContacts: 2 });

  await moteur.processEnrollments([enrollment], faireCtx(user.id));
  assert.strictEqual(envois.length, 1);

  // Deuxieme passage immediat : rien ne doit partir. Un plafond de deux
  // messages par semaine serait respecte a la lettre par deux envois a dix
  // minutes d'intervalle, et c'est precisement le motif de spam qu'on evite.
  await moteur.processEnrollments([enrollment], faireCtx(user.id));
  assert.strictEqual(envois.length, 1, 'aucun second envoi dans la meme journee');
});

test('une inscription de compte ne se termine que quand tous ont fini', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollment, enrollmentId } = await inscriptionDeCompte(db, user.id, { nbContacts: 2, demarreeIlYaJours: 10 });

  const vieux = () => new Date(Date.now() - 3 * JOUR).toISOString();
  const reculer = async () => {
    await db.query(`UPDATE campaign_sends SET sent_at = $2 WHERE enrollment_id = $1`, [enrollmentId, vieux()]);
    await db.query(`UPDATE sequence_recipients SET last_sent_at = $2 WHERE enrollment_id = $1 AND last_sent_at IS NOT NULL`, [enrollmentId, vieux()]);
  };

  // Quatre envois a faire (2 destinataires x 2 etapes), plus les passages a
  // vide. On boucle largement puis on verifie l'etat final.
  for (let i = 0; i < 10; i++) {
    await moteur.processEnrollments([enrollment], faireCtx(user.id));
    await reculer();
  }

  const etat = await db.query('SELECT status FROM sequence_enrollments WHERE id = $1', [enrollmentId]);
  const dest = await db.query(
    `SELECT o.name, sr.status, sr.sent_count FROM sequence_recipients sr
       JOIN opportunities o ON o.id = sr.opportunity_id
      WHERE sr.enrollment_id = $1 ORDER BY o.name`,
    [enrollmentId]
  );

  assert.strictEqual(envois.length, 4, 'deux destinataires, deux etapes chacun');
  assert.deepStrictEqual(dest.rows.map(r => r.status), ['stopped', 'stopped'],
    'chaque destinataire a epuise son parcours');
  assert.strictEqual(etat.rows[0].status, 'completed',
    'et l inscription ne se termine QU APRES le dernier destinataire');
});

test('un rebond n arrete que le destinataire concerne', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollment, enrollmentId } = await inscriptionDeCompte(db, user.id, { nbContacts: 2 });

  // Le transport rend un rebond definitif pour Anne seulement.
  const transport = require('../lib/email-outbound');
  const vrai = transport.sendPersonalEmail;
  transport.sendPersonalEmail = async (userId, opts) => {
    if (opts.to === 'anne@acme.fr') return { success: false, code: 'recipient_bounced', error: 'adresse morte' };
    return vrai(userId, opts);
  };
  t.after(() => { transport.sendPersonalEmail = vrai; });

  await moteur.processEnrollments([enrollment], faireCtx(user.id));

  const etat = await db.query('SELECT status FROM sequence_enrollments WHERE id = $1', [enrollmentId]);
  const dest = await db.query(
    `SELECT o.name, sr.status FROM sequence_recipients sr
       JOIN opportunities o ON o.id = sr.opportunity_id
      WHERE sr.enrollment_id = $1 ORDER BY o.name`,
    [enrollmentId]
  );
  const parNom = new Map(dest.rows.map(r => [r.name, r.status]));

  // L'adresse d'Anne qui rebondit ne dit rien de celle de Bruno. Avant le lot,
  // une inscription valait un contact, donc un rebond arretait tout · garder ce
  // comportement ferait perdre le compte entier pour une adresse morte.
  assert.strictEqual(parNom.get('Anne'), 'stopped');
  assert.strictEqual(parNom.get('Bruno'), 'active', 'Bruno reste joignable');
  assert.notStrictEqual(etat.rows[0].status, 'stopped', 'l inscription survit au rebond d un seul');
});

test('une reponse met l inscription de compte en PAUSE, jamais en arret', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();
  const { enrollmentId } = await inscriptionDeCompte(db, user.id, { nbContacts: 2 });

  const issue = await moteur.onEnrollmentReply(enrollmentId, 'replied');
  assert.strictEqual(issue, 'paused');

  const etat = await db.query('SELECT status FROM sequence_enrollments WHERE id = $1', [enrollmentId]);
  // `stopped` ne repasse plus dans le moteur : les collegues mis en silence y
  // seraient geles pour de bon, sous un nom qui dit le contraire.
  assert.strictEqual(etat.rows[0].status, 'paused');
});

test('une inscription mono-contact garde son comportement d avant', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;

  const db = require('../db');
  const { user } = await registerAndLogin();

  // Pas de compte, pas de ligne de destinataire : exactement une inscription
  // d'avant le lot 6. `recipientsOf` en fabrique un destinataire synthetique.
  const o = await db.query(
    `INSERT INTO opportunities (user_id, name, email, status)
     VALUES ($1, 'Solo', 'solo@ailleurs.fr', 'open') RETURNING id`, [user.id]
  );
  const e = await db.query(
    `INSERT INTO sequence_enrollments (user_id, opportunity_id, goal, status, started_at)
     VALUES ($1, $2, 'reactivation', 'active', now()) RETURNING *`,
    [user.id, o.rows[0].id]
  );
  await deuxEtapes(db, e.rows[0].id);

  await moteur.processEnrollments([e.rows[0]], faireCtx(user.id));
  assert.strictEqual(envois.length, 1);
  assert.strictEqual(envois[0].to, 'solo@ailleurs.fr');

  // Et une reponse l'ARRETE, comme avant : il n'y a plus personne a qui ecrire.
  const issue = await moteur.onEnrollmentReply(e.rows[0].id, 'replied');
  assert.strictEqual(issue, 'stopped');
  const etat = await db.query('SELECT status, stop_reason FROM sequence_enrollments WHERE id = $1', [e.rows[0].id]);
  assert.strictEqual(etat.rows[0].status, 'stopped');
  assert.strictEqual(etat.rows[0].stop_reason, 'replied');
});
