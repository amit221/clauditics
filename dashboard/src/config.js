const os = require('os');
const path = require('path');
const fs = require('fs');

const SERVER_CONFIG_PATH = process.env.CLAUDITICS_SERVER_CONFIG ||
  path.join(os.homedir(), '.clauditics', 'server-config.json');

let _config = null;

function loadConfig() {
  if (_config) return _config;
  try {
    _config = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read server config at ${SERVER_CONFIG_PATH}: ${err.message}`);
  }
  return _config;
}

function getTeamToken() {
  return loadConfig().teamToken;
}

function getPort() {
  return loadConfig().port || 3000;
}

module.exports = { getTeamToken, getPort };
