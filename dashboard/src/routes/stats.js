const express = require('express');
const { getTeamToken } = require('../config');
const { getStats } = require('../db');

const router = express.Router();

router.get('/api/stats', (req, res) => {
  if (req.headers['x-team-token'] !== getTeamToken()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const stats = getStats(req.db);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
