// Set ALL env vars BEFORE requiring any modules that read them at load time
process.env.CLAUDITICS_DB = ':memory:';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Write e2e server config and set env var BEFORE loading dashboard modules
const E2E_SERVER_CONFIG = path.join(os.tmpdir(), 'e2e-server-config.json');
fs.writeFileSync(E2E_SERVER_CONFIG, JSON.stringify({ teamToken: 'e2e-token', port: 0 }));
process.env.CLAUDITICS_SERVER_CONFIG = E2E_SERVER_CONFIG;

// Now safe to require dashboard modules (config.js will use CLAUDITICS_SERVER_CONFIG)
const { spawn } = require('child_process');
const http = require('http');
const express = require('express');
const { initDb } = require('../db');
const eventsRouter = require('../routes/events');

const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'plugin', 'scripts', 'session-stop.js');

function runSessionStop(payload, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SCRIPT_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ status: code, stdout, stderr }));
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
    setTimeout(() => { proc.kill(); reject(new Error('session-stop timeout')); }, 10000);
  });
}

function writeTestFiles(configDir, config, sessionId, transcriptPath) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(configDir, 'session-current.json'), JSON.stringify({ session_id: sessionId, model: 'claude-sonnet-4-6' }));
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 500, output_tokens: 200 } } }));
}

describe('end-to-end: team mode — session-stop -> POST /events -> DB', () => {
  let server, db, port;

  beforeAll(done => {
    db = initDb();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.db = db; next(); });
    app.use(eventsRouter);
    server = http.createServer(app);
    server.listen(0, () => { port = server.address().port; done(); });
  });

  afterAll(done => { server.close(done); db.close(); });

  test('member mode: POSTs event to server and it lands in DB', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-member-'));
    const configDir = path.join(homeDir, '.clauditics');
    const transcriptPath = path.join(os.tmpdir(), 'e2e-member-transcript.jsonl');

    writeTestFiles(configDir,
      { mode: 'member', user: 'MemberUser', serverUrl: `http://localhost:${port}`, teamToken: 'e2e-token' },
      'member-session-1', transcriptPath
    );

    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    const result = await runSessionStop({ session_id: 'member-session-1', transcript_path: transcriptPath, hook_event_name: 'Stop' }, env);

    expect(result.status).toBe(0);
    const rows = db.prepare('SELECT * FROM events WHERE user = ?').all('MemberUser');
    expect(rows).toHaveLength(1);
    expect(rows[0].input_tokens).toBe(500);
    expect(rows[0].output_tokens).toBe(200);
  });
});

describe('end-to-end: personal mode — session-stop -> local NDJSON file', () => {
  test('personal mode: writes event to local NDJSON file', async () => {
    // Use a unique dir each run so appendFile doesn't accumulate stale events
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-personal-'));
    const configDir = path.join(homeDir, '.clauditics');
    const transcriptPath = path.join(os.tmpdir(), 'e2e-personal-transcript.jsonl');

    writeTestFiles(configDir,
      { mode: 'personal', user: 'PersonalUser' },
      'personal-session-1', transcriptPath
    );

    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    const result = await runSessionStop({ session_id: 'personal-session-1', transcript_path: transcriptPath, hook_event_name: 'Stop' }, env);

    expect(result.status).toBe(0);

    // Verify a dated NDJSON file was created in ~/.clauditics/events/
    const eventsDir = path.join(configDir, 'events');
    const files = fs.readdirSync(eventsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.ndjson$/);

    const eventLine = fs.readFileSync(path.join(eventsDir, files[0]), 'utf8').trim();
    const event = JSON.parse(eventLine);
    expect(event.user).toBe('PersonalUser');
    expect(event.input_tokens).toBe(500);
    expect(event.output_tokens).toBe(200);
    expect(event.model).toBe('claude-sonnet-4-6');
  });
});
