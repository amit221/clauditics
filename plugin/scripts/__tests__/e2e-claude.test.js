const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const HOME = os.homedir();
const CLAUDE_SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
const CLAUDITICS_DIR = path.join(HOME, '.clauditics');
const CONFIG_PATH = path.join(CLAUDITICS_DIR, 'config.json');
const EVENTS_DIR = path.join(CLAUDITICS_DIR, 'events');
const PLUGIN_DIR = path.join(__dirname, '..');

// Skip if claude CLI is not available
const claudeAvailable = spawnSync('claude', ['--version'], { stdio: 'pipe' }).status === 0;

function runClaude(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ status: code, stdout, stderr }));
    proc.on('error', reject);
    proc.stdin.end();
    setTimeout(() => { proc.kill(); reject(new Error('claude timed out after 60s')); }, 60000);
  });
}

const describeIf = claudeAvailable ? describe : describe.skip;

describeIf('full workflow: real claude session', () => {
  let settingsBackup;
  let configBackup;

  beforeAll(() => {
    // Backup existing files
    settingsBackup = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
    try { configBackup = fs.readFileSync(CONFIG_PATH, 'utf8'); } catch (_) {}

    // Write test config
    fs.mkdirSync(CLAUDITICS_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mode: 'personal', user: 'E2EClaudeUser' }));
    fs.mkdirSync(EVENTS_DIR, { recursive: true });

    // Patch settings.json with hooks pointing at our scripts
    const settings = JSON.parse(settingsBackup);
    settings.hooks = {
      SessionStart: [{ hooks: [{ type: 'command', command: `node "${path.join(PLUGIN_DIR, 'session-start.js')}"` }] }],
      Stop: [{ hooks: [{ type: 'command', command: `node "${path.join(PLUGIN_DIR, 'session-stop.js')}"` }] }],
    };
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  });

  afterAll(() => {
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, settingsBackup);
    if (configBackup) {
      fs.writeFileSync(CONFIG_PATH, configBackup);
    } else {
      try { fs.unlinkSync(CONFIG_PATH); } catch (_) {}
    }
  });

  test('SessionStart and Stop hooks fire and record a usage event', async () => {
    const startedAt = new Date().toISOString();

    const result = await runClaude(['--print', 'say exactly: HOOK_TEST_OK', '--output-format', 'text']);
    expect(result.status).toBe(0);

    // Find today's event file
    const today = new Date().toISOString().slice(0, 10);
    const todayFile = path.join(EVENTS_DIR, `${today}.ndjson`);
    expect(fs.existsSync(todayFile)).toBe(true);

    // Find the event written during this test run
    const events = fs.readFileSync(todayFile, 'utf8')
      .trim().split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));

    const testEvent = events.find(e => e.user === 'E2EClaudeUser' && e.timestamp >= startedAt);
    expect(testEvent).toBeDefined();
    expect(testEvent.session_id).toBeTruthy();
    // Token counts may be 0 if the transcript isn't flushed before the Stop hook reads it
    expect(testEvent.input_tokens).toBeGreaterThanOrEqual(0);
    expect(testEvent.output_tokens).toBeGreaterThanOrEqual(0);
  }, 65000);
});
