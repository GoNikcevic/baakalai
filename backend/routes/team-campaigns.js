/**
 * Team Campaigns Routes — Admin launches email campaigns for the sales team
 *
 * POST   /api/team-campaigns           — Create a team campaign
 * GET    /api/team-campaigns           — List team campaigns
 * GET    /api/team-campaigns/:id       — Get campaign details
 * POST   /api/team-campaigns/:id/preview — Preview: who gets emailed, sample emails
 * POST   /api/team-campaigns/:id/launch  — Launch: generate + send emails per owner
 * POST   /api/team-campaigns/:id/cancel  — Cancel a running campaign
 */

const { Router } = require('express');
const db = require('../db');
const claude = require('../api/claude');
const { sendNurtureEmail } = require('../lib/email-outbound');
const { getPatternContext } = require('../lib/email-context');
const logger = require('../lib/logger');

const router = Router();

/** Verify user belongs to the campaign's team. Returns campaign row or null. */
async function verifyCampaignAccess(campaignId, userId) {
  const result = await db.query(
    `SELECT tc.* FROM team_campaigns tc
     JOIN team_members tm ON tm.team_id = tc.team_id AND tm.user_id = $2
     WHERE tc.id = $1`,
    [campaignId, userId]
  );
  return result.rows[0] || null;
}

/** Check if user is admin of their team */
async function isTeamAdmin(userId) {
  const result = await db.query(
    `SELECT role FROM team_members WHERE user_id = $1 LIMIT 1`, [userId]
  );
  return !result.rows[0] || result.rows[0].role === 'admin';
}

// POST /api/team-campaigns — Create
router.post('/', async (req, res, next) => {
  try {
    const { name, targetOwners, targetProductLines, emailPrompt, emailTone } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Get team
    const teamResult = await db.query(
      `SELECT team_id, role FROM team_members WHERE user_id = $1 LIMIT 1`, [req.user.id]
    );
    const teamId = teamResult.rows[0]?.team_id;
    if (!teamId) return res.status(400).json({ error: 'No team found' });
    if (teamResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create team campaigns' });
    }

    const result = await db.query(`
      INSERT INTO team_campaigns (team_id, created_by, name, target_owners, target_product_lines, email_prompt, email_tone)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      teamId, req.user.id, name,
      targetOwners || '{}',
      targetProductLines || '{}',
      emailPrompt || null,
      emailTone || 'professional',
    ]);

    res.json({ campaign: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/team-campaigns — List
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT tc.*, u.name as created_by_name
      FROM team_campaigns tc
      JOIN users u ON u.id = tc.created_by
      WHERE tc.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)
      ORDER BY tc.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json({ campaigns: result.rows });
  } catch (err) { next(err); }
});

// GET /api/team-campaigns/:id — Details
router.get('/:id', async (req, res, next) => {
  try {
    const tc = await verifyCampaignAccess(req.params.id, req.user.id);
    if (!tc) return res.status(404).json({ error: 'Not found' });

    // Get emails for this campaign
    const emails = await db.query(`
      SELECT ne.*, u.name as owner_name, u.email as owner_email_addr
      FROM nurture_emails ne
      LEFT JOIN users u ON u.id = ne.user_id
      WHERE ne.team_campaign_id = $1
      ORDER BY ne.created_at DESC
    `, [req.params.id]);

    res.json({ campaign: tc, emails: emails.rows });
  } catch (err) { next(err); }
});

// POST /api/team-campaigns/:id/preview — Preview contacts grouped by owner (admin only)
router.post('/:id/preview', async (req, res, next) => {
  try {
    if (!await isTeamAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only' });
    const tc = await verifyCampaignAccess(req.params.id, req.user.id);
    if (!tc) return res.status(404).json({ error: 'Not found' });

    // Get matching contacts
    const contacts = await getTargetContacts(tc);

    // Même mémoire que le launch — la preview doit montrer ce qui partira vraiment
    const patternCtx = await getCampaignPatternContext(tc);

    // Group by owner
    const byOwner = new Map();
    for (const c of contacts) {
      const key = c.owner_id || 'unassigned';
      if (!byOwner.has(key)) byOwner.set(key, { ownerId: c.owner_id, ownerEmail: c.owner_email, contacts: [] });
      byOwner.get(key).contacts.push(c);
    }

    // Generate one sample email per owner group
    const previews = [];
    for (const [, group] of byOwner) {
      const sample = group.contacts[0];
      let sampleEmail = null;

      if (tc.email_prompt && sample) {
        try {
          const prompt = buildEmailPrompt(tc, sample, patternCtx);
          const result = await claude.callClaude('Return only valid JSON.', prompt, 500);
          if (result.parsed) sampleEmail = result.parsed;
          else {
            const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
            if (m) sampleEmail = JSON.parse(m[0]);
          }
        } catch { /* skip */ }
      }

      previews.push({
        ownerId: group.ownerId,
        ownerEmail: group.ownerEmail,
        contactCount: group.contacts.length,
        contacts: group.contacts.slice(0, 5).map(c => ({ id: c.id, name: c.name, email: c.email, company: c.company })),
        sampleEmail,
      });
    }

    // Update campaign total
    await db.query(
      `UPDATE team_campaigns SET total_contacts = $1 WHERE id = $2`,
      [contacts.length, tc.id]
    );

    res.json({ totalContacts: contacts.length, previews });
  } catch (err) { next(err); }
});

// POST /api/team-campaigns/:id/launch — Generate + send emails (admin only)
router.post('/:id/launch', async (req, res, next) => {
  try {
    if (!await isTeamAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only' });
    const tc = await verifyCampaignAccess(req.params.id, req.user.id);
    if (!tc) return res.status(404).json({ error: 'Not found' });

    if (tc.status === 'running') return res.status(400).json({ error: 'Campaign already running' });

    await db.query(`UPDATE team_campaigns SET status = 'running' WHERE id = $1`, [tc.id]);

    // Respond immediately — process in background
    res.status(202).json({ status: 'running', message: 'Campaign launched in background' });

    // Background processing
    (async () => {
      let sent = 0, failed = 0;
      try {
        const contacts = await getTargetContacts(tc);

        // Mémoire résolue une fois pour toute la campagne (mêmes patterns
        // pour chaque contact) — injectée dans les prompts et tracée en base
        // via patternIds pour que les réponses/réactivations créditent les
        // bons patterns.
        const patternCtx = await getCampaignPatternContext(tc);

        const recentEmails = await db.query(
          `SELECT DISTINCT to_email FROM nurture_emails WHERE team_campaign_id IS NOT NULL AND created_at > now() - interval '7 days'`
        );
        const recentSet = new Set(recentEmails.rows.map(r => r.to_email?.toLowerCase()));

        const toProcess = contacts.filter(c => c.email && !recentSet.has(c.email.toLowerCase()) && c.owner_id);

        // Process in batches of 5 (parallel within batch, sequential between batches)
        for (let i = 0; i < toProcess.length; i += 5) {
          // Check if cancelled
          if (i > 0 && i % 10 === 0) {
            const fresh = await db.query(`SELECT status FROM team_campaigns WHERE id = $1`, [tc.id]);
            if (fresh.rows[0]?.status === 'cancelled') break;
          }

          const batch = toProcess.slice(i, i + 5);
          const results = await Promise.allSettled(batch.map(async (contact) => {
            const prompt = buildEmailPrompt(tc, contact, patternCtx);
            const result = await claude.callClaude('Return only valid JSON.', prompt, 500);
            let email = result.parsed;
            if (!email) {
              const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
              if (m) { try { email = JSON.parse(m[0]); } catch { /* malformed AI response */ } }
            }
            if (!email?.subject || !email?.body) throw new Error('No email generated');

            return sendNurtureEmail(contact.owner_id, {
              to: contact.email, toName: contact.name,
              subject: email.subject, body: email.body,
              opportunityId: contact.id, teamCampaignId: tc.id,
              patternIds: patternCtx.ids,
            });
          }));

          for (const r of results) {
            if (r.status === 'fulfilled' && r.value?.success) sent++;
            else failed++;
          }

          // Update progress
          await db.query(
            `UPDATE team_campaigns SET sent_count = $1, failed_count = $2 WHERE id = $3`,
            [sent, failed, tc.id]
          );
        }
      } catch (err) {
        logger.error('team-campaigns', `Launch failed: ${err.message}`);
      }

      await db.query(
        `UPDATE team_campaigns SET status = 'completed', sent_count = $1, failed_count = $2, completed_at = now() WHERE id = $3`,
        [sent, failed, tc.id]
      );
      logger.info('team-campaigns', `Campaign ${tc.id} done: ${sent} sent, ${failed} failed`);
    })();
  } catch (err) {
    await db.query(`UPDATE team_campaigns SET status = 'draft' WHERE id = $1`, [req.params.id]).catch(() => {});
    next(err);
  }
});

// POST /api/team-campaigns/:id/cancel (admin only)
router.post('/:id/cancel', async (req, res, next) => {
  try {
    if (!await isTeamAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only' });
    const tc = await verifyCampaignAccess(req.params.id, req.user.id);
    if (!tc) return res.status(404).json({ error: 'Not found' });
    await db.query(
      `UPDATE team_campaigns SET status = 'cancelled' WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Helpers ──

async function getTargetContacts(tc) {
  const hasOwnerFilter = tc.target_owners && tc.target_owners.length > 0;
  const hasProductFilter = tc.target_product_lines && tc.target_product_lines.length > 0;

  let sql = `
    SELECT DISTINCT o.id, o.name, o.email, o.company, o.title, o.status,
           o.owner_id, o.owner_email, o.churn_score
    FROM opportunities o
  `;

  if (hasProductFilter) {
    sql += ` JOIN opportunity_product_lines opl ON opl.opportunity_id = o.id `;
  }

  sql += ` WHERE o.team_id = $1 AND o.email IS NOT NULL AND o.status != 'lost'`;

  const params = [tc.team_id];

  if (hasOwnerFilter) {
    params.push(tc.target_owners);
    sql += ` AND o.owner_id = ANY($${params.length})`;
  } else {
    sql += ` AND o.owner_id IS NOT NULL`;
  }

  if (hasProductFilter) {
    params.push(tc.target_product_lines);
    sql += ` AND opl.product_line_id = ANY($${params.length})`;
  }

  sql += ` ORDER BY o.name LIMIT 1000`;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Mémoire de l'équipe (c'est une campagne d'ÉQUIPE : le tenant est tc.team_id).
 * Best-effort — sans mémoire la campagne part quand même, elle n'apprend rien.
 */
async function getCampaignPatternContext(tc) {
  try {
    return await getPatternContext(tc.team_id);
  } catch {
    return { text: '', ids: [] };
  }
}

function buildEmailPrompt(tc, contact, patternCtx = null) {
  const context = [
    `Contact: ${contact.name}`,
    contact.title ? `Title: ${contact.title}` : null,
    contact.company ? `Company: ${contact.company}` : null,
    contact.status ? `Status: ${contact.status}` : null,
    contact.churn_score != null ? `Churn risk: ${contact.churn_score}/100` : null,
  ].filter(Boolean).join('\n');

  const customPrompt = tc.email_prompt || 'Write a professional follow-up email.';

  const patternsBlock = patternCtx?.text
    ? `\nPATTERNS THAT WORK (cross-campaign memory):\n${patternCtx.text}\nApply the APPROVED patterns first.\n`
    : '';

  return `Generate a personal email for this contact.

${context}
${patternsBlock}
Instructions: ${customPrompt}
Tone: ${tc.email_tone || 'professional'}
Max 6 lines, plain text, no HTML.
The email should look like it was written by the contact's account owner, not a marketing tool.

Return JSON: { "subject": "...", "body": "..." }`;
}

module.exports = router;
