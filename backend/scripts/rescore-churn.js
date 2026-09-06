/**
 * Recalcule le churn score pour tous les utilisateurs après recalibrage
 * des pondérations (fallback stagnation multi-CRM + signal client silencieux).
 *
 * Usage : node scripts/rescore-churn.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { scoreAllForUser } = require('../lib/churn-scoring');

async function main() {
  const r = await db.query(
    `SELECT DISTINCT u.id, u.email FROM users u
     JOIN opportunities o ON o.user_id = u.id ORDER BY u.email`
  );
  console.log(`Rescore churn pour ${r.rows.length} utilisateur(s)…`);
  for (const u of r.rows) {
    try {
      const report = await scoreAllForUser(u.id, {});
      const stats = await db.query(
        `SELECT round(avg(churn_score),1) AS avg, max(churn_score) AS max,
                count(*) FILTER (WHERE churn_score >= 51) AS high,
                count(*) FILTER (WHERE churn_score >= 76) AS critical
         FROM opportunities WHERE user_id = $1`, [u.id]
      );
      const s = stats.rows[0];
      console.log(`  ${u.email}: ${report.scored} scorés, ${report.atRisk} à risque — avg=${s.avg} max=${s.max} high=${s.high} critical=${s.critical}`);
    } catch (err) {
      console.error(`  ${u.email}: ÉCHEC — ${err.message}`);
    }
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
