/**
 * L'ACCELERATEUR du lot 6 : une inscription, plusieurs interlocuteurs.
 *
 * Le frein (tests/account-cadence.test.js) borne le NOMBRE de messages par
 * societe et par semaine. Ces tests-ci tiennent les deux autres garde-fous,
 * ceux que le plafond ne couvre pas :
 *
 *   - l'ESPACEMENT : deux interlocuteurs d'une meme societe ne recoivent pas
 *     dans la meme journee. Un plafond de 2 par semaine serait respecte a la
 *     lettre par deux messages envoyes a dix minutes d'intervalle.
 *   - l'EXCLUSIVITE : un contact n'est destinataire que d'une sequence vivante
 *     a la fois.
 *
 * Et la regle de politesse qui fait tout le lot : quand un interlocuteur
 * repond, on se TAIT sur les autres fils de son compte.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const HOUR = 3600000;

async function societe(db, userId, nom) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, $2, $3, 'crm') RETURNING id`,
    [userId, nom, nom.toLowerCase()]
  );
  return r.rows[0].id;
}

async function contact(db, userId, accountId, { email, nom, role = null, principal = false, titre = null, actif = null, rebondi = null }) {
  const r = await db.query(
    `INSERT INTO opportunities
       (user_id, account_id, name, email, title, account_role, is_primary_contact, last_activity_at, email_bounced_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open') RETURNING id`,
    [userId, accountId, nom || email.split('@')[0], email, titre, role, principal, actif, rebondi]
  );
  return r.rows[0].id;
}

test('les interlocuteurs sont abordes dans l ordre du role, decideur d abord', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listCandidates } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  // Insere dans le DESORDRE pour que le test prouve un tri et non l'ordre
  // naturel de la table.
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Operationnel', role: 'operational' });
  await contact(db, user.id, acme, { email: 'autre@acme.fr', nom: 'Autre', role: 'other' });
  await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'infl@acme.fr', nom: 'Influence', role: 'influencer' });

  const liste = await listCandidates(user.id, acme, { limit: 4 });
  assert.deepStrictEqual(liste.map(c => c.name), ['Chef', 'Influence', 'Operationnel', 'Autre']);
});

test('a role egal, l interlocuteur principal passe devant', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listCandidates } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  await contact(db, user.id, acme, { email: 'a@acme.fr', nom: 'Simple', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'b@acme.fr', nom: 'Principal', role: 'decision_maker', principal: true });

  const liste = await listCandidates(user.id, acme);
  assert.strictEqual(liste[0].name, 'Principal');
});

test('un role inconnu ferme la marche, il ne passe pas pour un decideur', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listCandidates, prioriteDe, PRIORITE_INCONNUE } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  // Le piege a eviter : un role NULL trie avant 'decision_maker' si on le
  // traite comme zero. On prefere ne pas ecrire a quelqu un dont on ignore la
  // fonction plutot que de lui ecrire en premier.
  assert.strictEqual(prioriteDe(null), PRIORITE_INCONNUE);
  assert.strictEqual(prioriteDe('inventé'), PRIORITE_INCONNUE);

  const acme = await societe(db, user.id, 'Acme');
  await contact(db, user.id, acme, { email: 'inconnu@acme.fr', nom: 'Inconnu', role: null });
  await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });

  const liste = await listCandidates(user.id, acme);
  assert.deepStrictEqual(liste.map(c => c.name), ['Chef', 'Inconnu']);
});

test('un injoignable n est pas candidat', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listCandidates } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  await contact(db, user.id, acme, { email: 'ok@acme.fr', nom: 'Joignable', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'rebond@acme.fr', nom: 'Rebondi', role: 'decision_maker', rebondi: new Date().toISOString() });
  // Sans email du tout.
  await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, status) VALUES ($1, $2, 'SansEmail', 'open')`,
    [user.id, acme]
  );

  const liste = await listCandidates(user.id, acme, { limit: 10 });
  assert.deepStrictEqual(liste.map(c => c.name), ['Joignable']);
});

test('un desabonne n est pas candidat, et c est verifie par le hash', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listCandidates } = require('../lib/account-sequences');
  const { recordOptOut } = require('../lib/contact-optout');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  await contact(db, user.id, acme, { email: 'ok@acme.fr', nom: 'Joignable', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'stop@acme.fr', nom: 'Desabonne', role: 'decision_maker' });

  // `contact_optouts` s'interroge par `email_hash` et pas par `email` · un
  // filtre ecrit a la main sur la colonne en clair rendrait faux en silence et
  // laisserait un desabonne entrer dans une sequence.
  await recordOptOut(user.id, { email: 'stop@acme.fr', source: 'test' });

  const liste = await listCandidates(user.id, acme, { limit: 10 });
  assert.deepStrictEqual(liste.map(c => c.name), ['Joignable']);
});

test('inscrire un compte cree l inscription et ses destinataires', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollAccount } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  const chef = await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Op', role: 'operational' });

  const r = await enrollAccount(user.id, { accountId: acme, goal: 'reactivation' });
  assert.ok(r, 'une inscription doit etre creee');
  assert.strictEqual(r.recipients.length, 2);

  const e = await db.query('SELECT opportunity_id, account_id, status FROM sequence_enrollments WHERE id = $1', [r.enrollmentId]);
  assert.strictEqual(e.rows[0].account_id, acme);
  assert.strictEqual(e.rows[0].opportunity_id, chef,
    'le contact d ancrage est le premier de la liste, donc le decideur');
  assert.strictEqual(e.rows[0].status, 'draft');
});

test('un compte sans interlocuteur joignable ne produit AUCUNE inscription', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollAccount } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const vide = await societe(db, user.id, 'Vide');
  // Une inscription vide tournerait a chaque passage du moteur sans rien faire,
  // et apparaitrait dans l'Historique comme un parcours en cours.
  const r = await enrollAccount(user.id, { accountId: vide, goal: 'reactivation' });
  assert.strictEqual(r, null);

  const n = await db.query('SELECT count(*) AS n FROM sequence_enrollments WHERE user_id = $1', [user.id]);
  assert.strictEqual(Number(n.rows[0].n), 0);
});

test('un contact deja destinataire ailleurs n est pas re-inscrit', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollAccount, listCandidates } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Op', role: 'operational' });

  const premiere = await enrollAccount(user.id, { accountId: acme, goal: 'reactivation' });
  await db.query(`UPDATE sequence_enrollments SET status = 'active' WHERE id = $1`, [premiere.enrollmentId]);

  // L'exclusivite : les deux contacts sont pris, donc plus aucun candidat.
  const restants = await listCandidates(user.id, acme, { limit: 10 });
  assert.deepStrictEqual(restants, []);

  const seconde = await enrollAccount(user.id, { accountId: acme, goal: 'upsell' });
  assert.strictEqual(seconde, null, 'aucune seconde inscription sur les memes personnes');
});

test('un destinataire dont l inscription est terminee redevient candidat', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollAccount, listCandidates } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });

  const e = await enrollAccount(user.id, { accountId: acme, goal: 'reactivation' });
  await db.query(`UPDATE sequence_enrollments SET status = 'completed' WHERE id = $1`, [e.enrollmentId]);

  // L'exclusivite porte sur les sequences VIVANTES. Une fois le parcours
  // termine, la personne peut etre reabordee plus tard · sinon un contact
  // serait grille a vie par une seule sequence.
  const liste = await listCandidates(user.id, acme, { limit: 10 });
  assert.deepStrictEqual(liste.map(c => c.name), ['Chef']);
});

/* ═══════════════════ L'espacement ═══════════════════ */

test('deux destinataires differents ne partent pas dans la meme journee', async (t) => {
  const { chooseNext, HEURES_ENTRE_DESTINATAIRES } = require('../lib/account-sequences');

  const destinataires = [
    { recipientId: 'r1', status: 'active', role: 'decision_maker', lastSentAt: null, sentCount: 1, prospect: { id: 'a' } },
    { recipientId: 'r2', status: 'active', role: 'operational', lastSentAt: null, sentCount: 0, prospect: { id: 'b' } },
  ];

  const maintenant = Date.now();
  const ilYaDeuxHeures = maintenant - 2 * HOUR;

  // Un collegue a recu il y a deux heures : on ne sert pas le suivant.
  assert.strictEqual(chooseNext(destinataires, ilYaDeuxHeures, maintenant), null);

  // Passe le delai, il part.
  const avantLeDelai = maintenant - (HEURES_ENTRE_DESTINATAIRES + 1) * HOUR;
  const choisi = chooseNext(destinataires, avantLeDelai, maintenant);
  assert.strictEqual(choisi?.recipientId, 'r2');
});

test('l espacement ne bride pas la relance de la MEME personne', async (t) => {
  const { chooseNext } = require('../lib/account-sequences');

  // Tous les destinataires ont deja ete servis : il ne s'agit plus d'aborder
  // quelqu'un de nouveau mais de suivre le rythme des steps, qui a ses propres
  // delais. L'espacement ne doit pas s'y ajouter.
  const destinataires = [
    { recipientId: 'r1', status: 'active', role: 'decision_maker', lastSentAt: new Date(Date.now() - 3 * 86400000).toISOString(), sentCount: 1, prospect: { id: 'a' } },
  ];
  const choisi = chooseNext(destinataires, Date.now() - 2 * HOUR, Date.now());
  assert.strictEqual(choisi?.recipientId, 'r1');
});

test('un destinataire jamais servi passe avant une relance', async (t) => {
  const { chooseNext } = require('../lib/account-sequences');

  const destinataires = [
    { recipientId: 'r1', status: 'active', role: 'decision_maker', lastSentAt: new Date(Date.now() - 5 * 86400000).toISOString(), sentCount: 2, prospect: { id: 'a' } },
    { recipientId: 'r2', status: 'active', role: 'other', lastSentAt: null, sentCount: 0, prospect: { id: 'b' } },
  ];
  // r2 a le role le moins prioritaire, mais aborder un nouvel interlocuteur
  // vaut mieux que de reinsister aupres du meme · c'est l'objet du lot.
  const choisi = chooseNext(destinataires, 0, Date.now());
  assert.strictEqual(choisi?.recipientId, 'r2');
});

test('un destinataire suspendu ou ayant repondu n est jamais choisi', async (t) => {
  const { chooseNext } = require('../lib/account-sequences');

  assert.strictEqual(chooseNext([
    { recipientId: 'r1', status: 'suspended', role: 'decision_maker', lastSentAt: null, sentCount: 0, prospect: { id: 'a' } },
    { recipientId: 'r2', status: 'replied', role: 'decision_maker', lastSentAt: null, sentCount: 0, prospect: { id: 'b' } },
    { recipientId: 'r3', status: 'stopped', role: 'decision_maker', lastSentAt: null, sentCount: 0, prospect: { id: 'c' } },
  ], 0, Date.now()), null);
});

/* ═══════════════════ Une reponse fait taire les autres fils ═══════════════════ */

test('quand un interlocuteur repond, les autres destinataires du compte sont suspendus', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollAccount, suspendSiblings, markReplied } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  const chef = await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Op', role: 'operational' });
  await contact(db, user.id, acme, { email: 'inf@acme.fr', nom: 'Inf', role: 'influencer' });

  // Une autre societe, qui ne doit pas bouger.
  const autre = await societe(db, user.id, 'Autre');
  await contact(db, user.id, autre, { email: 'x@autre.fr', nom: 'X', role: 'decision_maker' });
  const eAutre = await enrollAccount(user.id, { accountId: autre, goal: 'reactivation' });

  await enrollAccount(user.id, { accountId: acme, goal: 'reactivation' });

  const n = await suspendSiblings(user.id, { accountId: acme, exceptOpportunityId: chef });
  assert.strictEqual(n, 2, 'les deux collegues du repondeur, pas lui');

  await markReplied(user.id, chef);

  const etats = await db.query(
    `SELECT o.name, sr.status, sr.suspend_reason FROM sequence_recipients sr
       JOIN opportunities o ON o.id = sr.opportunity_id
      WHERE sr.user_id = $1 ORDER BY o.name`,
    [user.id]
  );
  const parNom = new Map(etats.rows.map(r => [r.name, r]));
  assert.strictEqual(parNom.get('Chef').status, 'replied');
  assert.strictEqual(parNom.get('Op').status, 'suspended');
  assert.strictEqual(parNom.get('Op').suspend_reason, 'colleague_replied');
  assert.strictEqual(parNom.get('Inf').status, 'suspended');
  assert.strictEqual(parNom.get('X').status, 'active', 'une autre societe n est pas touchee');
  assert.ok(eAutre, 'temoin');
});

test('suspendre n est pas arreter : le destinataire peut reprendre', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollAccount, suspendSiblings } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  const chef = await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Op', role: 'operational' });
  await enrollAccount(user.id, { accountId: acme, goal: 'reactivation' });

  await suspendSiblings(user.id, { accountId: acme, exceptOpportunityId: chef });

  // Une conversation peut retomber sans rien conclure. `suspended` dit « pas
  // maintenant », pas « jamais » · d'ou un statut distinct de `stopped`.
  const r = await db.query(
    `UPDATE sequence_recipients SET status = 'active', suspend_reason = NULL
      WHERE user_id = $1 AND status = 'suspended'`,
    [user.id]
  );
  assert.strictEqual(r.rowCount, 1);
});

/* ═══════════════════ L'espacement lit les DEUX journaux ═══════════════════ */

test('le dernier envoi au compte est cherche dans les deux journaux', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { lastSendToAccount } = require('../lib/account-sequences');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  const anne = await contact(db, user.id, acme, { email: 'anne@acme.fr', nom: 'Anne' });
  const bruno = await contact(db, user.id, acme, { email: 'bruno@acme.fr', nom: 'Bruno' });

  assert.strictEqual(await lastSendToAccount(user.id, acme), 0, 'aucun envoi, donc « jamais »');

  // Un vieil envoi de relance...
  await db.query(
    `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, subject, body, status, sent_at)
     VALUES ($1, $2, 'anne@acme.fr', 'S', 'B', 'sent', $3)`,
    [user.id, anne, new Date(Date.now() - 5 * 86400000).toISOString()]
  );
  // ...et un envoi RECENT du moteur de sequence, dans l'autre journal.
  const tp = await db.query(`INSERT INTO touchpoints (campaign_id, step, type) VALUES (NULL, 1, 'email') RETURNING id`);
  const recent = new Date(Date.now() - 2 * HOUR).toISOString();
  await db.query(
    `INSERT INTO campaign_sends (user_id, opportunity_id, touchpoint_id, channel, status, sent_at)
     VALUES ($1, $2, $3, 'email', 'sent', $4)`,
    [user.id, bruno, tp.rows[0].id, recent]
  );

  // Ne lire qu'un seul journal rendrait l'espacement aveugle a la moitie des
  // envois, et ferait repartir un message deux heures apres le precedent.
  const dernier = await lastSendToAccount(user.id, acme);
  assert.strictEqual(new Date(dernier).toISOString(), recent);
});

/* ═════ La bascule : un workflow multi-destinataires inscrit la SOCIETE ═════
 *
 * Sans ce branchement, tout le lot 6 serait du code que rien n'atteint.
 *
 * Et il est EN OPT-IN, eteint par defaut. Rendre tous les workflows
 * multi-destinataires d'un coup aurait change ce que recoivent les contacts des
 * utilisateurs existants sans que personne le demande, et du cote ou l'erreur
 * coute le plus cher : une reputation d'expediteur met des mois a revenir.
 */

async function workflowAvecDeclencheur(db, userId, { multiThread }) {
  // Une boite active est exigee avant toute inscription · sans elle, le
  // workflow inscrirait des contacts a qui rien ne peut partir.
  await db.query(
    `INSERT INTO email_accounts (user_id, email_address, provider, status)
     VALUES ($1, 'moi@baakal.ai', 'gmail', 'active')`,
    [userId]
  );
  const wf = await db.query(
    `INSERT INTO workflows (user_id, name, multi_thread) VALUES ($1, 'Relance', $2) RETURNING id`,
    [userId, multiThread]
  );
  await db.query(
    `INSERT INTO touchpoints (workflow_id, step, type, timing, subject, body, sort_order)
     VALUES ($1, 1, 'email', 'J+0', 'Objet', 'Corps', 1)`,
    [wf.rows[0].id]
  );
  const tr = await db.query(
    `INSERT INTO automation_triggers (user_id, workflow_id, event_source, event_key, label, status)
     VALUES ($1, $2, 'signal', 'hiring', 'Recrutement', 'active') RETURNING id`,
    [userId, wf.rows[0].id]
  );
  return { workflowId: wf.rows[0].id, triggerId: tr.rows[0].id };
}

test('interrupteur allume : la societe est inscrite, avec ses interlocuteurs', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollFromSignal } = require('../lib/automation-enroll');
  const { user } = await registerAndLogin();

  await workflowAvecDeclencheur(db, user.id, { multiThread: true });

  const acme = await societe(db, user.id, 'Acme');
  const chef = await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Op', role: 'operational' });

  const sig = await db.query(
    `INSERT INTO signals (user_id, signal_type, title, opportunity_id, status)
     VALUES ($1, 'hiring', 'Acme recrute', $2, 'new') RETURNING id`,
    [user.id, chef]
  );

  const out = await enrollFromSignal({
    id: sig.rows[0].id, user_id: user.id, signal_type: 'hiring',
    title: 'Acme recrute', opportunity_id: chef,
  });

  assert.strictEqual(out.ok, true, out.reason);
  assert.strictEqual(out.recipients, 2, 'les deux interlocuteurs joignables');

  const e = await db.query('SELECT account_id, status, workflow_id FROM sequence_enrollments WHERE id = $1', [out.enrollmentId]);
  assert.strictEqual(e.rows[0].account_id, acme, 'l inscription porte la SOCIETE');
  assert.strictEqual(e.rows[0].status, 'active');
  assert.ok(e.rows[0].workflow_id, 'et reste rattachee a son workflow');

  // Les etapes du workflow sont bien recopiees sur l inscription · sinon le
  // moteur trouverait un parcours vide et le declarerait aussitot termine.
  const etapes = await db.query('SELECT count(*) AS n FROM touchpoints WHERE enrollment_id = $1', [out.enrollmentId]);
  assert.strictEqual(Number(etapes.rows[0].n), 1);
});

test('interrupteur eteint : le comportement d avant, un seul contact', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollFromSignal } = require('../lib/automation-enroll');
  const { user } = await registerAndLogin();

  await workflowAvecDeclencheur(db, user.id, { multiThread: false });

  const acme = await societe(db, user.id, 'Acme');
  const chef = await contact(db, user.id, acme, { email: 'chef@acme.fr', nom: 'Chef', role: 'decision_maker' });
  await contact(db, user.id, acme, { email: 'op@acme.fr', nom: 'Op', role: 'operational' });

  const sig = await db.query(
    `INSERT INTO signals (user_id, signal_type, title, opportunity_id, status)
     VALUES ($1, 'hiring', 'Acme recrute', $2, 'new') RETURNING id`,
    [user.id, chef]
  );
  const out = await enrollFromSignal({
    id: sig.rows[0].id, user_id: user.id, signal_type: 'hiring',
    title: 'Acme recrute', opportunity_id: chef,
  });

  assert.strictEqual(out.ok, true, out.reason);
  const e = await db.query('SELECT account_id, opportunity_id FROM sequence_enrollments WHERE id = $1', [out.enrollmentId]);
  assert.strictEqual(e.rows[0].account_id, null, 'aucune societe : chemin mono-contact');
  assert.strictEqual(e.rows[0].opportunity_id, chef);

  const dest = await db.query('SELECT count(*) AS n FROM sequence_recipients WHERE enrollment_id = $1', [out.enrollmentId]);
  assert.strictEqual(Number(dest.rows[0].n), 0, 'et aucune ligne de destinataire');
});

test('interrupteur allume mais contact sans societe : chemin mono-contact', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { enrollFromSignal } = require('../lib/automation-enroll');
  const { user } = await registerAndLogin();

  await workflowAvecDeclencheur(db, user.id, { multiThread: true });

  // Pas de `account_id` : inventer une societe pour pouvoir fan-outer serait
  // pire que de ne pas fan-outer.
  const o = await db.query(
    `INSERT INTO opportunities (user_id, name, email, status)
     VALUES ($1, 'Isole', 'isole@ailleurs.fr', 'open') RETURNING id`,
    [user.id]
  );
  const sig = await db.query(
    `INSERT INTO signals (user_id, signal_type, title, opportunity_id, status)
     VALUES ($1, 'hiring', 'Recrute', $2, 'new') RETURNING id`,
    [user.id, o.rows[0].id]
  );
  const out = await enrollFromSignal({
    id: sig.rows[0].id, user_id: user.id, signal_type: 'hiring',
    title: 'Recrute', opportunity_id: o.rows[0].id,
  });

  assert.strictEqual(out.ok, true, out.reason);
  const e = await db.query('SELECT account_id FROM sequence_enrollments WHERE id = $1', [out.enrollmentId]);
  assert.strictEqual(e.rows[0].account_id, null);
});
