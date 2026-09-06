const test = require('node:test');
const assert = require('node:assert');
const { computeFit } = require('../lib/contact-scoring');

const profile = { target_sectors: 'Finance, Santé, Télécom' };

test('le secteur du COMPTE (data.sector) déclenche le match, sans campagne', () => {
  const opp = { data: { sector: 'Finance' } };
  const { score, factors } = computeFit(opp, null, profile);
  assert.equal(score, 12);
  assert.equal(factors[0].signal, 'sector_match');
});

test('le secteur du compte prime sur celui de la campagne', () => {
  const opp = { data: { sector: 'Immobilier' } };
  const campaign = { sector: 'Finance' };
  const { score } = computeFit(opp, campaign, profile);
  assert.equal(score, 0, 'Immobilier ∉ ICP — le secteur campagne ne doit pas être utilisé');
});

test('fallback campagne quand le compte n a pas de secteur', () => {
  const { score } = computeFit({}, { sector: 'Santé' }, profile);
  assert.equal(score, 12);
});

test('match textuel insensible à la casse et aux sous-chaînes', () => {
  const { score } = computeFit({ data: { sector: 'santé' } }, null, profile);
  assert.equal(score, 12);
});

test('contexte normalisé : match via secteurs canoniques', () => {
  const sectorCtx = {
    targetSet: new Set(['Services financiers']),
    accountSectorMap: new Map([['Banque de détail', 'Services financiers']]),
  };
  const { score, factors } = computeFit({ data: { sector: 'Banque de détail' } }, null, profile, sectorCtx);
  assert.equal(score, 12);
  assert.match(factors[0].detail, /Services financiers/);
});

test('contexte normalisé : non_determine ne matche jamais', () => {
  const sectorCtx = {
    targetSet: new Set(['Services financiers']),
    accountSectorMap: new Map([['N/A', 'non_determine']]),
  };
  const { score } = computeFit({ data: { sector: 'N/A' } }, null, profile, sectorCtx);
  assert.equal(score, 0);
});

test('sans profil, fit = 0', () => {
  const { score } = computeFit({ data: { sector: 'Finance' } }, null, null);
  assert.equal(score, 0);
});
