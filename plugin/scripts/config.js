const os = require('os');
const path = require('path');
const fs = require('fs/promises');

const CLAUDITICS_DIR = path.join(os.homedir(), '.clauditics');
const CONFIG_PATH = path.join(CLAUDITICS_DIR, 'config.json');
const SESSION_CURRENT_PATH = path.join(CLAUDITICS_DIR, 'session-current.json');

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeConfig(data) {
  await fs.mkdir(CLAUDITICS_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(data, null, 2));
}

async function readSessionCurrent() {
  try {
    const raw = await fs.readFile(SESSION_CURRENT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeSessionCurrent(data) {
  await fs.mkdir(CLAUDITICS_DIR, { recursive: true });
  await fs.writeFile(SESSION_CURRENT_PATH, JSON.stringify(data, null, 2));
}

async function deleteSessionCurrent() {
  await fs.unlink(SESSION_CURRENT_PATH);
}

module.exports = { CLAUDITICS_DIR, readConfig, writeConfig, readSessionCurrent, writeSessionCurrent, deleteSessionCurrent };
