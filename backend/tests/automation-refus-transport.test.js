/**
 * Ce que le moteur fait des REFUS du transport.
 *
 * `sendPersonalEmail` ne rend pas seulement « parti » ou « raté ». Il rend cinq
 * codes, et trois d'entre eux ont un sens que le moteur doit comprendre :
 *
 *   recipient_bounced          l'adresse est morte           -> arreter
 *   recipient_unsubscribed     la personne a dit non         -> arreter
 *   account_cadence_exceeded   trop de messages a ce compte  -> attendre
 *   no_email_account           plus de boite                 -> arreter le passage
 *   smtp_error                 panne                         -> reessayer
 *
 * Le moteur n'en traitait que deux. Les deux autres tombaient dans la branche
 * generique « failed », qui ne consomme pas l'etape : elle est donc rejouee au
 * passage suivant, et le cron passe onze fois par jour ouvre.
 *
 * Pour un desabonne, ca donne la meme etape rejouee jusqu'a ce que la duree
 * maximale du workflow finisse par sortir le contact, 45 jours par defaut. Et
 * comme une etape de workflow est REDIGEE avant d'etre envoyee, chaque rejeu
 * paie une generation pour un email qu'on sait deja interdit.
 *
 * Deux des trois choses prouvees ici ne sont pas des pannes visibles : rien ne
 * leve, le rapport dit « failed », et le contact reste indefiniment occupe donc
 * inscriptible dans aucun autre workflow.
 */

const test = require('node:test');
const assert = require('node:assert');

// Le transport est remplace AVANT le chargement du moteur. `prochainRefus`
// pilote ce qu'il repond, et `generations` compte ce qu'on a paye en redaction.
const envois = [];
let prochainRefus = null;

const transportPath = require.resolve('../lib/email-outbound');
require.cache[transportPath] = {
  id: transportPath,
  filename: transportPath,
  loaded: true,
  exports: {
    async sendPersonalEmail(userId, opts) {
      envois.push({ to: opts.to, subject: opts.subject });
      if (prochainRefus) return { success: false, ...prochainRefus };
      return { success: true, messageId: `msg-${envois.length}`, accountId: 'boite-1' };
    },
  },
};

const { setup, teardown, registerAndLogin } = require('./helpers');
const moteur = require('../lib/native-sequence-engine');
const db = require('../db');

function faireCtx(userId) {
  return {
    userId,
    accountId: 'boite-1',
    runBudget: 10,
    budgetFor() { return this.runBudget; },
    consume() { this.runBudget--; },
    async isAccepted() { return false; },
    linkedinExhausted: true,
    async getLinkedinCookie() { return null; },
  };
}

/**
 * Une inscription mono-contact avec deux etapes ecrites a la main.
 *
 * Ecrites a la main et non en consigne : ce qui est mesure ici est la decision
 * du moteur face a un refus, pas la redaction. Un test separe couvre le cout de
 * la generation.
 */
async function inscription(userId, { email = 'nina@acme.fr' } = {}) {
  const o = await db.query(
    `INSERT INTO opportunities (user_id, name, email, status) VALUES ($1, 'Nina', $2, 'open') RETURNING id`,
    [userId, email]
  );
  const e = await db.sequenceEnrollments.create({
    userId,
    opportunityId: o.rows[0].id,
    goal: 'automation',
    createdBy: 'trigger',
    status: 'active',
  });
  await db.query(
    `UPDATE sequence_enrollments SET started_at = now(), approved_at = now() WHERE id = $1`,
    [e.id]
  );
  for (const [step, timing] of [[1, 'J+0'], [2, 'J+2']]) {
    await db.query(
      `INSERT INTO touchpoints (enrollment_id, step, type, timing, subject, body, sort_order)
       VALUES ($1, $2, 'email', $3, $4, $5, $2)`,
      [e.id, step, timing, `Objet ${step}`, `Corps ${step}`]
    );
  }
  const r = await db.query('SELECT * FROM sequence_enrollments WHERE id = $1', [e.id]);
  return { enrollmentId: e.id, enrollment: r.rows[0], opportunityId: o.rows[0].id };
}

const actives = async (userId) => (await db.query(
  `SELECT * FROM sequence_enrollments WHERE user_id = $1 AND status IN ('draft','active','paused')`,
  [userId]
)).rows;

/* ── Le desabonnement ── */

test('un contact desabonne sort du parcours au premier refus', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;
  prochainRefus = { code: 'recipient_unsubscribed', error: 'Contact desabonne' };
  t.after(() => { prochainRefus = null; });

  const { user } = await registerAndLogin();
  const { enrollment, enrollmentId } = await inscription(user.id);

  const rapport = await moteur.processEnrollments([enrollment], faireCtx(user.id));

  // Le refus n'est pas une panne : c'est une reponse definitive. La compter
  // dans `failed` ferait croire a un incident technique a reparer, alors qu'il
  // n'y a rien a reparer.
  assert.strictEqual(rapport.failed, 0, 'un desabonnement n est pas un echec technique');
  assert.strictEqual(rapport.stopped, 1);

  const apres = await db.query('SELECT status, stop_reason FROM sequence_enrollments WHERE id = $1', [enrollmentId]);
  assert.strictEqual(apres.rows[0].status, 'stopped');
  assert.strictEqual(apres.rows[0].stop_reason, 'unsubscribed');
});

test('le desabonne ne bloque plus sa place : aucun parcours vivant ne reste sur lui', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;
  prochainRefus = { code: 'recipient_unsubscribed', error: 'Contact desabonne' };
  t.after(() => { prochainRefus = null; });

  const { user } = await registerAndLogin();
  const { enrollment } = await inscription(user.id);

  await moteur.processEnrollments([enrollment], faireCtx(user.id));

  // C'est la consequence la plus couteuse et la moins visible. Un index ne
  // laisse qu'UN parcours vivant par contact (migration 103) : tant que celui-ci
  // reste `active`, ce contact n'entre plus dans aucun autre workflow, pour
  // toujours.
  assert.strictEqual((await actives(user.id)).length, 0);
});

test('et il n est pas rejoue au passage suivant', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;
  prochainRefus = { code: 'recipient_unsubscribed', error: 'Contact desabonne' };
  t.after(() => { prochainRefus = null; });

  const { user } = await registerAndLogin();
  const { enrollment } = await inscription(user.id);

  await moteur.processEnrollments([enrollment], faireCtx(user.id));
  // Le cron ne repasse que les inscriptions vivantes : on relit la base plutot
  // que de reutiliser l'objet, sinon le test se mentirait a lui-meme.
  await moteur.processEnrollments(await actives(user.id), faireCtx(user.id));

  assert.strictEqual(envois.length, 1, 'une seule tentative, pas une par passage');
});

/* ── La cadence de compte ── */

test('un plafond de cadence fait ATTENDRE, il ne fait pas echouer', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;
  prochainRefus = { code: 'account_cadence_exceeded', error: 'Deja 2 messages cette semaine' };
  t.after(() => { prochainRefus = null; });

  const { user } = await registerAndLogin();
  const { enrollment, enrollmentId } = await inscription(user.id);

  const rapport = await moteur.processEnrollments([enrollment], faireCtx(user.id));

  // Le plafond est une decision du produit, pas un incident. Il se rouvrira
  // tout seul : l'inscription doit rester vivante et l'etape rester due.
  assert.strictEqual(rapport.failed, 0, 'une retenue volontaire n est pas un echec');
  assert.strictEqual(rapport.stopped, 0);

  const apres = await db.query('SELECT status FROM sequence_enrollments WHERE id = $1', [enrollmentId]);
  assert.strictEqual(apres.rows[0].status, 'active', 'la cadence ne tue pas le parcours');

  // Et l'etape n'est pas consommee : elle repartira quand la fenetre se rouvre.
  const journal = await db.query(
    `SELECT status FROM campaign_sends WHERE enrollment_id = $1`, [enrollmentId]
  );
  assert.ok(
    journal.rows.every(l => l.status !== 'sent'),
    'rien n a ete marque parti'
  );
});

/* ── Ce qu'on paie avant de savoir ── */

test('une etape en consigne ne paie pas sa redaction deux fois pour un desabonne', async (t) => {
  await setup();
  t.after(teardown);
  envois.length = 0;
  prochainRefus = { code: 'recipient_unsubscribed', error: 'Contact desabonne' };
  t.after(() => { prochainRefus = null; });

  // Le redacteur est intercepte pour COMPTER les appels. C'est la depense
  // reelle du bug : 45 jours de rejeux a onze passages par jour ouvre.
  const redacteurPath = require.resolve('../lib/workflow-step-email');
  const vrai = require(redacteurPath);
  let generations = 0;
  require.cache[redacteurPath].exports = {
    ...vrai,
    isConsigneStep: () => true,
    async generateStepEmail() {
      generations++;
      return { subject: 'Objet redige', body: 'Corps redige' };
    },
  };
  t.after(() => { require.cache[redacteurPath].exports = vrai; });

  const { user } = await registerAndLogin();
  const { enrollment } = await inscription(user.id);

  await moteur.processEnrollments([enrollment], faireCtx(user.id));
  await moteur.processEnrollments(await actives(user.id), faireCtx(user.id));

  assert.strictEqual(generations, 1, 'on ne redige pas deux fois un email interdit');
});
