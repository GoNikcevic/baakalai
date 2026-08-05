/**
 * Relance l'analyse CRM (syncCRM) pour un utilisateur et régénère les
 * patterns mémoire `source = 'crm_sync'` à partir du dataset courant.
 *
 * Usage (env prod via Railway) :
 *   railway run node scripts/refresh-crm-patterns.js <email|userId>
 *
 * À utiliser après une réparation de dataset (import, normalisation des
 * statuts, montants) : les patterns crm_sync sont des artefacts dérivés des
 * opportunités — quand les données changent, les conclusions doivent être
 * régénérées, sinon les agents lisent des constats périmés.
 */

const db = require('../db');
const { syncCRM } = require('../lib/crm-sync');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/refresh-crm-patterns.js <email|userId>');
    process.exit(1);
  }

  const result = await db.query(
    'SELECT id, email, active_crm_provider FROM users WHERE email = $1 OR id::text = $1',
    [arg]
  );
  if (!result.rows.length) {
    console.error(`Utilisateur introuvable: ${arg}`);
    process.exit(1);
  }
  const user = result.rows[0];
  console.log(`Utilisateur: ${user.email} (${user.id}) — CRM actif: ${user.active_crm_provider || 'auto'}`);

  const before = await db.query(
    "SELECT count(*) AS n FROM memory_patterns WHERE source = 'crm_sync'"
  );
  console.log(`Patterns crm_sync avant: ${before.rows[0].n}`);

  const out = await syncCRM(user.id);
  console.log(`syncCRM: ${out.deals} deals analysés, ${out.patterns} patterns créés`);

  const after = await db.query(`
    SELECT left(pattern, 100) AS pattern, category, confidence, shared,
           created_at AT TIME ZONE 'Europe/Paris' AS created_paris
    FROM memory_patterns
    WHERE source = 'crm_sync' AND created_at > now() - interval '10 minutes'
    ORDER BY created_at DESC
  `);
  for (const p of after.rows) {
    console.log(`  [${p.category}/${p.confidence}${p.shared ? '/partagé' : ''}] ${p.pattern}`);
  }

  await db.closeDb();
}

main().catch(err => { console.error(err); process.exit(1); });
