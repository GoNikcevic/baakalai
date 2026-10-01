/**
 * Premier passage du churn par COMPTE (lot 5, migration 131).
 *
 * Equivalent de rescore-churn.js un cran au-dessus. Il existe pour une raison
 * precise : le scoring de compte ne tourne qu'au Step 5 du CRM Agent, et
 * staging a ORCHESTRATOR_ENABLED=false. Sans ce script, la seule facon de voir
 * le lot 5 vivre serait d'attendre un passage en production.
 *
 * Il affiche AUSSI la comparaison compte / contact, parce que c'est elle qui
 * dit si l'arbitrage du 01/10 tient : le nombre de clients a risque doit
 * CHUTER en passant au compte. S'il monte, c'est que l'agregation s'est trompee
 * de sens et il faut regarder avant d'aller plus loin.
 *
 * Usage : node scripts/score-accounts.js [--dry]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { scoreAccountsForUser, AT_RISK_THRESHOLD } = require('../lib/churn-scoring');

const DRY = process.argv.includes('--dry');

async function main() {
  const r = await db.query(
    `SELECT DISTINCT u.id, u.email FROM users u
     JOIN accounts a ON a.user_id = u.id ORDER BY u.email`
  );

  if (r.rows.length === 0) {
    console.log('Aucun utilisateur ne porte de compte : rien a scorer.');
    process.exit(0);
  }

  console.log(`Churn par compte pour ${r.rows.length} utilisateur(s), seuil ${AT_RISK_THRESHOLD}${DRY ? ' [SIMULATION]' : ''}\n`);

  for (const u of r.rows) {
    try {
      // En simulation on ne scorera pas : on se contente de dire ce qui existe,
      // pour pouvoir verifier le peuplement avant d'ecrire quoi que ce soit.
      if (DRY) {
        const avant = await db.query(
          `SELECT count(*)::int AS comptes,
                  count(churn_score)::int AS deja_scores,
                  count(*) FILTER (WHERE churn_score >= $2)::int AS a_risque
             FROM accounts WHERE user_id = $1`,
          [u.id, AT_RISK_THRESHOLD]
        );
        const a = avant.rows[0];
        console.log(`  ${u.email}: ${a.comptes} comptes, ${a.deja_scores} deja scores, ${a.a_risque} a risque`);
        continue;
      }

      const rapport = await scoreAccountsForUser(u.id);

      const stats = await db.query(
        `SELECT round(avg(churn_score), 1) AS moyenne,
                max(churn_score) AS max,
                count(*) FILTER (WHERE churn_score >= 76)::int AS critiques,
                count(*) FILTER (WHERE churn_flagged_at IS NOT NULL)::int AS signales
           FROM accounts WHERE user_id = $1`,
        [u.id]
      );
      const s = stats.rows[0];

      // La comparaison qui valide ou invalide l'arbitrage.
      const contacts = await db.query(
        `SELECT count(*) FILTER (WHERE churn_score >= $2)::int AS contacts_a_risque,
                count(DISTINCT account_id) FILTER (WHERE churn_score >= $2 AND account_id IS NOT NULL)::int AS societes_derriere
           FROM opportunities WHERE user_id = $1`,
        [u.id, AT_RISK_THRESHOLD]
      );
      const c = contacts.rows[0];

      console.log(`  ${u.email}`);
      console.log(`    comptes : ${rapport.scored} scores, ${rapport.atRisk} a risque, ${s.signales} signales, moyenne ${s.moyenne}, max ${s.max}, ${s.critiques} critiques`);
      console.log(`    contacts : ${c.contacts_a_risque} a risque, repartis sur ${c.societes_derriere} societe(s)`);
      if (rapport.notScored > 0) {
        // Dette de rattachement du lot 2, pas un resultat de scoring. A dire
        // fort : sans ca elle se deguise en bonne sante moyenne.
        console.log(`    NON SCORES : ${rapport.notScored} compte(s) sans aucun contact rattache`);
      }
    } catch (err) {
      console.error(`  ${u.email}: ECHEC, ${err.message}`);
    }
  }

  console.log('');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
