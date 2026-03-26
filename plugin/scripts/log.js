const os = require('os');
const path = require('path');
const fs = require('fs/promises');

const ERRORS_LOG = path.join(os.homedir(), '.clauditics', 'errors.log');

async function logError(scriptName, message) {
  const line = `[${new Date().toISOString()}] [${scriptName}] ${message}\n`;
  try {
    await fs.appendFile(ERRORS_LOG, line);
  } catch (_) {
    // best-effort — never throw
  }
}

module.exports = { logError };
