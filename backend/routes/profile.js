const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/profile — Return current user's profile
router.get('/', (req, res) => {
  const profile = db.profiles.get(req.user.id);
  res.json({ profile: profile || null });
});

// POST /api/profile — Create or update profile
router.post('/', (req, res) => {
  const data = {};
  const allowed = [
    'company', 'sector', 'website', 'team_size', 'description',
    'value_prop', 'social_proof', 'pain_points', 'objections',
    'persona_primary', 'persona_secondary', 'target_sectors',
    'target_size', 'target_zones', 'default_tone', 'default_formality',
    'avoid_words', 'signature_phrases',
  ];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      data[key] = req.body[key];
    }
  }

  const profile = db.profiles.upsert(req.user.id, data);
  res.json({ profile });
});

module.exports = router;
