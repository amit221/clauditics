const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { readConfig, readSessionCurrent, deleteSessionCurrent, CLAUDITICS_DIR } = require('./config');
const { logError } = require('./log');
const { postEvent } = require('./http');
const { enqueue } = require('./queue');
const { parseTranscript } = require('./parse-transcript');

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function run(payload) {
  const { transcript_path } = payload;

  const session = await readSessionCurrent();
  if (!session) {
    await logError('session-stop', 'session-current.json missing — skipping event');
    return;
  }

  const { input_tokens, output_tokens } = await parseTranscript(transcript_path);

  const config = await readConfig();
  const user = config?.user || os.userInfo().username;

  const event = {
    session_id: session.session_id,
    user,
    model: session.model,
    input_tokens,
    output_tokens,
    timestamp: new Date().toISOString(),
  };

  if (!config || config.mode === 'personal') {
    const eventsDir = path.join(CLAUDITICS_DIR, 'events');
    await fs.mkdir(eventsDir, { recursive: true });
    await fs.appendFile(path.join(eventsDir, `${todayStr()}.ndjson`), JSON.stringify(event) + '\n');
  } else {
    const result = await postEvent(config.serverUrl, config.teamToken, event);
    if (!result.ok) {
      await enqueue(event);
    }
  }

  await deleteSessionCurrent();
}

if (require.main === module) {
  (async () => {
    try {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      await run(payload);
    } catch (err) {
      const { logError } = require('./log');
      await logError('session-stop', err.message);
    }
    process.exit(0);
  })();
}

module.exports = { run };
