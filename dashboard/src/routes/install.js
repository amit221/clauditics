const express = require('express');
const { getTeamToken, getPort } = require('../config');

const router = express.Router();

router.get('/install', (req, res) => {
  const token = req.query.token;
  if (!token || token !== getTeamToken()) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const serverUrl = process.env.CLAUDITICS_SERVER_URL || `http://localhost:${getPort()}`;
  res.json({ serverUrl, teamToken: getTeamToken() });
});

module.exports = router;
