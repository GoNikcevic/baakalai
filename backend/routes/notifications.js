/* ===============================================================================
   BAKAL — Notifications API
   CRUD endpoints for the in-app notification system.
   =============================================================================== */

const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/notifications — list recent notifications (paginated)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const notifications = await db.notifications.listByUser(req.user.id, limit, offset);
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread-count — count of unread notifications
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await db.notifications.countUnread(req.user.id);
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', async (req, res, next) => {
  try {
    await db.notifications.markAllRead(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notif = await db.notifications.markRead(req.params.id, req.user.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: notif });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
