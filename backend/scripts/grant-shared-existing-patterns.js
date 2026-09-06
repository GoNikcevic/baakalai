#!/usr/bin/env node
/**
 * Ouverture du pool global : accorde `shared = true` aux patterns existants
 * dont la rédaction est complète (politique du 2026-08-04 — voir
 * anonymizeBeforeWrite dans db/index.js). Les écritures futures sont couvertes
 * par le DAO ; ce script traite le stock écrit avant la mise en place.
 *
 * Pour chaque pattern, la rédaction est rejouée sur le texte courant :
 * - si elle trouve encore quelque chose à rédiger (lexique enrichi depuis la
 *   dernière passe), le texte est corrigé au passage ;
 * - `shared` n'est accordé que si le résultat est sans résidu, lexique chargé.
 *
 * Sans argument : simulation, n'écrit rien.
 * Avec --apply  : applique les modifications.
 *
 *   node scripts/grant-shared-existing-patterns.js
 *   node scripts/grant-shared-existing-patterns.js --apply
 */

const db = require('../db');
const anonymize = require('../lib/anonymize');

const APPLY = process.argv.includes('--apply');

async function main() {
  const lexicon = await anonymize.loadLexicon({ query: db.rawQuery || db.query });
  if (lexicon.size === 0) {
    console.error('Lexique vide — impossible de juger le partage. Abandon.');
    process.exit(1);
  }
  console.log(`Lexique : ${lexicon.size} termes\n`);

  const { rows } = await (db.rawQuery || db.query)(
    'SELECT id, pattern, data, shared FROM memory_patterns ORDER BY created_at'
  );
  console.log(`${rows.length} patterns a examiner${APPLY ? '' : ' (SIMULATION)'}\n`);

  let accordes = 0;
  let bloques = 0;
  let redigues = 0;

  for (const row of rows) {
    const r = anonymize.anonymizePattern({ pattern: row.pattern, data: row.data }, lexicon);

    const texteChange = r.pattern !== row.pattern;
    const dataChange = JSON.stringify(r.data) !== JSON.stringify(row.data);
    const accorde = r.safeToShare && row.shared !== true;

    if (!r.safeToShare) bloques++;
    if (!texteChange && !dataChange && !accorde) continue;

    if (accorde) accordes++;
    if (texteChange || dataChange) redigues++;

    console.log(`── ${row.id}`);
    if (texteChange) {
      console.log(`   avant : ${row.pattern}`);
      console.log(`   apres : ${r.pattern}`);
    }
    if (dataChange) console.log('   data  : rédigé');
    if (accorde) console.log('   shared: false -> true');
    if (r.residual.length) console.log(`   résidu: ${r.residual.join(', ')}`);
    console.log();

    if (APPLY) {
      await (db.rawQuery || db.query)(
        `UPDATE memory_patterns
            SET pattern = $1,
                data = $2,
                shared = $3
          WHERE id = $4`,
        [r.pattern, r.data ?? null, r.safeToShare === true, row.id]
      );
    }
  }

  console.log('─'.repeat(60));
  console.log(`Partage accordé           : ${accordes} / ${rows.length}`);
  console.log(`Rédaction complétée       : ${redigues}`);
  console.log(`Non partageables (résidu) : ${bloques} / ${rows.length}`);
  console.log(APPLY ? '\nApplique.' : '\nSimulation — relancer avec --apply pour ecrire.');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('ERREUR:', err.message); process.exit(1); });
