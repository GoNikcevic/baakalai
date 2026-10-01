/**
 * Upsell Detector Agent
 *
 * Identifies clients ready for upsell/cross-sell by analyzing:
 * - Won deals with high engagement
 * - Product lines assigned (cross-sell to unassigned lines)
 * - Time since deal won (maturity)
 * - Positive sentiment in recent interactions
 *
 * Outputs: ranked list of upsell opportunities
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { getTimingContext, getCopyContext, getPatternContext, getTeamId } = require('../email-context');

const DAY_MS = 86400000;

async function run(userId) {
  const report = { opportunities: [], errors: [] };

  try {
    const opps = await db.opportunities.listByUser(userId, 1000, 0);
    const won = opps.filter(o => o.status === 'won');

    if (won.length < 2) return report;

    // Load product lines
    const plResult = await db.query(
      `SELECT pl.id, pl.name FROM product_lines pl
       WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
      [userId]
    );
    const productLines = plResult.rows;

    // Load product line assignments
    const assignResult = await db.query(
      `SELECT opl.opportunity_id, opl.product_line_id FROM opportunity_product_lines opl
       JOIN opportunities o ON o.id = opl.opportunity_id
       WHERE o.user_id = $1`,
      [userId]
    );
    const assignsByOpp = new Map();
    for (const a of assignResult.rows) {
      if (!assignsByOpp.has(a.opportunity_id)) assignsByOpp.set(a.opportunity_id, []);
      assignsByOpp.get(a.opportunity_id).push(a.product_line_id);
    }

    // Load recent positive interactions
    const positiveEmails = await db.query(
      `SELECT opportunity_id, COUNT(*) as count FROM nurture_emails
       WHERE user_id = $1 AND sentiment = 'positive' AND created_at > now() - interval '90 days'
       GROUP BY opportunity_id`,
      [userId]
    );
    const positiveByOpp = new Map();
    for (const r of positiveEmails.rows) {
      positiveByOpp.set(r.opportunity_id, parseInt(r.count));
    }

    // ── Lot 5 : l'upsell se raisonne par SOCIÉTÉ ──
    //
    // Trois choses fausses tant qu'on raisonne par contact :
    //
    //   · une société à huit interlocuteurs gagnés produisait huit propositions
    //     d'upsell, donc huit emails au même domaine.
    //   · le cross-sell se calculait par personne : si Paul porte la ligne A et
    //     Marie la ligne B, chacun paraissait à qui il manque l'autre. La
    //     société, elle, possède déjà les deux.
    //   · « risque de churn faible » lisait le score du contact, qui ne dit rien
    //     de la santé de la relation commerciale.
    //
    // Et surtout, le signal canonique du produit devient enfin lisible : un
    // compte qui porte À LA FOIS une affaire gagnée et une affaire ouverte,
    // c'est la définition même de l'upsell (plan, en-tête de la migration 124).
    // Il était invisible par construction, puisque deux affaires ne tenaient pas
    // sur la ligne d'une seule personne.
    const comptes = new Map();
    try {
      const accRes = await db.query(
        `SELECT id, churn_score FROM accounts WHERE user_id = $1`, [userId]
      );
      for (const a of accRes.rows) comptes.set(a.id, { churnScore: a.churn_score, statuses: new Set() });

      const dealRes = await db.query(
        `SELECT account_id, status FROM deals WHERE user_id = $1 AND account_id IS NOT NULL`, [userId]
      );
      for (const d of dealRes.rows) comptes.get(d.account_id)?.statuses.add(d.status);
    } catch (err) {
      // Environnement en retard de migration : on retombe sur le raisonnement
      // par contact plutôt que de priver l'utilisateur de tout upsell.
      logger.warn('upsell-detector', `Lecture des comptes indisponible pour ${userId}: ${err.message}`);
    }

    // Un sujet = une société, ou un contact encore sans société rattachée.
    // `account_id` NULL veut dire « société inconnue », pas « même société » :
    // les regrouper n'en garderait qu'un pour toute la base.
    const sujets = [];
    const parCompte = new Map();
    for (const c of won) {
      if (!c.account_id || !comptes.has(c.account_id)) { sujets.push({ contacts: [c] }); continue; }
      if (!parCompte.has(c.account_id)) {
        const s = { accountId: c.account_id, contacts: [] };
        parCompte.set(c.account_id, s);
        sujets.push(s);
      }
      parCompte.get(c.account_id).contacts.push(c);
    }

    const now = Date.now();

    for (const sujet of sujets) {
      // L'email part vers une PERSONNE : l'interlocuteur principal élu par la
      // migration 125, sinon celui dont on sait qu'il lit encore.
      const client = sujet.contacts.find(c => c.is_primary_contact)
        || [...sujet.contacts].sort((a, b) =>
             new Date(b.last_activity_at || b.won_date || b.created_at || 0)
             - new Date(a.last_activity_at || a.won_date || a.created_at || 0))[0];

      const compte = sujet.accountId ? comptes.get(sujet.accountId) : null;
      // won_date is the precise signal (set by CRM sync at the moment a deal transitions to
      // won); last_activity_at is a reasonable fallback for legacy won deals that predate it.
      // `updated_at` is reset to now() by a DB trigger on every internal write and must
      // never be used to measure maturity.
      // Maturité : le gain le PLUS RÉCENT de la société. Prendre le plus ancien
      // ferait passer pour mature une relation relancée le mois dernier.
      const wonReference = sujet.contacts
        .map(c => c.won_date || c.last_activity_at || c.created_at)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0] || client.created_at;
      const daysSinceWon = (now - new Date(wonReference).getTime()) / DAY_MS;

      // Union des lignes produit sur toute la société, pas sur une personne :
      // c'est le compte qui possède un produit, pas son interlocuteur.
      const assignedPLs = new Set();
      for (const c of sujet.contacts) {
        for (const pl of (assignsByOpp.get(c.id) || [])) assignedPLs.add(pl);
      }

      // Les interactions positives de tous les interlocuteurs comptent : la
      // relation est bonne avec la société, pas avec une seule personne.
      const positiveCount = sujet.contacts
        .reduce((n, c) => n + (positiveByOpp.get(c.id) || 0), 0);

      // Score upsell potential. `factors` mirrors churn-scoring.js's
      // {signal, weight, detail} shape so the frontend can render the same
      // score-breakdown UI as the churn-risk section · `reasons` (flat
      // strings) stays untouched alongside it for existing consumers.
      let score = 0;
      const reasons = [];
      const factors = [];
      let crossSellProducts = [];

      // Mature client (30+ days since won)
      if (daysSinceWon >= 30) {
        const detail = `Client depuis ${Math.round(daysSinceWon)}j`;
        score += 20; reasons.push(detail); factors.push({ signal: 'maturity_30d', weight: 20, detail });
      }
      if (daysSinceWon >= 90) {
        const detail = 'Client mature (90j+)';
        score += 10; reasons.push(detail); factors.push({ signal: 'maturity_90d', weight: 10, detail });
      }

      // Positive engagement
      if (positiveCount >= 2) {
        const detail = `${positiveCount} interactions positives`;
        score += 25; reasons.push(detail); factors.push({ signal: 'engagement', weight: 25, detail });
      } else if (positiveCount === 1) {
        const detail = '1 interaction positive';
        score += 10; reasons.push(detail); factors.push({ signal: 'engagement', weight: 10, detail });
      }

      // Cross-sell: not assigned to all product lines
      if (productLines.length > 1 && assignedPLs.size < productLines.length) {
        const unassigned = productLines.filter(pl => !assignedPLs.has(pl.id));
        crossSellProducts = unassigned.map(pl => pl.name);
        const weight = 15 * unassigned.length;
        const detail = `Cross-sell possible : ${crossSellProducts.join(', ')}`;
        score += weight; reasons.push(detail); factors.push({ signal: 'cross_sell', weight, detail });
      }

      // LE signal d'upsell du produit : la société a déjà acheté, et quelque
      // chose est en cours chez elle. Invisible avant le lot 4, puisque deux
      // affaires ne tenaient pas sur la ligne d'une seule personne.
      if (compte && compte.statuses.has('won') && compte.statuses.has('open')) {
        const detail = 'Affaire en cours chez un client deja gagne';
        score += 25; reasons.push(detail); factors.push({ signal: 'open_deal_alongside_won', weight: 25, detail });
      }

      // Risque de churn faible = bon candidat. Lu sur le COMPTE quand il existe :
      // le score d'une personne ne dit rien de la sante de la relation.
      const churnScore = compte && compte.churnScore != null ? compte.churnScore : client.churn_score;
      if (churnScore != null && churnScore < 30) {
        const detail = 'Risque churn faible';
        score += 15; reasons.push(detail); factors.push({ signal: 'low_churn', weight: 15, detail });
      }

      if (score >= 25) {
        const ownedProducts = [...assignedPLs]
          .map(id => productLines.find(pl => pl.id === id)?.name)
          .filter(Boolean);

        report.opportunities.push({
          contactId: client.id,
          // La société derrière la proposition, et le nombre d'interlocuteurs
          // qu'elle porte. NULL tant que le contact n'est rattaché à aucun
          // compte : l'écran du lot 7 doit pouvoir distinguer les deux.
          accountId: sujet.accountId || null,
          contactsInAccount: sujet.contacts.length,
          name: client.name,
          company: client.company,
          email: client.email,
          score,
          reasons,
          factors,
          ownedProducts,
          crossSellProducts,
          assignedProductLines: assignedPLs.length,
          totalProductLines: productLines.length,
        });
      }
    }

    // Sort by score desc
    report.opportunities.sort((a, b) => b.score - a.score);
    report.opportunities = report.opportunities.slice(0, 20);

    if (report.opportunities.length > 0) {
      logger.info('upsell-detector', `Found ${report.opportunities.length} upsell opportunities for user ${userId}`);
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('upsell-detector', err.message);
  }

  return report;
}

/**
 * On-demand upsell email draft for a SINGLE client (used by the "Voir le mail" on-demand
 * flow · no daily batch). Recomputes cross-sell context for just this client, then drafts
 * with one Claude call. Returns { opportunity, subject, body } or { error }.
 *
 * `angle` est l'axe choisi par l'utilisateur pendant le cadrage du chat. Sans lui, le
 * modèle choisit son propre angle et la question posée n'aurait servi à rien.
 */
async function draftOne(userId, opportunityId, { angle } = {}) {
  const oppResult = await db.query(
    'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
    [opportunityId, userId]
  );
  const opp = oppResult.rows[0];
  if (!opp) return { error: 'not_found' };
  if (opp.status !== 'won') return { error: 'not_eligible' };
  if (!opp.email) return { error: 'no_email' };

  let productLines = [];
  try {
    const plResult = await db.query(
      `SELECT pl.id, pl.name, pl.description FROM product_lines pl
       WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
      [userId]
    );
    productLines = plResult.rows;
  } catch { /* no product lines */ }

  const assignedPLIds = new Set();
  try {
    const assigns = await db.query(
      'SELECT product_line_id FROM opportunity_product_lines WHERE opportunity_id = $1',
      [opp.id]
    );
    assigns.rows.forEach(r => assignedPLIds.add(r.product_line_id));
  } catch { /* ok */ }
  const unassignedPLs = productLines.filter(pl => !assignedPLIds.has(pl.id));
  const crossSellContext = unassignedPLs.length > 0
    ? `Cross-sell products available: ${unassignedPLs.map(pl => `${pl.name} (${pl.description || ''})`).join(', ')}`
    : '';

  const [teamId] = await Promise.all([getTeamId(userId)]);
  const [timing, copyCtx, patternCtx] = await Promise.all([
    getTimingContext(userId),
    getCopyContext(userId),
    getPatternContext(teamId, userId),
  ]);

  const prompt = `Generate a personal upsell/cross-sell email for an existing client.

CONTEXT:
- Contact: ${opp.name} (${opp.title || 'N/A'}) at ${opp.company || 'N/A'}
- Client since: won deal
${crossSellContext ? `- ${crossSellContext}` : ''}

${copyCtx ? `COPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}
${timing.bestDay ? `\nBEST SEND TIMING: ${timing.bestDay}${timing.bestHour != null ? ` at ${timing.bestHour}h` : ''}` : ''}

${angle ? `ANGLE IMPOSÉ PAR L'UTILISATEUR (non négociable, construis l'email autour de ça) : ${angle}\n` : ''}
RULES:
- Max 6 lines, must sound human and personal
- Start by acknowledging the existing relationship (they are a client)
- Naturally introduce the upsell/cross-sell value proposition
- Tone: appreciative, not pushy, this is a valued client
- Do NOT mention scores or automated systems
${require('../human-style').HUMAN_STYLE_RULES}

Return JSON: { "subject": "...", "body": "..." }`;

  const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'upsell_draft_one');
  let email = result.parsed;
  if (!email) {
    const m = (result.raw || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (m) { try { email = JSON.parse(m[0]); } catch { email = null; } }
  }
  if (!email?.subject || !email?.body) return { error: 'generation_failed' };

  const { humanize } = require('../human-style');
  return {
    opportunity: opp,
    patternIds: patternCtx.ids,
    subject: humanize(email.subject),
    body: humanize(email.body),
    crossSellProducts: unassignedPLs.map(pl => pl.name),
  };
}

module.exports = { run, draftOne };
