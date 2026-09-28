/**
 * Le verrou de désinscription au TRANSPORT.
 *
 * Les tests de lib/contact-optout vérifient la brique. Ceux-ci vérifient la
 * seule chose qui compte vraiment : qu'un email destiné à un contact
 * désinscrit ne part pas, et qu'un email qui part porte bien de quoi se
 * désinscrire.
 *
 * Le verrou est posé dans sendPersonalEmail, point de passage unique de tous
 * les envois sortants. Si quelqu'un le déplace chez les appelants un jour,
 * ces tests tombent, et c'est exactement ce qu'on veut : chaque appelant
 * oublierait la règle tôt ou tard.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.ENCRYPTION_SECRET = 'secret-de-test-pour-le-transport';
process.env.APP_URL = 'https://app.example.test';

// ── Doublures ──────────────────────────────────────────────────────────────

const sent = [];
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath, filename: nodemailerPath, path: path.dirname(nodemailerPath),
  loaded: true, children: [], paths: [],
  exports: {
    createTransport: () => ({
      async sendMail(options) {
        sent.push(options);
        return { messageId: 'msg-test-1' };
      },
    }),
  },
};

const cryptoPath = require.resolve('../config/crypto');
require.cache[cryptoPath] = {
  id: cryptoPath, filename: cryptoPath, path: path.dirname(cryptoPath),
  loaded: true, children: [], paths: [],
  exports: { decrypt: (v) => v, encrypt: (v) => v },
};

const state = {
  optouts: [],
  account: {
    id: 'acc1', user_id: 'u1', provider: 'smtp', email_address: 'vendeur@masociete.fr',
    status: 'active', smtp_host: 'smtp.test', smtp_port: 587,
    smtp_user: 'vendeur', smtp_pass: 'x',
    signature_text: null, signature_image: null,
  },
  language: 'fr',
};

const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [],
  exports: {
    async query(sql, params = []) {
      if (/SELECT 1 FROM contact_optouts/.test(sql)) {
        const [userId, hash] = params;
        return { rows: state.optouts.filter(o => o.user_id === userId && o.hash === hash).slice(0, 1) };
      }
      if (/FROM email_accounts/.test(sql)) return { rows: state.account ? [state.account] : [] };
      if (/SELECT language FROM users/.test(sql)) return { rows: [{ language: state.language }] };
      return { rows: [] };
    },
    opportunities: { get: async () => null },
  },
};

const optout = require('../lib/contact-optout');
const { sendPersonalEmail } = require('../lib/email-outbound');

function blockContact(userId, email) {
  state.optouts.push({ user_id: userId, hash: optout.hashEmail(email) });
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('un contact desinscrit ne recoit RIEN', async () => {
  sent.length = 0;
  state.optouts.length = 0;
  blockContact('u1', 'refus@prospect.fr');

  const result = await sendPersonalEmail('u1', {
    to: 'refus@prospect.fr', toName: 'Refus', subject: 'Relance', body: 'Bonjour',
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'recipient_unsubscribed');
  assert.equal(sent.length, 0, 'un email est parti vers un contact désinscrit');
});

test('la casse de l adresse ne permet pas de contourner le blocage', async () => {
  sent.length = 0;
  state.optouts.length = 0;
  blockContact('u1', 'refus@prospect.fr');

  const result = await sendPersonalEmail('u1', {
    to: 'Refus@Prospect.FR', subject: 'Relance', body: 'Bonjour',
  });

  assert.equal(result.code, 'recipient_unsubscribed');
  assert.equal(sent.length, 0);
});

test('l opposition d un contact chez un utilisateur ne bloque pas un autre utilisateur', async () => {
  sent.length = 0;
  state.optouts.length = 0;
  blockContact('u1', 'commun@prospect.fr');

  const result = await sendPersonalEmail('u2', {
    to: 'commun@prospect.fr', subject: 'Relance', body: 'Bonjour',
  });

  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
});

test('un email qui part porte le lien de desinscription et les en-tetes RFC 8058', async () => {
  sent.length = 0;
  state.optouts.length = 0;

  const result = await sendPersonalEmail('u1', {
    to: 'ok@prospect.fr', toName: 'Client', subject: 'Suite à notre échange', body: 'Bonjour,\n\nOn en reparle ?',
  });

  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
  const mail = sent[0];

  assert.match(mail.text, /\/api\/public\/unsubscribe\?token=/);
  assert.match(mail.headers['List-Unsubscribe'], /^<https:\/\/app\.example\.test\/api\/public\/unsubscribe\?token=.+>$/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Le corps écrit par l'utilisateur reste intact devant le pied.
  assert.ok(mail.text.startsWith('Bonjour,\n\nOn en reparle ?'));
});

test('l adresse du destinataire ne circule pas dans le lien envoye', async () => {
  sent.length = 0;
  state.optouts.length = 0;

  await sendPersonalEmail('u1', {
    to: 'jean.martin@grosclient.fr', subject: 'Relance', body: 'Bonjour',
  });

  const mail = sent[0];
  const blob = `${mail.text} ${mail.headers['List-Unsubscribe']}`;
  // L'adresse figure légitimement dans `to`, c'est le destinataire. Elle ne
  // doit pas se retrouver dans ce qui sera recopié dans une URL.
  assert.ok(!blob.includes('jean.martin@grosclient.fr'));
  assert.ok(!blob.includes('jean.martin'));
});

test('le pied suit la langue du compte', async () => {
  sent.length = 0;
  state.optouts.length = 0;
  state.language = 'en';
  try {
    await sendPersonalEmail('u1', { to: 'uk@prospect.co.uk', subject: 'Hi', body: 'Hello' });
    assert.match(sent[0].text, /Don't want to hear from me again/);
  } finally {
    state.language = 'fr';
  }
});

test('avec une signature, le pied est ajoute au texte ET au HTML, apres la signature', async () => {
  sent.length = 0;
  state.optouts.length = 0;
  state.account.signature_text = 'Jean Vendeur\nMa Société';
  try {
    await sendPersonalEmail('u1', { to: 'sig@prospect.fr', subject: 'Objet', body: 'Corps du message' });

    const mail = sent[0];
    assert.ok(mail.html, 'la signature aurait dû produire une version HTML');
    assert.match(mail.html, /\/api\/public\/unsubscribe\?token=/);
    assert.match(mail.text, /\/api\/public\/unsubscribe\?token=/);

    // L'ordre compte : applySignature réécrit `text` à partir du corps brut.
    // Un pied ajouté avant elle serait effacé sans bruit.
    assert.ok(mail.text.indexOf('Ma Société') < mail.text.indexOf('/api/public/unsubscribe'),
      'le pied de désinscription passe avant la signature');
  } finally {
    state.account.signature_text = null;
  }
});

test('sans boite mail connectee, on echoue avant tout, sans rien envoyer', async () => {
  sent.length = 0;
  state.optouts.length = 0;
  const saved = state.account;
  state.account = null;
  try {
    const result = await sendPersonalEmail('u1', { to: 'x@y.fr', subject: 'S', body: 'B' });
    assert.equal(result.code, 'no_email_account');
    assert.equal(sent.length, 0);
  } finally {
    state.account = saved;
  }
});
