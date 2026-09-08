/**
 * Tests de la frontière Activation / Prospection.
 *
 * Un prospect froid importé par une campagne de prospection porte un
 * `campaign_id`. Il ne doit jamais être sélectionné par les logiques
 * d'Activation, qui ne s'adressent qu'aux contacts venus du CRM : sinon il
 * reçoit une relance écrite pour un deal en cours alors qu'aucun échange
 * n'a eu lieu.
 */

const test = require('node:test');
const assert = require('node:assert');

const { isCrmContact, onlyCrmContacts } = require('../lib/crm-scope');
const { matchContacts } = require('../lib/trigger-matching');

const DAY = 86400000;
const NOW = Date.parse('2026-09-08T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

test('un contact sans campaign_id est un contact CRM', () => {
  assert.strictEqual(isCrmContact({ campaign_id: null }), true);
  assert.strictEqual(isCrmContact({}), true);
});

test('un prospect porteur d un campaign_id n est pas un contact CRM', () => {
  assert.strictEqual(isCrmContact({ campaign_id: 'c-1' }), false);
});

test('onlyCrmContacts ecarte les prospects de campagne', () => {
  const out = onlyCrmContacts([
    { id: 'crm', campaign_id: null },
    { id: 'prospect', campaign_id: 'c-1' },
  ]);
  assert.deepStrictEqual(out.map(o => o.id), ['crm']);
});

test('onlyCrmContacts tolere une liste absente', () => {
  assert.deepStrictEqual(onlyCrmContacts(null), []);
});

// ── Le vrai garde-fou : les triggers d'Activation ──────────────────────────

const stagnantOpps = [
  { id: 'deal-crm',  campaign_id: null,  status: 'open', last_activity_at: daysAgo(40) },
  { id: 'prospect',  campaign_id: 'c-1', status: 'new',  last_activity_at: daysAgo(40) },
];

test('deal_stagnant ne retient que le deal CRM, jamais le prospect froid', () => {
  const matched = matchContacts(
    { trigger_type: 'deal_stagnant', conditions: { days: 30 } },
    stagnantOpps,
    NOW
  );
  assert.deepStrictEqual(matched.map(o => o.id), ['deal-crm']);
});

test('inactive_contact ne retient que le contact CRM', () => {
  const matched = matchContacts(
    { trigger_type: 'inactive_contact', conditions: { days: 30 } },
    stagnantOpps,
    NOW
  );
  assert.deepStrictEqual(matched.map(o => o.id), ['deal-crm']);
});

test('deal_won ignore un prospect de campagne meme marque gagne', () => {
  const matched = matchContacts(
    { trigger_type: 'deal_won', conditions: { days: 1 } },
    [
      { id: 'client', campaign_id: null,  status: 'won', won_date: daysAgo(1) },
      { id: 'faux',   campaign_id: 'c-1', status: 'won', won_date: daysAgo(1) },
    ],
    NOW
  );
  assert.deepStrictEqual(matched.map(o => o.id), ['client']);
});

test('renewal_reminder ignore les prospects de campagne', () => {
  const matched = matchContacts(
    { trigger_type: 'renewal_reminder', conditions: { days: 30 } },
    [
      { id: 'client', campaign_id: null,  status: 'won', renewal_date: new Date(NOW + 10 * DAY).toISOString() },
      { id: 'faux',   campaign_id: 'c-1', status: 'won', renewal_date: new Date(NOW + 10 * DAY).toISOString() },
    ],
    NOW
  );
  assert.deepStrictEqual(matched.map(o => o.id), ['client']);
});

test('les types evalues en direct depuis le CRM renvoient toujours null', () => {
  const out = matchContacts({ trigger_type: 'newsletter_inactive', conditions: {} }, stagnantOpps, NOW);
  assert.strictEqual(out, null);
});
