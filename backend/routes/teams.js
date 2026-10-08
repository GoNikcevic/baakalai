/**
 * Team Routes
 *
 * POST /api/teams · Create a team (user becomes admin)
 * GET  /api/teams/me · Get current user's team
 * GET  /api/teams/:id/members · List team members
 * POST /api/teams/join/:code · Join a team via invite link
 * PATCH /api/teams/:id/members/:userId · Update member role (admin only)
 * DELETE /api/teams/:id/members/:userId · Remove member (admin only)
 * POST /api/teams/:id/regenerate-invite · Generate new invite code (admin only)
 */

const { Router } = require('express');
const db = require('../db');
const { logAudit } = require('../middleware/audit-log');

const router = Router();

const VALID_ROLES = ['admin', 'prospection', 'activation', 'viewer'];

/**
 * Garde admin : l'appelant doit être admin DE L'ÉQUIPE ciblée par `:id`.
 *
 * Le contrôle ne portait que sur le rôle : `getByUser` renvoie l'équipe de
 * l'appelant, puis les trois routes de gestion opéraient sur `req.params.id`
 * sans vérifier que c'est la même équipe. Un admin de l'équipe A pouvait donc,
 * en connaissant deux UUID, changer les rôles dans l'équipe B, en retirer des
 * membres, ou régénérer son lien d'invitation. Au passage, un `:id` inconnu
 * partait en 500 sur `targetTeam.created_by`.
 *
 * Renvoie l'équipe de l'appelant, ou null après avoir répondu.
 */
async function requireTeamAdmin(req, res) {
  const team = await db.teams.getByUser(req.user.id);
  if (!team || team.role !== 'admin') {
    res.status(403).json({ error: 'Admin uniquement' });
    return null;
  }
  // Comparaison insensible à la casse : les UUID sortent en minuscules de
  // Postgres, un appelant peut les envoyer autrement.
  if (String(team.id).toLowerCase() !== String(req.params.id).toLowerCase()) {
    res.status(403).json({ error: 'Cette équipe n\'est pas la vôtre' });
    return null;
  }
  return team;
}

// POST /api/teams · Create team
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

// GET /api/teams/me · Get current user's team + members
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

// POST /api/teams/join/:code · Join via invite link
router.post('/join/:code', async (req, res, next) => {
  try {
    // Check if user already has a team
    const existing = await db.teams.getByUser(req.user.id);
    if (existing) return res.status(400).json({ error: 'Vous appartenez d\u00E9j\u00E0 \u00E0 une \u00E9quipe' });

    const team = await db.teams.getByInviteCode(req.params.code);
    if (!team) return res.status(404).json({ error: 'Code d\'invitation invalide' });

    // Jamais admin via le lien d'invitation : le lien est diffusable et
    // n'expire pas, quiconque le poss\u00E8de pourrait sinon prendre le contr\u00F4le
    // de l'\u00E9quipe en appelant l'API directement (la page, elle, ne propose
    // que 3 r\u00F4les). Seul un admin existant peut promouvoir, via PATCH members.
    const role = req.body.role || 'viewer';
    if (!VALID_ROLES.includes(role) || role === 'admin') {
      return res.status(400).json({ error: 'R\u00F4le invalide' });
    }

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

// PATCH /api/teams/:id/members/:userId · Update role (admin only)
router.patch('/:id/members/:userId', async (req, res, next) => {
  try {
    const team = await requireTeamAdmin(req, res);
    if (!team) return;

    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'R\u00F4le invalide' });

    // Cannot demote the team creator
    if (team.created_by === req.params.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Le cr\u00E9ateur de l\'\u00E9quipe doit rester admin' });
    }

    // R\u00F4le avant modification : une ligne d'audit qui ne dit pas d'o\u00F9 l'on part
    // ne permet pas de reconstituer une escalade de privil\u00E8ge.
    const members = await db.teams.getMembers(req.params.id);
    const previousRole = members.find(m => m.user_id === req.params.userId)?.role || null;

    const member = await db.teams.updateMemberRole(req.params.id, req.params.userId, role);
    if (!member) return res.status(404).json({ error: 'Membre introuvable' });

    logAudit(req.user.id, 'team.role_change', 'team_member', req.params.userId, {
      team_id: req.params.id,
      from_role: previousRole,
      to_role: role,
    }, req);

    res.json({ member });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/teams/:id/members/:userId · Remove member (admin only)
router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const team = await requireTeamAdmin(req, res);
    if (!team) return;

    // Cannot remove the creator
    if (team.created_by === req.params.userId) {
      return res.status(400).json({ error: 'Impossible de retirer le cr\u00E9ateur' });
    }

    const members = await db.teams.getMembers(req.params.id);
    const removedRole = members.find(m => m.user_id === req.params.userId)?.role || null;

    await db.teams.removeMember(req.params.id, req.params.userId);

    logAudit(req.user.id, 'team.remove_member', 'team_member', req.params.userId, {
      team_id: req.params.id,
      removed_role: removedRole,
    }, req);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/teams/:id/regenerate-invite · New invite code (admin only)
router.post('/:id/regenerate-invite', async (req, res, next) => {
  try {
    const team = await requireTeamAdmin(req, res);
    if (!team) return;

    const result = await db.query(
      `UPDATE teams SET invite_code = encode(gen_random_bytes(6), 'hex'), updated_at = now() WHERE id = $1 RETURNING invite_code`,
      [req.params.id]
    );
    // Le code d'invitation est le secret qui fait entrer dans l'équipe : le
    // remplacer coupe l'accès à tous ceux qui détenaient l'ancien lien.
    logAudit(req.user.id, 'team.regenerate_invite', 'team', req.params.id, {}, req);

    res.json({ inviteCode: result.rows[0]?.invite_code });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
