const { getTeamToken } = require('../config');

function auth(req, res, next) {
  const token = req.headers['x-team-token'];
  if (!token || token !== getTeamToken()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = auth;
