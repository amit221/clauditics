const { readConfig, writeSessionCurrent } = require('./config');
const { logError } = require('./log');
const { postVerify } = require('./http');
const { flushQueue } = require('./queue');

async function run(payload) {
  const { session_id, model } = payload;

  await writeSessionCurrent({ session_id, model });

  const config = await readConfig();
  if (!config) {
    process.stdout.write('Clauditics: no config found. Run /clauditics:setup to get started.\n');
    return;
  }

  if (config.mode === 'owner' || config.mode === 'member') {
    const result = await postVerify(config.serverUrl, config.teamToken, config.user);
    if (!result.ok) {
      await logError('session-start', `verify failed (status ${result.status || result.error})`);
    }
    await flushQueue(config.serverUrl, config.teamToken);
  }
}

// Entry point when called as a hook script
if (require.main === module) {
  (async () => {
    try {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      await run(payload);
    } catch (err) {
      const { logError } = require('./log');
      await logError('session-start', err.message);
    }
    process.exit(0);
  })();
}

module.exports = { run };
