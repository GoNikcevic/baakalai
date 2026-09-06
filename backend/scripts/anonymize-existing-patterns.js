#!/usr/bin/env node
/**
 * Reprise du passif : anonymise les patterns écrits avant la mise en place de
 * la rédaction au niveau du DAO (lib/anonymize.js).
 *
 * Sans argument : simulation, n'écrit rien.
 * Avec --apply  : applique les modifications.
 *
 * L'écriture passe volontairement par une requête SQL directe et non par
 * db.memoryPatterns.update() : ce dernier ré-anonymiserait le texte déjà
 * anonymisé, ce qui est inoffensif mais rend le compte de rédactions faux et
 * masquerait une éventuelle double application.
 *
 *   node scripts/anonymize-existing-patterns.js
 *   node scripts/anonymize-existing-patterns.js --apply
 */

const db = require('../db');
const anonymize = require('../lib/anonymize');

const APPLY = process.argv.includes('--apply');

async function main() {
  const lexicon = await anonymize.loadLexicon({ query: db.rawQuery || db.query });
  if (lexicon.size === 0) {
    console.error('Lexique vide — la rédaction serait incomplète. Abandon.');
    process.exit(1);
  }
  console.log(`Lexique : ${lexicon.size} termes\n`);

  const { rows } = await (db.rawQuery || db.query)(
    'SELECT id, pattern, data, shared FROM memory_patterns ORDER BY created_at'
  );
  console.log(`${rows.length} patterns a examiner${APPLY ? '' : ' (SIMULATION)'}\n`);

  let modifies = 0;
  let bloques = 0;
  let departages = 0;

  for (const row of rows) {
    const r = anonymize.anonymizePattern({ pattern: row.pattern, data: row.data }, lexicon);

    const texteChange = r.pattern !== row.pattern;
    const dataChange = JSON.stringify(r.data) !== JSON.stringify(row.data);
    const perdPartage = row.shared === true && !r.safeToShare;

    if (!texteChange && !dataChange && !perdPartage) {
      if (!r.safeToShare) bloques++;
      continue;
    }

    modifies++;
    if (!r.safeToShare) bloques++;
    if (perdPartage) departages++;

    console.log(`── ${row.id}`);
    if (texteChange) {
      console.log(`   avant : ${row.pattern}`);
      console.log(`   apres : ${r.pattern}`);
    }
    if (dataChange) console.log('   data  : rédigé');
    if (perdPartage) console.log('   shared: true -> false');
    if (r.residual.length) console.log(`   résidu: ${r.residual.join(', ')}`);
    console.log();

    if (APPLY) {
      await (db.rawQuery || db.query)(
        `UPDATE memory_patterns
            SET pattern = $1,
                data = $2,
                shared = CASE WHEN $3::boolean THEN shared ELSE false END
          WHERE id = $4`,
        [r.pattern, r.data ?? null, r.safeToShare, row.id]
      );
    }
  }

  console.log('─'.repeat(60));
  console.log(`Patterns modifies         : ${modifies}`);
  console.log(`Non partageables (résidu) : ${bloques} / ${rows.length}`);
  console.log(`Partage retiré            : ${departages}`);
  console.log(APPLY ? '\nApplique.' : '\nSimulation — relancer avec --apply pour ecrire.');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('ERREUR:', err.message); process.exit(1); });
