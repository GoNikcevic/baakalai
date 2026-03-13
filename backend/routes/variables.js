const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/variables — list user's custom variables
router.get('/', async (req, res, next) => {
  try {
    const variables = await db.customVariables.listByUser(req.user.id);
    res.json({ variables });
  } catch (err) {
    next(err);
  }
});

// POST /api/variables — create a custom variable
router.post('/', async (req, res, next) => {
  try {
    const { key, label, category, syncMode, defaultValue } = req.body;
    if (!key || !key.trim()) {
      return res.status(400).json({ error: 'Variable key is required' });
    }

    const variable = await db.customVariables.create(req.user.id, {
      key: key.trim(),
      label: label || key.trim(),
      category,
      syncMode,
      defaultValue,
    });
    res.status(201).json(variable);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette variable existe deja.' });
    }
    next(err);
  }
});

// DELETE /api/variables/:id — delete a custom variable
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await db.customVariables.delete(req.params.id, req.user.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Variable not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
