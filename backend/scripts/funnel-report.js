/**
 * Funnel d'activation — lecture de product_events (migration 071).
 *
 * Usage : railway run node scripts/funnel-report.js [semaines]
 * (défaut : 4 dernières semaines)
 *
 * Affiche par semaine : signups → wizard terminé → CRM connecté →
 * import réussi, plus les points de friction (clés refusées, imports ratés,
 * wizard abandonné).
 */

const db = require('../db');

const WEEKS = Math.max(1, parseInt(process.argv[2], 10) || 4);

const FUNNEL = ['signup', 'onboarding_complete', 'crm_connected', 'import_done'];
const FRICTION = ['crm_key_invalid', 'import_failed', 'wizard_skipped'];

async function main() {
  const { rows } = await db.query(`
    SELECT date_trunc('week', created_at)::date AS week, event,
           COUNT(DISTINCT user_id) AS users, COUNT(*) AS events
    FROM product_events
    WHERE created_at > NOW() - ($1 || ' weeks')::interval
    GROUP BY 1, 2
    ORDER BY 1 DESC
  `, [String(WEEKS)]);

  if (rows.length === 0) {
    console.log(`Aucun événement sur les ${WEEKS} dernières semaines.`);
    return;
  }

  const byWeek = new Map();
  for (const r of rows) {
    const key = r.week.toISOString().slice(0, 10);
    if (!byWeek.has(key)) byWeek.set(key, {});
    byWeek.get(key)[r.event] = { users: parseInt(r.users), events: parseInt(r.events) };
  }

  for (const [week, events] of byWeek) {
    console.log(`\n== Semaine du ${week} ==`);
    let prev = null;
    for (const step of FUNNEL) {
      const n = events[step]?.users || 0;
      const drop = prev !== null && prev > 0
        ? ` (${Math.round((n / prev) * 100)}% de l'étape précédente)`
        : '';
      console.log(`  ${step.padEnd(22)} ${String(n).padStart(4)} utilisateurs${drop}`);
      prev = n;
    }
    const frictions = FRICTION
      .filter(e => events[e])
      .map(e => `${e}: ${events[e].events}`);
    if (frictions.length) console.log(`  friction — ${frictions.join(', ')}`);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
