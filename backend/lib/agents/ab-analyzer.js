/**
 * A/B Test Analyzer Agent
 *
 * Analyzes completed nurture A/B tests and:
 * 1. Declares a winner based on reply rate + sentiment
 * 2. Stores the winning approach as a memory pattern
 * 3. Updates trigger effectiveness
 *
 * Runs as part of the CRM Agent daily cycle.
 */

const db = require('../../db');
const logger = require('../logger');

const MIN_EMAILS_PER_VARIANT = 2;
const MIN_AGE_DAYS = 7;

/**
 * Two-proportion z-test. Returns p-value (one-tailed).
 * Used to determine if variant A vs B difference is statistically significant.
 */
function zTestPValue(successA, nA, successB, nB) {
  if (nA === 0 || nB === 0) return 1;
  const pA = successA / nA;
  const pB = successB / nB;
  const pPool = (successA + successB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  if (se === 0) return 1;
  const z = Math.abs(pA - pB) / se;
  // Abramowitz & Stegun approximation of one-tailed p-value
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804 * Math.exp(-0.5 * z * z);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return Math.max(0, Math.min(p, 1));
}

async function analyzeAbTests(userId) {
  const report = { analyzed: 0, winners: [], errors: [] };

  // Tenant des patterns (audit 02/09) : l'équipe si l'utilisateur en a une,
  // sinon l'utilisateur — jamais les deux (règle DAO, migration 089).
  // Résolu une seule fois par run, réutilisé pour chaque écriture.
  let tenant = { userId };
  try {
    const team = await db.teams.getByUser(userId);
    if (team) tenant = { teamId: team.id };
  } catch { /* résolution d'équipe indisponible : le pattern reste scopé user */ }

  try {
    // Find A/B groups old enough to analyze (7+ days)
    const groups = await db.query(`
      SELECT ab_group_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE variant = 'A') AS count_a,
        COUNT(*) FILTER (WHERE variant = 'B') AS count_b,
        COUNT(*) FILTER (WHERE variant = 'A' AND (replied_at IS NOT NULL OR sentiment = 'positive')) AS replies_a,
        COUNT(*) FILTER (WHERE variant = 'B' AND (replied_at IS NOT NULL OR sentiment = 'positive')) AS replies_b,
        MIN(created_at) AS first_sent
      FROM nurture_emails
      WHERE user_id = $1 AND ab_group_id IS NOT NULL AND status = 'sent'
      GROUP BY ab_group_id
      HAVING MIN(created_at) < now() - interval '${MIN_AGE_DAYS} days'
        AND COUNT(*) FILTER (WHERE variant = 'A') >= ${MIN_EMAILS_PER_VARIANT}
        AND COUNT(*) FILTER (WHERE variant = 'B') >= ${MIN_EMAILS_PER_VARIANT}
    `, [userId]);

    for (const g of groups.rows) {
      try {
        const rateA = g.count_a > 0 ? g.replies_a / g.count_a : 0;
        const rateB = g.count_b > 0 ? g.replies_b / g.count_b : 0;

        // Statistical significance test (p < 0.1 for small samples, p < 0.05 for larger)
        const pValue = zTestPValue(g.replies_a, g.count_a, g.replies_b, g.count_b);
        const threshold = g.total >= 20 ? 0.05 : 0.1;

        // Need either statistical significance OR a large gap with enough data
        if (pValue > threshold && (Math.abs(rateA - rateB) < 0.15 || g.total < 10)) continue;

        const winner = rateA >= rateB ? 'A' : 'B';
        const winnerRate = Math.round(Math.max(rateA, rateB) * 100);
        const loserRate = Math.round(Math.min(rateA, rateB) * 100);

        // Get the winning email sample
        const sample = await db.query(
          `SELECT subject, body FROM nurture_emails WHERE ab_group_id = $1 AND variant = $2 LIMIT 1`,
          [g.ab_group_id, winner]
        );
        const winningEmail = sample.rows[0];

        // Store as memory pattern
        if (winningEmail) {
          await db.memoryPatterns.replaceOrCreate({
            ...tenant,
            pattern: `A/B test: variant ${winner} gagne (${winnerRate}% vs ${loserRate}%). Sujet gagnant : "${winningEmail.subject}"`,
            category: 'S\u00e9quence',
            data: JSON.stringify({
              type: 'ab_test_result',
              abGroupId: g.ab_group_id,
              winner,
              rateA: Math.round(rateA * 100),
              rateB: Math.round(rateB * 100),
              pValue: Math.round(pValue * 1000) / 1000,
              winningSubject: winningEmail.subject,
              sampleSize: g.total,
            }),
            confidence: pValue < 0.05 ? 'Haute' : pValue < 0.1 ? 'Moyenne' : 'Faible',
            sectors: [], targets: [],
          });
        }

        report.winners.push({
          abGroupId: g.ab_group_id,
          winner,
          rateA: Math.round(rateA * 100),
          rateB: Math.round(rateB * 100),
          total: g.total,
        });
        report.analyzed++;

        logger.info('ab-analyzer', `A/B ${g.ab_group_id}: ${winner} wins (${winnerRate}% vs ${loserRate}%, n=${g.total}, p=${pValue.toFixed(3)})`);
      } catch (err) {
        report.errors.push(`${g.ab_group_id}: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('ab-analyzer', err.message);
  }

  return report;
}

module.exports = { analyzeAbTests };
