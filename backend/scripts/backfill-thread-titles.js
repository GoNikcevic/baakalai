/**
 * Réécrit les titres des conversations existantes avec l'heuristique de
 * lib/chat-title.js.
 *
 * Les anciens titres sont les 60 premiers caractères bruts du premier message :
 * plusieurs conversations parties de la même suggestion portent exactement le
 * même libellé et la liste devient illisible. Le nouveau titrage ne s'applique
 * qu'aux conversations créées depuis la mise en service · ce script rattrape
 * l'existant.
 *
 * ⚠️ Le renommage manuel arrive dans la même livraison : ce script ne sait pas
 * distinguer un titre auto d'un titre choisi à la main, et les écraserait tous.
 * Il est donc à jouer UNE FOIS, juste après le déploiement, avant que
 * quiconque ait renommé quoi que ce soit.
 *
 * Usage :
 *   node scripts/backfill-thread-titles.js            (simulation, n'écrit rien)
 *   node scripts/backfill-thread-titles.js --apply    (écrit)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');
const { buildThreadTitle } = require('../lib/chat-title');

async function main() {
  const apply = process.argv.includes('--apply');

  // Le titre se déduit du premier message de l'utilisateur, celui-là même qui
  // avait servi à le fabriquer. Une conversation sans message garde son titre.
  const { rows } = await db.query(`
    SELECT t.id, t.title, m.content
      FROM chat_threads t
      JOIN LATERAL (
        SELECT content FROM chat_messages
         WHERE thread_id = t.id AND role = 'user'
         ORDER BY created_at ASC
         LIMIT 1
      ) m ON true
     ORDER BY t.updated_at DESC
  `);

  let changed = 0;
  for (const row of rows) {
    const next = buildThreadTitle(row.content);
    if (!next || next === row.title) continue;
    changed++;
    console.log(`- ${JSON.stringify(row.title)}\n+ ${JSON.stringify(next)}`);
    if (apply) await db.chatThreads.rename(row.id, next);
  }

  console.log(`\n${rows.length} conversations lues, ${changed} titres ${apply ? 'réécrits' : 'à réécrire (simulation)'}.`);
  if (!apply && changed > 0) console.log('Relancer avec --apply pour écrire.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
