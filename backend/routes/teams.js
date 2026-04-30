/**
 * Team Routes
 *
 * POST /api/teams                  — Create a team (user becomes admin)
 * GET  /api/teams/me               — Get current user's team
 * GET  /api/teams/:id/members      — List team members
 * POST /api/teams/join/:code       — Join a team via invite link
 * PATCH /api/teams/:id/members/:userId — Update member role (admin only)
 * DELETE /api/teams/:id/members/:userId — Remove member (admin only)
 * POST /api/teams/:id/regenerate-invite — Generate new invite code (admin only)
 */

const { Router } = require('express');
const db = require('../db');

const router = Router();

const VALID_ROLES = ['admin', 'prospection', 'activation', 'viewer'];

// POST /api/teams — Create team
router.post('/', async (req, res, next) => {
  try {
    // Check if user already has a team
    const existing = await db.teams.getByUser(req.user.id);
    if (existing) return res.status(400).json({ error: 'Vous appartenez d\u00E9j\u00E0 \u00E0 une \u00E9quipe' });

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Le nom de l\'\u00E9quipe est requis' });

    const team = await db.teams.create({ name, createdBy: req.user.id });

    // Migrate existing user data to team
    await db.teams.migrateUserData(team.id, req.user.id);

    const members = await db.teams.getMembers(team.id);
    res.status(201).json({ team, members });
  } catch (err) {
    next(err);
  }
});

// GET /api/teams/me — Get current user's team + members
router.get('/me', async (req, res, next) => {
  try {
    const team = await db.teams.getByUser(req.user.id);
    if (!team) return res.json({ team: null, members: [] });

    const members = await db.teams.getMembers(team.id);
    res.json({ team, members });
  } catch (err) {
    next(err);
  }
});

// GET /api/teams/:id/members (must be a member of the team)
router.get('/:id/members', async (req, res, next) => {
  try {
    // Verify requesting user belongs to this team
    const membership = await db.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (membership.rows.length === 0) return res.status(403).json({ error: 'Access denied' });

    const members = await db.teams.getMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// POST /api/teams/join/:code — Join via invite link
router.post('/join/:code', async (req, res, next) => {
  try {
    // Check if user already has a team
    const existing = await db.teams.getByUser(req.user.id);
    if (existing) return res.status(400).json({ error: 'Vous appartenez d\u00E9j\u00E0 \u00E0 une \u00E9quipe' });

    const team = await db.teams.getByInviteCode(req.params.code);
    if (!team) return res.status(404).json({ error: 'Code d\'invitation invalide' });

    const role = req.body.role || 'viewer';
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'R\u00F4le invalide' });

    await db.teams.addMember(team.id, req.user.id, role);

    // Migrate user data to team
    await db.teams.migrateUserData(team.id, req.user.id);

    const members = await db.teams.getMembers(team.id);
    res.json({ team, members, joined: true });
  } catch (err) {
    if (err.message.includes('maximum')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/teams/:id/members/:userId — Update role (admin only)
router.patch('/:id/members/:userId', async (req, res, next) => {
  try {
    const team = await db.teams.getByUser(req.user.id);
    if (!team || team.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });

    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'R\u00F4le invalide' });

    // Cannot demote the team creator
    const targetTeam = await db.teams.get(req.params.id);
    if (targetTeam.created_by === req.params.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Le cr\u00E9ateur de l\'\u00E9quipe doit rester admin' });
    }

    const member = await db.teams.updateMemberRole(req.params.id, req.params.userId, role);
    res.json({ member });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/teams/:id/members/:userId — Remove member (admin only)
router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const team = await db.teams.getByUser(req.user.id);
    if (!team || team.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });

    // Cannot remove the creator
    const targetTeam = await db.teams.get(req.params.id);
    if (targetTeam.created_by === req.params.userId) {
      return res.status(400).json({ error: 'Impossible de retirer le cr\u00E9ateur' });
    }

    await db.teams.removeMember(req.params.id, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/teams/:id/regenerate-invite — New invite code (admin only)
router.post('/:id/regenerate-invite', async (req, res, next) => {
  try {
    const team = await db.teams.getByUser(req.user.id);
    if (!team || team.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });

    const result = await db.query(
      `UPDATE teams SET invite_code = encode(gen_random_bytes(6), 'hex'), updated_at = now() WHERE id = $1 RETURNING invite_code`,
      [req.params.id]
    );
    res.json({ inviteCode: result.rows[0]?.invite_code });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
