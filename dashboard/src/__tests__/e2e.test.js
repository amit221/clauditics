// Set ALL env vars BEFORE requiring any modules that read them at load time
process.env.CLAUDITICS_DB = ':memory:';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Write e2e server config and set env var BEFORE loading dashboard modules
const E2E_SERVER_CONFIG = path.join(os.tmpdir(), 'e2e-server-config.json');
fs.writeFileSync(E2E_SERVER_CONFIG, JSON.stringify({ teamToken: 'e2e-token', port: 0 }));
process.env.CLAUDITICS_SERVER_CONFIG = E2E_SERVER_CONFIG;

// Now safe to require dashboard modules
const { spawn } = require('child_process');
const http = require('http');
const express = require('express');
const { initDb } = require('../db');
const eventsRouter = require('../routes/events');

const PLUGIN_DIR = path.join(__dirname, '..', '..', '..', 'plugin', 'scripts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runHook(scriptName, payload, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(PLUGIN_DIR, scriptName)], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ status: code, stdout, stderr }));
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
    setTimeout(() => { proc.kill(); reject(new Error(`${scriptName} timed out`)); }, 10000);
  });
}

function makeTranscript(transcriptPath, inputTokens = 500, outputTokens = 200) {
  fs.writeFileSync(transcriptPath, JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-sonnet-4-6', usage: { input_tokens: inputTokens, output_tokens: outputTokens } },
  }));
}

function makeEnv(homeDir) {
  return { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
}

function startServer(db) {
  return new Promise(resolve => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.db = db; next(); });
    app.use(eventsRouter);
    const server = http.createServer(app);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Full workflow: personal mode
// SessionStart -> (transcript exists) -> Stop -> local NDJSON file
// ---------------------------------------------------------------------------
describe('full workflow: personal mode', () => {
  test('session-start writes session-current.json, session-stop writes local NDJSON event', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-full-personal-'));
    const clauditicsDir = path.join(homeDir, '.clauditics');
    const transcriptPath = path.join(homeDir, 'transcript.jsonl');

    // Only write config — no session-current.json (session-start must create it)
    fs.mkdirSync(clauditicsDir, { recursive: true });
    fs.writeFileSync(path.join(clauditicsDir, 'config.json'), JSON.stringify({
      mode: 'personal', user: 'FullPersonalUser',
    }));
    makeTranscript(transcriptPath);

    const env = makeEnv(homeDir);
    const sessionId = 'full-personal-session-1';
    const model = 'claude-sonnet-4-6';

    // 1. Run SessionStart hook
    const startResult = await runHook('session-start.js',
      { session_id: sessionId, model, transcript_path: transcriptPath, hook_event_name: 'SessionStart' },
      env
    );
    expect(startResult.status).toBe(0);

    // session-current.json must now exist
    const sessionCurrent = JSON.parse(fs.readFileSync(path.join(clauditicsDir, 'session-current.json'), 'utf8'));
    expect(sessionCurrent.session_id).toBe(sessionId);
    expect(sessionCurrent.model).toBe(model);

    // 2. Run Stop hook
    const stopResult = await runHook('session-stop.js',
      { session_id: sessionId, transcript_path: transcriptPath, hook_event_name: 'Stop' },
      env
    );
    expect(stopResult.status).toBe(0);

    // session-current.json must be deleted
    expect(fs.existsSync(path.join(clauditicsDir, 'session-current.json'))).toBe(false);

    // A dated NDJSON event file must exist
    const eventsDir = path.join(clauditicsDir, 'events');
    const files = fs.readdirSync(eventsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.ndjson$/);

    const event = JSON.parse(fs.readFileSync(path.join(eventsDir, files[0]), 'utf8').trim());
    expect(event.user).toBe('FullPersonalUser');
    expect(event.session_id).toBe(sessionId);
    expect(event.model).toBe(model);
    expect(event.input_tokens).toBe(500);
    expect(event.output_tokens).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Full workflow: team member mode
// SessionStart (verifies with server) -> Stop (POSTs event) -> DB
// ---------------------------------------------------------------------------
describe('full workflow: team member mode', () => {
  let server, db, port;

  beforeAll(async () => {
    db = initDb();
    ({ server, port } = await startServer(db));
  });

  afterAll(done => { server.close(done); db.close(); });

  test('session-start verifies member; session-stop POSTs event to server', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-full-member-'));
    const clauditicsDir = path.join(homeDir, '.clauditics');
    const transcriptPath = path.join(homeDir, 'transcript.jsonl');

    fs.mkdirSync(clauditicsDir, { recursive: true });
    fs.writeFileSync(path.join(clauditicsDir, 'config.json'), JSON.stringify({
      mode: 'member', user: 'FullMemberUser',
      serverUrl: `http://localhost:${port}`, teamToken: 'e2e-token',
    }));
    makeTranscript(transcriptPath, 1200, 340);

    const env = makeEnv(homeDir);
    const sessionId = 'full-member-session-1';

    // 1. Run SessionStart — should /verify with server (registers member)
    const startResult = await runHook('session-start.js',
      { session_id: sessionId, model: 'claude-sonnet-4-6', transcript_path: transcriptPath, hook_event_name: 'SessionStart' },
      env
    );
    expect(startResult.status).toBe(0);

    // Member should now be registered in the server DB
    const members = db.prepare('SELECT * FROM members WHERE user = ?').all('FullMemberUser');
    expect(members).toHaveLength(1);

    // session-current.json written by session-start
    expect(fs.existsSync(path.join(clauditicsDir, 'session-current.json'))).toBe(true);

    // 2. Run Stop hook — should POST event to server
    const stopResult = await runHook('session-stop.js',
      { session_id: sessionId, transcript_path: transcriptPath, hook_event_name: 'Stop' },
      env
    );
    expect(stopResult.status).toBe(0);

    // Event must be in the server DB
    const events = db.prepare('SELECT * FROM events WHERE user = ?').all('FullMemberUser');
    expect(events).toHaveLength(1);
    expect(events[0].session_id).toBe(sessionId);
    expect(events[0].input_tokens).toBe(1200);
    expect(events[0].output_tokens).toBe(340);

    // session-current.json must be cleaned up
    expect(fs.existsSync(path.join(clauditicsDir, 'session-current.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full workflow: queue retry
// Stop with server DOWN -> event queued
// SessionStart with server UP -> queue flushed -> event lands in DB
// ---------------------------------------------------------------------------
describe('full workflow: queue retry', () => {
  let server, db, port;

  beforeAll(async () => {
    db = initDb();
    ({ server, port } = await startServer(db));
  });

  afterAll(done => { server.close(done); db.close(); });

  test('failed POST is queued; next session-start flushes queue to server', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-queue-'));
    const clauditicsDir = path.join(homeDir, '.clauditics');
    const transcriptPath = path.join(homeDir, 'transcript.jsonl');

    fs.mkdirSync(clauditicsDir, { recursive: true });
    makeTranscript(transcriptPath, 800, 150);

    // Point config at a port that is NOT listening (server down)
    fs.writeFileSync(path.join(clauditicsDir, 'config.json'), JSON.stringify({
      mode: 'member', user: 'QueueUser',
      serverUrl: 'http://localhost:19999', teamToken: 'e2e-token',
    }));
    // Manually write session-current.json (simulating a prior session-start)
    fs.writeFileSync(path.join(clauditicsDir, 'session-current.json'), JSON.stringify({
      session_id: 'queue-session-1', model: 'claude-sonnet-4-6',
    }));

    const env = makeEnv(homeDir);

    // 1. Run Stop with server down — POST must fail, event must be queued
    const stopResult = await runHook('session-stop.js',
      { session_id: 'queue-session-1', transcript_path: transcriptPath, hook_event_name: 'Stop' },
      env
    );
    expect(stopResult.status).toBe(0);

    // DB must still be empty (server was unreachable)
    expect(db.prepare('SELECT * FROM events WHERE user = ?').all('QueueUser')).toHaveLength(0);

    // queue.ndjson must contain the failed event
    const queuePath = path.join(clauditicsDir, 'queue.ndjson');
    expect(fs.existsSync(queuePath)).toBe(true);
    const queued = JSON.parse(fs.readFileSync(queuePath, 'utf8').trim().split('\n')[0]);
    expect(queued.user).toBe('QueueUser');
    expect(queued.input_tokens).toBe(800);

    // 2. Update config to point at the real server (server back up)
    fs.writeFileSync(path.join(clauditicsDir, 'config.json'), JSON.stringify({
      mode: 'member', user: 'QueueUser',
      serverUrl: `http://localhost:${port}`, teamToken: 'e2e-token',
    }));

    // 3. Run SessionStart — flushQueue must POST the queued event
    const startResult = await runHook('session-start.js',
      { session_id: 'queue-session-2', model: 'claude-sonnet-4-6', transcript_path: transcriptPath, hook_event_name: 'SessionStart' },
      env
    );
    expect(startResult.status).toBe(0);

    // Queued event must now be in the DB
    const events = db.prepare('SELECT * FROM events WHERE user = ?').all('QueueUser');
    expect(events).toHaveLength(1);
    expect(events[0].input_tokens).toBe(800);

    // queue.ndjson must be empty after successful flush
    const queueContent = fs.readFileSync(queuePath, 'utf8').trim();
    expect(queueContent).toBe('');
  });
});
