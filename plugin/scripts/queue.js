const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { postEvent } = require('./http');

const CLAUDITICS_DIR = path.join(os.homedir(), '.clauditics');
const QUEUE_PATH = path.join(CLAUDITICS_DIR, 'queue.ndjson');

async function enqueue(event) {
  await fs.mkdir(CLAUDITICS_DIR, { recursive: true });
  await fs.appendFile(QUEUE_PATH, JSON.stringify(event) + '\n');
}

async function flushQueue(serverUrl, teamToken) {
  let raw;
  try {
    raw = await fs.readFile(QUEUE_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  const lines = raw.split('\n').filter(l => l.trim());
  const remaining = [];

  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch (_) { continue; }

    const result = await postEvent(serverUrl, teamToken, event);
    if (!result.ok) {
      remaining.push(line);
      // stop flushing — server still down, keep rest too
      const idx = lines.indexOf(line);
      remaining.push(...lines.slice(idx + 1));
      break;
    }
  }

  await fs.writeFile(QUEUE_PATH, remaining.map(l => l).join('\n') + (remaining.length ? '\n' : ''));
}

module.exports = { enqueue, flushQueue };
