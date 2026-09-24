/**
 * Une étape de workflow stocke une CONSIGNE, pas un email.
 *
 * Le moteur d'envoi expédie `touchpoint.body` tel quel : c'est le
 * comportement correct pour une séquence de campagne, où le corps EST l'email.
 * Pour un workflow, le corps est « féliciter pour le recrutement et proposer
 * un échange de 15 minutes ». Sans le marqueur et la génération, un client
 * recevait cette note de service en guise de message.
 *
 * Ce que ces tests tiennent :
 *  1. Une consigne vide ou une génération ratée ne produit RIEN. Jamais un
 *     envoi de repli, jamais la consigne brute : une étape non partie se
 *     rattrape au passage suivant, un email absurde non.
 *  2. La consigne, le contact et les messages déjà envoyés arrivent bien dans
 *     le prompt. C'est tout l'intérêt d'écrire à l'envoi plutôt qu'à la
 *     construction du workflow : à ce moment-là on sait à qui on parle.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const claudePath = require.resolve('../api/claude');
const calls = [];
let reply = { parsed: { subject: 'Bravo pour vos recrutements', body: 'Bonjour Paul,\n\nJ ai vu vos trois postes ouverts.' } };

require.cache[claudePath] = {
  id: claudePath, filename: claudePath, path: path.dirname(claudePath),
  loaded: true, children: [], paths: [],
  exports: {
    async callClaude(system, prompt, maxTokens, action) {
      calls.push({ prompt, action });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  },
};

const { generateStepEmail, isConsigneStep, CONSIGNE_MARKER } = require('../lib/workflow-step-email');

const PROSPECT = {
  name: 'Paul Roy', title: 'directeur commercial', company: 'Roy Industrie',
  email: 'paul@roy.fr', crm_stage: 'Négociation', deal_value: 12000,
};

test('le marqueur distingue une consigne d un email redige', () => {
  assert.equal(isConsigneStep({ type: 'email', sub_type: CONSIGNE_MARKER }), true);
  assert.equal(isConsigneStep({ type: 'email', sub_type: null }), false);
  // Une etape LinkedIn n est jamais concernee.
  assert.equal(isConsigneStep({ type: 'linkedin_invite', sub_type: CONSIGNE_MARKER }), false);
});

test('la consigne et le contact arrivent dans le prompt', async () => {
  calls.length = 0;
  const out = await generateStepEmail({
    consigne: 'Feliciter pour le recrutement et proposer un point de 15 minutes.',
    prospect: PROSPECT,
    previous: [],
    isFirst: true,
  });

  assert.equal(out.subject, 'Bravo pour vos recrutements');
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Feliciter pour le recrutement/);
  assert.match(calls[0].prompt, /Paul Roy/);
  assert.match(calls[0].prompt, /Roy Industrie/);
  // Le deal du contact est du contexte que l etape n avait pas a la
  // construction du workflow : c est le gain de la generation tardive.
  assert.match(calls[0].prompt, /Négociation/);
  assert.equal(calls[0].action, 'workflow_step_email');
});

test('les messages precedents sont passes pour ne pas se repeter', async () => {
  calls.length = 0;
  await generateStepEmail({
    consigne: 'Relancer en une question.',
    prospect: PROSPECT,
    previous: [{ body: 'Feliciter pour le recrutement.' }],
    isFirst: false,
  });

  assert.match(calls[0].prompt, /Feliciter pour le recrutement/);
  assert.match(calls[0].prompt, /Ne pas le redire/);
  assert.match(calls[0].prompt, /relance/i);
});

test('une consigne vide ne declenche aucun appel et ne produit rien', async () => {
  calls.length = 0;
  assert.equal(await generateStepEmail({ consigne: '   ', prospect: PROSPECT }), null);
  assert.equal(calls.length, 0);
});

test('une generation ratee rend null, jamais un repli', async () => {
  // Le point critique : pas de fallback qui enverrait la consigne, ni un
  // email generique signe baakalai. On ne part pas, c est tout.
  reply = { parsed: null, content: 'je ne sais pas' };
  assert.equal(await generateStepEmail({ consigne: 'Relancer.', prospect: PROSPECT }), null);

  reply = { parsed: { subject: 'Objet seul' } };
  assert.equal(await generateStepEmail({ consigne: 'Relancer.', prospect: PROSPECT }), null);

  reply = new Error('API indisponible');
  assert.equal(await generateStepEmail({ consigne: 'Relancer.', prospect: PROSPECT }), null);

  reply = { parsed: { subject: 'ok', body: 'ok' } };
});

test('un JSON noye dans du texte est quand meme recupere', async () => {
  reply = { parsed: null, content: 'Voici :\n{ "subject": "Un point ?", "body": "Bonjour," }\nVoila.' };
  const out = await generateStepEmail({ consigne: 'Relancer.', prospect: PROSPECT });
  assert.equal(out.subject, 'Un point ?');
  reply = { parsed: { subject: 'ok', body: 'ok' } };
});
