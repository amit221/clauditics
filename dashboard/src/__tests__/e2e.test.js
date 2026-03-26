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

describe('end-to-end: session-stop -> POST /events -> DB', () => {
  let server, db, port;

  beforeAll(done => {
    db = initDb();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.db = db; next(); });
    app.use(eventsRouter);
    server = http.createServer(app);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(done => { server.close(done); db.close(); });

  test('session-stop script POSTs event to server and it lands in DB', async () => {
    // Write fake transcript
    const transcriptPath = path.join(os.tmpdir(), 'e2e-transcript.jsonl');
    const lines = [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 500, output_tokens: 200 } } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n'));

    // Write clauditics config pointing to our test server.
    const configDir = path.join(os.tmpdir(), '.clauditics');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ mode: 'member', user: 'E2EUser', serverUrl: `http://localhost:${port}`, teamToken: 'e2e-token' }));
    fs.writeFileSync(path.join(configDir, 'session-current.json'), JSON.stringify({ session_id: 'e2e-session', model: 'claude-sonnet-4-6' }));

    const stopPayload = JSON.stringify({ session_id: 'e2e-session', transcript_path: transcriptPath, hook_event_name: 'Stop' });
    const env = { ...process.env, HOME: os.tmpdir(), USERPROFILE: os.tmpdir() };

    const scriptPath = path.join(__dirname, '..', '..', '..', 'plugin', 'scripts', 'session-stop.js');

    // Use async spawn so the server event loop stays alive to handle the child's HTTP request
    const result = await new Promise((resolve, reject) => {
      const proc = spawn('node', [scriptPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => resolve({ status: code, stdout, stderr }));
      proc.on('error', reject);
      proc.stdin.write(stopPayload);
      proc.stdin.end();
      setTimeout(() => { proc.kill(); reject(new Error('session-stop timeout')); }, 10000);
    });

    expect(result.status).toBe(0);

    // Verify event in DB
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].user).toBe('E2EUser');
    expect(rows[0].input_tokens).toBe(500);
  });
});
