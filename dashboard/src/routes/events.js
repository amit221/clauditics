const express = require('express');
const { getTeamToken } = require('../config');
const { insertEvent, insertMember } = require('../db');

const router = express.Router();

function validateToken(req, res) {
  if (req.headers['x-team-token'] !== getTeamToken()) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

router.post('/events', (req, res) => {
  if (!validateToken(req, res)) return;
  const { session_id, user, model, input_tokens, output_tokens, timestamp } = req.body;
  if (!session_id || !user || !model || input_tokens == null || output_tokens == null || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    insertEvent(req.db, { session_id, user, model, input_tokens, output_tokens, timestamp });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify', (req, res) => {
  if (!validateToken(req, res)) return;
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'Missing user' });
  try {
    insertMember(req.db, user);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
