/**
 * Backfill du lead score unifié (opportunities.score + score_breakdown).
 *
 * Le score n'était calculé qu'à la volée pour l'affichage analytics — jamais
 * persisté, donc NULL partout et absent des notes poussées vers le CRM.
 * Le cron quotidien (crm-agent Step 5c) le maintient désormais ; ce script
 * initialise l'existant.
 *
 * Usage : node scripts/backfill-lead-scores.js [email|userId]
 * Sans argument : tous les utilisateurs ayant des opportunités.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { scoreAllContacts } = require('../lib/contact-scoring');

async function backfillUser(userId, email) {
  const { contacts, avgScore, distribution } = await scoreAllContacts(userId);
  if (contacts.length === 0) {
    console.log(`  ${email || userId}: 0 contact`);
    return { scored: 0, updated: 0 };
  }
  const payload = JSON.stringify(contacts.map(c => ({
    id: c.id,
    score: c.score,
    breakdown: { ...c.breakdown, factors: c.factors },
  })));
  const updated = await db.query(
    `UPDATE opportunities o
     SET score = v.score, score_breakdown = v.breakdown
     FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, score int, breakdown jsonb)
     WHERE o.id = v.id AND o.user_id = $2
       AND o.score IS DISTINCT FROM v.score
     RETURNING o.id`,
    [payload, userId]
  );
  console.log(`  ${email || userId}: ${contacts.length} scorés, ${updated.rows.length} mis à jour, moyenne=${avgScore}, répartition=${JSON.stringify(distribution)}`);
  return { scored: contacts.length, updated: updated.rows.length };
}

async function main() {
  const arg = process.argv[2];
  let users;
  if (arg) {
    const r = await db.query(
      `SELECT id, email FROM users WHERE email = $1 OR id::text = $1`, [arg]
    );
    users = r.rows;
  } else {
    const r = await db.query(
      `SELECT DISTINCT u.id, u.email FROM users u
       JOIN opportunities o ON o.user_id = u.id ORDER BY u.email`
    );
    users = r.rows;
  }
  if (users.length === 0) {
    console.error('Aucun utilisateur trouvé.');
    process.exit(1);
  }
  console.log(`Backfill lead scores pour ${users.length} utilisateur(s)…`);
  let totalScored = 0, totalUpdated = 0;
  for (const u of users) {
    try {
      const r = await backfillUser(u.id, u.email);
      totalScored += r.scored;
      totalUpdated += r.updated;
    } catch (err) {
      console.error(`  ${u.email}: ÉCHEC — ${err.message}`);
    }
  }
  console.log(`Terminé : ${totalScored} scorés, ${totalUpdated} lignes mises à jour.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
