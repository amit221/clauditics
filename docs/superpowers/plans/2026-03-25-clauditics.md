# Clauditics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that captures per-user token usage at session end and stores it locally (personal mode) or ships it to a self-hosted Express dashboard (team mode).

**Architecture:** Two npm workspaces — `plugin/` (Claude Code hooks + skills) and `dashboard/` (Express + SQLite + React). Hook scripts run at `SessionStart` (capture model, verify registration, flush queue) and `Stop` (parse transcript JSONL for token totals, write or POST event). The setup skill registers hooks into `~/.claude/settings.json` with discovered absolute paths.

**Tech Stack:** Node.js 18+, Jest 29, Express 4, better-sqlite3, Supertest, React 18, Vite 5, Recharts

**Spec:** `docs/superpowers/specs/2026-03-25-clauditics-design.md`

---

## File Map

```
clauditics/
├── package.json                              monorepo root (npm workspaces)
│
├── plugin/
│   ├── package.json
│   ├── jest.config.js
│   ├── .claude-plugin/
│   │   └── plugin.json                       Claude Code plugin manifest
│   ├── hooks/
│   │   └── hooks.json                        reference only; actual hooks written by setup skill
│   ├── scripts/
│   │   ├── config.js                         read/write ~/.clauditics/config.json + session-current.json
│   │   ├── log.js                            write ~/.clauditics/errors.log
│   │   ├── http.js                           fetch wrappers for POST /events and POST /verify
│   │   ├── parse-transcript.js               sum tokens from transcript JSONL
│   │   ├── queue.js                          enqueue failed events + flush on session start
│   │   ├── session-start.js                  SessionStart hook entry point
│   │   └── session-stop.js                   Stop hook entry point
│   └── scripts/__tests__/
│       ├── config.test.js
│       ├── parse-transcript.test.js
│       ├── http.test.js
│       ├── queue.test.js
│       ├── session-start.test.js
│       └── session-stop.test.js
│   └── skills/
│       ├── setup/SKILL.md                    /clauditics:setup — interactive wizard
│       ├── report/SKILL.md                   /clauditics:report — personal CLI summary
│       └── invite/SKILL.md                   /clauditics:invite — print member install URL
│
└── dashboard/
    ├── package.json
    ├── jest.config.js
    ├── src/
    │   ├── server.js                         Express entry point
    │   ├── db.js                             SQLite init + query helpers
    │   ├── config.js                         read ~/.clauditics/server-config.json
    │   ├── middleware/
    │   │   └── auth.js                       X-Team-Token validation
    │   └── routes/
    │       ├── events.js                     POST /events, POST /verify
    │       ├── install.js                    GET /install
    │       └── stats.js                      GET /api/stats
    ├── src/__tests__/
    │   ├── events.test.js
    │   ├── install.test.js
    │   └── stats.test.js
    └── ui/
        ├── index.html
        ├── vite.config.js
        └── src/
            ├── main.jsx
            ├── App.jsx
            ├── api.js                        fetch wrappers for /api/stats
            └── components/
                ├── Overview.jsx              tokens per user (table + bar chart)
                ├── Models.jsx                model breakdown
                ├── Timeline.jsx              daily totals
                └── UserDetail.jsx            per-user session history
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `plugin/package.json`
- Create: `dashboard/package.json`
- Create: `plugin/jest.config.js`
- Create: `dashboard/jest.config.js`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "clauditics",
  "private": true,
  "workspaces": ["plugin", "dashboard"],
  "scripts": {
    "test": "npm run test --workspaces"
  }
}
```

- [ ] **Step 2: Create plugin/package.json**

```json
{
  "name": "@clauditics/plugin",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 3: Create dashboard/package.json**

```json
{
  "name": "@clauditics/dashboard",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "express": "^4.18.0",
    "better-sqlite3": "^9.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "supertest": "^6.0.0"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 4: Create plugin/jest.config.js**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
};
```

- [ ] **Step 5: Create dashboard/jest.config.js**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
};
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dashboard/ui/dist/
*.pid
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Commit**

```bash
git init
git add package.json plugin/package.json dashboard/package.json plugin/jest.config.js dashboard/jest.config.js .gitignore
git commit -m "chore: monorepo scaffold with npm workspaces"
```

---

## Task 2: Plugin shared utilities — config and log

**Files:**
- Create: `plugin/scripts/config.js`
- Create: `plugin/scripts/log.js`
- Create: `plugin/scripts/__tests__/config.test.js`

`config.js` manages two files: `~/.clauditics/config.json` (user config) and `~/.clauditics/session-current.json` (temp session state written at start, read at stop).

- [ ] **Step 1: Write the failing tests**

Create `plugin/scripts/__tests__/config.test.js`:

```js
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

// Mock fs/promises before requiring the module
jest.mock('fs/promises');

const { readConfig, writeConfig, readSessionCurrent, writeSessionCurrent, deleteSessionCurrent, CLAUDITICS_DIR } = require('../config');

describe('config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('CLAUDITICS_DIR is under home dir', () => {
    expect(CLAUDITICS_DIR).toBe(path.join(os.homedir(), '.clauditics'));
  });

  test('readConfig returns null when file missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    const result = await readConfig();
    expect(result).toBeNull();
  });

  test('readConfig returns parsed JSON', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ mode: 'personal', user: 'Dan' }));
    const result = await readConfig();
    expect(result).toEqual({ mode: 'personal', user: 'Dan' });
  });

  test('writeConfig creates dir and writes JSON', async () => {
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    await writeConfig({ mode: 'personal', user: 'Dan' });
    expect(fs.mkdir).toHaveBeenCalledWith(CLAUDITICS_DIR, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(CLAUDITICS_DIR, 'config.json'),
      JSON.stringify({ mode: 'personal', user: 'Dan' }, null, 2)
    );
  });

  test('writeSessionCurrent writes session_id and model', async () => {
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    await writeSessionCurrent({ session_id: 'abc', model: 'claude-sonnet-4-6' });
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(CLAUDITICS_DIR, 'session-current.json'),
      JSON.stringify({ session_id: 'abc', model: 'claude-sonnet-4-6' }, null, 2)
    );
  });

  test('readSessionCurrent returns null when missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    expect(await readSessionCurrent()).toBeNull();
  });

  test('deleteSessionCurrent calls unlink', async () => {
    fs.unlink.mockResolvedValue();
    await deleteSessionCurrent();
    expect(fs.unlink).toHaveBeenCalledWith(path.join(CLAUDITICS_DIR, 'session-current.json'));
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd plugin && npx jest __tests__/config.test.js
```

Expected: `Cannot find module '../config'`

- [ ] **Step 3: Implement config.js**

Create `plugin/scripts/config.js`:

```js
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
```

Also create `plugin/scripts/log.js`:

```js
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd plugin && npx jest __tests__/config.test.js
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/config.js plugin/scripts/log.js plugin/scripts/__tests__/config.test.js
git commit -m "feat(plugin): config and log utilities"
```

---

## Task 3: Plugin — transcript parser

**Files:**
- Create: `plugin/scripts/parse-transcript.js`
- Create: `plugin/scripts/__tests__/parse-transcript.test.js`

Reads a JSONL file, finds every line with a `usage` field, sums `input_tokens` and `output_tokens`.

- [ ] **Step 1: Write the failing test**

Create `plugin/scripts/__tests__/parse-transcript.test.js`:

```js
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

jest.mock('fs/promises');

const { parseTranscript } = require('../parse-transcript');

describe('parseTranscript', () => {
  test('sums tokens across all assistant turns', async () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } } }),
      JSON.stringify({ type: 'user', message: { content: 'next' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 80 } } }),
    ];
    fs.readFile.mockResolvedValue(lines.join('\n'));
    const result = await parseTranscript('/fake/path.jsonl');
    expect(result).toEqual({ input_tokens: 300, output_tokens: 130 });
  });

  test('returns zeros when no usage lines', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ type: 'user', message: {} }));
    const result = await parseTranscript('/fake/path.jsonl');
    expect(result).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  test('skips malformed lines without throwing', async () => {
    const lines = ['not-json', JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5 } } })];
    fs.readFile.mockResolvedValue(lines.join('\n'));
    const result = await parseTranscript('/fake/path.jsonl');
    expect(result).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  test('returns zeros when file missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    const result = await parseTranscript('/missing.jsonl');
    expect(result).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd plugin && npx jest __tests__/parse-transcript.test.js
```

- [ ] **Step 3: Implement parse-transcript.js**

Create `plugin/scripts/parse-transcript.js`:

```js
const fs = require('fs/promises');

async function parseTranscript(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { input_tokens: 0, output_tokens: 0 };
    return { input_tokens: 0, output_tokens: 0 };
  }

  let input_tokens = 0;
  let output_tokens = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry?.message?.usage;
      if (usage) {
        input_tokens += usage.input_tokens || 0;
        output_tokens += usage.output_tokens || 0;
      }
    } catch (_) {
      // skip malformed lines
    }
  }

  return { input_tokens, output_tokens };
}

module.exports = { parseTranscript };
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd plugin && npx jest __tests__/parse-transcript.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/parse-transcript.js plugin/scripts/__tests__/parse-transcript.test.js
git commit -m "feat(plugin): transcript JSONL token parser"
```

---

## Task 4: Plugin — HTTP client

**Files:**
- Create: `plugin/scripts/http.js`
- Create: `plugin/scripts/__tests__/http.test.js`

Wraps `fetch` (Node 18 built-in) for `POST /events` and `POST /verify`. Always includes `X-Team-Token` header.

- [ ] **Step 1: Write the failing test**

Create `plugin/scripts/__tests__/http.test.js`:

```js
const { postEvent, postVerify } = require('../http');

const SERVER_URL = 'http://localhost:3000';
const TOKEN = 'test-token';

describe('http', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => fetchSpy.mockRestore());

  test('postEvent sends correct body and header', async () => {
    const event = { session_id: 'abc', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };
    const result = await postEvent(SERVER_URL, TOKEN, event);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Team-Token': TOKEN, 'Content-Type': 'application/json' }),
        body: JSON.stringify(event),
      })
    );
  });

  test('postEvent returns { ok: false } on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await postEvent(SERVER_URL, TOKEN, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch('ECONNREFUSED');
  });

  test('postVerify sends user in body', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await postVerify(SERVER_URL, TOKEN, 'Dan');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user: 'Dan' }),
      })
    );
  });

  test('postVerify returns { ok: false } on 401', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const result = await postVerify(SERVER_URL, TOKEN, 'Dan');
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd plugin && npx jest __tests__/http.test.js
```

- [ ] **Step 3: Implement http.js**

Create `plugin/scripts/http.js`:

```js
async function postEvent(serverUrl, teamToken, event) {
  try {
    const res = await fetch(`${serverUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Token': teamToken },
      body: JSON.stringify(event),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function postVerify(serverUrl, teamToken, user) {
  try {
    const res = await fetch(`${serverUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Token': teamToken },
      body: JSON.stringify({ user }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { postEvent, postVerify };
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd plugin && npx jest __tests__/http.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/http.js plugin/scripts/__tests__/http.test.js
git commit -m "feat(plugin): HTTP client for events and verify endpoints"
```

---

## Task 5: Plugin — queue module

**Files:**
- Create: `plugin/scripts/queue.js`
- Create: `plugin/scripts/__tests__/queue.test.js`

The queue is `~/.clauditics/queue.ndjson` — one JSON event per line. `enqueue` appends a line. `flushQueue` iterates lines, POSTs each, stops on first failure, rewrites the file with only the un-sent events.

- [ ] **Step 1: Write the failing tests**

Create `plugin/scripts/__tests__/queue.test.js`:

```js
jest.mock('fs/promises');
jest.mock('../http');

const fs = require('fs/promises');
const { postEvent } = require('../http');
const { enqueue, flushQueue } = require('../queue');
const os = require('os');
const path = require('path');

const QUEUE_PATH = path.join(os.homedir(), '.clauditics', 'queue.ndjson');

const event1 = { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 10, output_tokens: 5, timestamp: 't1' };
const event2 = { session_id: 'b', user: 'Dan', model: 'sonnet', input_tokens: 20, output_tokens: 8, timestamp: 't2' };
const event3 = { session_id: 'c', user: 'Dan', model: 'sonnet', input_tokens: 30, output_tokens: 12, timestamp: 't3' };

describe('queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueue appends event as NDJSON line', async () => {
    fs.mkdir.mockResolvedValue();
    fs.appendFile.mockResolvedValue();
    await enqueue(event1);
    expect(fs.appendFile).toHaveBeenCalledWith(QUEUE_PATH, JSON.stringify(event1) + '\n');
  });

  test('flushQueue posts all events and clears file on full success', async () => {
    fs.readFile.mockResolvedValue([event1, event2].map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFile.mockResolvedValue();
    postEvent.mockResolvedValue({ ok: true });

    await flushQueue('http://localhost:3000', 'token');

    expect(postEvent).toHaveBeenCalledTimes(2);
    expect(fs.writeFile).toHaveBeenCalledWith(QUEUE_PATH, '');
  });

  test('flushQueue stops on failure and keeps remaining events', async () => {
    fs.readFile.mockResolvedValue([event1, event2, event3].map(e => JSON.stringify(e)).join('\n'));
    fs.writeFile.mockResolvedValue();
    postEvent
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });

    await flushQueue('http://localhost:3000', 'token');

    expect(postEvent).toHaveBeenCalledTimes(2); // stops after failure
    const writtenContent = fs.writeFile.mock.calls[0][1];
    expect(writtenContent).toContain(JSON.stringify(event2));
    expect(writtenContent).toContain(JSON.stringify(event3));
    expect(writtenContent).not.toContain(JSON.stringify(event1));
  });

  test('flushQueue does nothing when queue file missing', async () => {
    fs.readFile.mockRejectedValue({ code: 'ENOENT' });
    await flushQueue('http://localhost:3000', 'token');
    expect(postEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd plugin && npx jest __tests__/queue.test.js
```

- [ ] **Step 3: Implement queue.js**

Create `plugin/scripts/queue.js`:

```js
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd plugin && npx jest __tests__/queue.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/queue.js plugin/scripts/__tests__/queue.test.js
git commit -m "feat(plugin): queue module for failed event retry"
```

---

## Task 6: Plugin — session-start.js

**Files:**
- Create: `plugin/scripts/session-start.js`
- Create: `plugin/scripts/__tests__/session-start.test.js`

Reads the `SessionStart` hook payload from stdin. Writes session-current.json. Checks config. If team mode, calls `/verify`. Flushes queue.

- [ ] **Step 1: Write the failing tests**

Create `plugin/scripts/__tests__/session-start.test.js`:

```js
jest.mock('../config');
jest.mock('../log');
jest.mock('../http');
jest.mock('../queue');

const { readConfig, writeSessionCurrent } = require('../config');
const { logError } = require('../log');
const { postVerify } = require('../http');
const { flushQueue } = require('../queue');
const { run } = require('../session-start');

const PAYLOAD = {
  session_id: 'sess-1',
  model: 'claude-sonnet-4-6',
  transcript_path: '/tmp/session.jsonl',
  hook_event_name: 'SessionStart',
};

describe('session-start', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writes session-current.json with session_id and model', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    await run(PAYLOAD);
    expect(writeSessionCurrent).toHaveBeenCalledWith({ session_id: 'sess-1', model: 'claude-sonnet-4-6' });
  });

  test('prints setup message and exits when config missing', async () => {
    readConfig.mockResolvedValue(null);
    const consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await run(PAYLOAD);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/clauditics:setup'));
    consoleSpy.mockRestore();
  });

  test('calls postVerify for owner mode', async () => {
    readConfig.mockResolvedValue({ mode: 'owner', user: 'Dan', serverUrl: 'http://localhost:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: true });
    flushQueue.mockResolvedValue();
    await run(PAYLOAD);
    expect(postVerify).toHaveBeenCalledWith('http://localhost:3000', 'tok', 'Dan');
  });

  test('calls postVerify for member mode', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: true });
    flushQueue.mockResolvedValue();
    await run(PAYLOAD);
    expect(postVerify).toHaveBeenCalledWith('http://server:3000', 'tok', 'Alice');
  });

  test('logs warning but does not throw when postVerify fails', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' });
    flushQueue.mockResolvedValue();
    await expect(run(PAYLOAD)).resolves.not.toThrow();
    expect(logError).toHaveBeenCalledWith('session-start', expect.stringContaining('verify'));
  });

  test('does not call postVerify for personal mode', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    await run(PAYLOAD);
    expect(postVerify).not.toHaveBeenCalled();
  });

  test('calls flushQueue for owner/member mode', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postVerify.mockResolvedValue({ ok: true });
    flushQueue.mockResolvedValue();
    await run(PAYLOAD);
    expect(flushQueue).toHaveBeenCalledWith('http://server:3000', 'tok');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd plugin && npx jest __tests__/session-start.test.js
```

- [ ] **Step 3: Implement session-start.js**

Create `plugin/scripts/session-start.js`:

```js
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd plugin && npx jest __tests__/session-start.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/session-start.js plugin/scripts/__tests__/session-start.test.js
git commit -m "feat(plugin): SessionStart hook script"
```

---

## Task 7: Plugin — session-stop.js

**Files:**
- Create: `plugin/scripts/session-stop.js`
- Create: `plugin/scripts/__tests__/session-stop.test.js`

Reads Stop payload from stdin. Reads session-current.json. Parses transcript. Builds event. Writes locally or POSTs.

- [ ] **Step 1: Write the failing tests**

Create `plugin/scripts/__tests__/session-stop.test.js`:

```js
jest.mock('../config');
jest.mock('../log');
jest.mock('../http');
jest.mock('../queue');
jest.mock('../parse-transcript');
jest.mock('fs/promises');

const { readConfig, readSessionCurrent, deleteSessionCurrent } = require('../config');
const { logError } = require('../log');
const { postEvent } = require('../http');
const { enqueue } = require('../queue');
const { parseTranscript } = require('../parse-transcript');
const fs = require('fs/promises');
const { run } = require('../session-stop');

const STOP_PAYLOAD = {
  session_id: 'sess-1',
  transcript_path: '/tmp/session.jsonl',
  hook_event_name: 'Stop',
};

const SESSION_CURRENT = { session_id: 'sess-1', model: 'claude-sonnet-4-6' };

describe('session-stop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-03-25T18:00:00.000Z'));
    readSessionCurrent.mockResolvedValue(SESSION_CURRENT);
    parseTranscript.mockResolvedValue({ input_tokens: 1200, output_tokens: 340 });
    deleteSessionCurrent.mockResolvedValue();
  });

  afterEach(() => jest.useRealTimers());

  test('writes NDJSON file for personal mode', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    fs.mkdir.mockResolvedValue();
    fs.appendFile.mockResolvedValue();

    await run(STOP_PAYLOAD);

    const expectedEvent = { session_id: 'sess-1', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 1200, output_tokens: 340, timestamp: '2026-03-25T18:00:00.000Z' };
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('2026-03-25.ndjson'),
      JSON.stringify(expectedEvent) + '\n'
    );
  });

  test('POSTs event for member mode', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postEvent.mockResolvedValue({ ok: true });

    await run(STOP_PAYLOAD);

    expect(postEvent).toHaveBeenCalledWith('http://server:3000', 'tok',
      expect.objectContaining({ user: 'Alice', input_tokens: 1200, output_tokens: 340 })
    );
  });

  test('enqueues event when POST fails', async () => {
    readConfig.mockResolvedValue({ mode: 'member', user: 'Alice', serverUrl: 'http://server:3000', teamToken: 'tok' });
    postEvent.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' });

    await run(STOP_PAYLOAD);

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ user: 'Alice' }));
  });

  test('logs error and exits gracefully when session-current missing', async () => {
    readSessionCurrent.mockResolvedValue(null);
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });

    await expect(run(STOP_PAYLOAD)).resolves.not.toThrow();
    expect(logError).toHaveBeenCalledWith('session-stop', expect.stringContaining('session-current'));
  });

  test('deletes session-current.json after processing', async () => {
    readConfig.mockResolvedValue({ mode: 'personal', user: 'Dan' });
    fs.mkdir.mockResolvedValue();
    fs.appendFile.mockResolvedValue();

    await run(STOP_PAYLOAD);

    expect(deleteSessionCurrent).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd plugin && npx jest __tests__/session-stop.test.js
```

- [ ] **Step 3: Implement session-stop.js**

Create `plugin/scripts/session-stop.js`:

```js
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd plugin && npx jest __tests__/session-stop.test.js
```

- [ ] **Step 5: Run all plugin tests**

```bash
cd plugin && npx jest
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add plugin/scripts/session-stop.js plugin/scripts/__tests__/session-stop.test.js
git commit -m "feat(plugin): Stop hook script"
```

---

## Task 8: Plugin manifest, hooks config, and setup skill

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`
- Create: `plugin/hooks/hooks.json`
- Create: `plugin/skills/setup/SKILL.md`

**Hook path note:** The hook commands reference scripts under `~/.clauditics/scripts/`. The setup skill copies the plugin scripts there during first-run setup, and writes the hooks into `~/.claude/settings.json` with absolute paths. The `hooks/hooks.json` in the plugin is provided for reference but the setup skill is the authoritative hook installer.

- [ ] **Step 1: Create plugin manifest**

Create `plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "clauditics",
  "description": "Per-user token usage analytics for Claude Code teams",
  "version": "1.0.0",
  "author": { "name": "clauditics" }
}
```

- [ ] **Step 2: Create hooks reference file**

Create `plugin/hooks/hooks.json`:

```json
{
  "_note": "This file is a reference. Actual hooks are installed by /clauditics:setup into ~/.claude/settings.json",
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"${HOME}/.clauditics/scripts/session-start.js\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"${HOME}/.clauditics/scripts/session-stop.js\"" }] }
    ]
  }
}
```

- [ ] **Step 3: Create the setup skill**

Create `plugin/skills/setup/SKILL.md`:

```markdown
---
description: Interactive first-run setup for Clauditics analytics. Configures mode (personal/owner/member), writes config, installs hooks, and optionally starts the dashboard server.
---

# Clauditics Setup

You are running the Clauditics first-run setup wizard. Follow these steps exactly, in order.

## Step 1 — Determine the plugin scripts directory

Find where the clauditics plugin scripts are installed by searching for `session-start.js` under `~/.claude/`. On Windows use `%USERPROFILE%\.claude\`. The scripts are in a subdirectory named `scripts/` inside the plugin folder.

Store this path as PLUGIN_SCRIPTS_DIR.

## Step 2 — Copy scripts to ~/.clauditics/scripts/

Create the directory `~/.clauditics/scripts/` (Windows: `%USERPROFILE%\.clauditics\scripts\`).

Copy these files from PLUGIN_SCRIPTS_DIR to `~/.clauditics/scripts/`:
- session-start.js
- session-stop.js
- config.js
- log.js
- http.js
- parse-transcript.js
- queue.js

## Step 3 — Ask which mode

Ask the user:
> How are you using Clauditics?
> A) Personal (just me, local storage)
> B) Team — I'm the owner (I run the dashboard)
> C) Team — I'm a member (I have an invite URL)

## Step 4 — Handle each mode

**If Personal (A):**
Write `~/.clauditics/config.json`:
```json
{ "mode": "personal", "user": "<OS_USERNAME>" }
```
Replace `<OS_USERNAME>` with the current OS username (`$USER` on Unix, `$USERNAME` on Windows).

**If Owner (B):**
1. Ask: "What port should the dashboard run on? (default: 3000)"
2. Ask: "What is the full path to the clauditics repo on this machine? (e.g. /home/dan/clauditics)"
3. Generate a random UUID for the team token using `crypto.randomUUID()` (run in a Bash tool).
4. Write `~/.clauditics/server-config.json`:
   ```json
   { "teamToken": "<UUID>", "port": <PORT> }
   ```
5. Write `~/.clauditics/config.json`:
   ```json
   { "mode": "owner", "user": "<OS_USERNAME>", "serverUrl": "http://localhost:<PORT>", "teamToken": "<UUID>" }
   ```
6. Spawn the dashboard server as a background process and save its PID:
   - **Unix/Mac:** Run `node <REPO_PATH>/dashboard/src/server.js &` via Bash tool. Capture the PID and write it to `~/.clauditics/server.pid`.
   - **Windows:** Run `Start-Process node -ArgumentList "<REPO_PATH>/dashboard/src/server.js" -WindowStyle Hidden` via PowerShell. Write the resulting PID to `%USERPROFILE%\.clauditics\server.pid`.
   - Wait 1 second, then verify the server is reachable: `curl -s http://localhost:<PORT>/ || echo "server not yet ready"`.
7. Tell the user: "Dashboard server started (PID saved to ~/.clauditics/server.pid). To restart it manually after a reboot, run: `node <REPO_PATH>/dashboard/src/server.js`"

**If Member (C):**
1. Ask: "Paste your invite URL:"
2. Make a GET request to the invite URL: `curl "<invite_url>"`
3. Parse the JSON response to get `serverUrl` and `teamToken`.
4. Ask: "What's your display name? (press Enter to use your OS username)"
5. Write `~/.clauditics/config.json`:
   ```json
   { "mode": "member", "user": "<NAME_OR_OS_USERNAME>", "serverUrl": "<serverUrl>", "teamToken": "<teamToken>" }
   ```

## Step 5 — Register hooks in ~/.claude/settings.json

Read `~/.claude/settings.json` (create it as `{}` if it doesn't exist).

Add the following to the `hooks` key (merge with any existing hooks):

On Unix/Mac:
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.clauditics/scripts/session-start.js\"" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.clauditics/scripts/session-stop.js\"" }] }
    ]
  }
}
```

On Windows, replace `$HOME` with the actual expanded path (e.g., `C:/Users/dan`).

Write the updated settings.json back.

## Step 6 — Confirm success

Tell the user:
> Clauditics setup complete!
> Mode: <mode>
> Config saved to ~/.clauditics/config.json
> Hooks registered in ~/.claude/settings.json
>
> Analytics will be collected automatically from your next Claude Code session.
> [If owner]: Share this invite URL with your team: http://localhost:<PORT>/install?token=<TOKEN>
```

- [ ] **Step 4: Commit**

```bash
git add plugin/.claude-plugin/plugin.json plugin/hooks/hooks.json plugin/skills/setup/SKILL.md
git commit -m "feat(plugin): plugin manifest, hooks config, and setup skill"
```

---

## Task 9: Plugin — report and invite skills

**Files:**
- Create: `plugin/skills/report/SKILL.md`
- Create: `plugin/skills/invite/SKILL.md`

- [ ] **Step 1: Create the report skill**

Create `plugin/skills/report/SKILL.md`:

```markdown
---
description: Show a token usage summary for personal mode. Reads local NDJSON event files and prints a formatted report to the terminal.
---

# Clauditics Usage Report

Read all `.ndjson` files in `~/.clauditics/events/` (Windows: `%USERPROFILE%\.clauditics\events\`). Each file is named `YYYY-MM-DD.ndjson` and contains one JSON event per line.

Each event has this shape:
```json
{ "session_id": "...", "user": "...", "model": "...", "input_tokens": 1200, "output_tokens": 340, "timestamp": "..." }
```

Compute and display:

1. **Total sessions** — count of events
2. **Total input tokens** — sum of all `input_tokens`
3. **Total output tokens** — sum of all `output_tokens`
4. **By model** — count and percentage of sessions per model
5. **Last 7 days** — for each of the last 7 dates, show total tokens (input + output) with a simple ASCII bar (scale bars to max daily total)

Format the output like this:
```
Clauditics — Usage Report
────────────────────────────────
Total sessions:      47
Total input tokens:  124,300
Total output tokens: 38,900

By model:
  claude-sonnet-4-6    89%  (42 sessions)
  claude-opus-4-6      11%  (5 sessions)

Last 7 days (input + output tokens):
  2026-03-19  ████░░░░  8,200
  2026-03-20  ██░░░░░░  4,100
  ...
```

If no events found, say: "No usage data found. Start a Claude Code session to begin tracking."
```

- [ ] **Step 2: Create the invite skill**

Create `plugin/skills/invite/SKILL.md`:

```markdown
---
description: Print the member invite URL for team owners. Reads server-config.json and constructs the install URL.
---

# Clauditics Invite

Read `~/.clauditics/config.json` (Windows: `%USERPROFILE%\.clauditics\config.json`).

If `mode` is not `owner`, tell the user: "The invite command is only available for team owners."

Otherwise, read `~/.clauditics/server-config.json` and construct the invite URL:
```
http://<serverUrl host and port>/install?token=<teamToken>
```

Use the `serverUrl` from `config.json` for the host/port.

Print:
> Share this URL with your team members. They paste it during /clauditics:setup.
>
> Invite URL: http://<host>:<port>/install?token=<teamToken>
```

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/report/SKILL.md plugin/skills/invite/SKILL.md
git commit -m "feat(plugin): report and invite skills"
```

---

## Task 10: Dashboard — database

**Files:**
- Create: `dashboard/src/db.js`
- Create: `dashboard/src/__tests__/db.test.js`

Uses `better-sqlite3` (synchronous SQLite). Initialises both tables on startup. Exports query helpers used by routes.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/__tests__/db.test.js`:

```js
const path = require('path');
// Use in-memory DB for tests
process.env.CLAUDITICS_DB = ':memory:';

const { initDb, insertEvent, insertMember, getStats } = require('../db');

describe('db', () => {
  let db;

  beforeEach(() => {
    db = initDb();
  });

  afterEach(() => {
    db.close();
  });

  test('insertEvent adds a row to events table', () => {
    const event = { session_id: 'abc', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };
    insertEvent(db, event);
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('Dan');
  });

  test('insertMember upserts — no error on duplicate', () => {
    insertMember(db, 'Dan');
    insertMember(db, 'Dan'); // should not throw
    const rows = db.prepare('SELECT * FROM members').all();
    expect(rows).toHaveLength(1);
  });

  test('getStats returns correct byUser aggregation', () => {
    insertEvent(db, { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
    insertEvent(db, { session_id: 'b', user: 'Dan', model: 'sonnet', input_tokens: 200, output_tokens: 80, timestamp: '2026-03-25T11:00:00.000Z' });
    insertEvent(db, { session_id: 'c', user: 'Alice', model: 'opus', input_tokens: 300, output_tokens: 100, timestamp: '2026-03-25T12:00:00.000Z' });

    const stats = getStats(db);
    const dan = stats.byUser.find(u => u.user === 'Dan');
    expect(dan.input_tokens).toBe(300);
    expect(dan.output_tokens).toBe(130);
    expect(dan.sessions).toBe(2);
    expect(stats.byUser).toHaveLength(2);
  });

  test('getStats returns correct byDay aggregation', () => {
    insertEvent(db, { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
    const stats = getStats(db);
    expect(stats.byDay[0].date).toBe('2026-03-25');
    expect(stats.byDay[0].input_tokens).toBe(100);
    expect(stats.byDay[0].sessions).toBe(1);
  });

  test('getStats returns correct byModel aggregation', () => {
    insertEvent(db, { session_id: 'a', user: 'Dan', model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
    const stats = getStats(db);
    expect(stats.byModel[0].model).toBe('claude-sonnet-4-6');
    expect(stats.byModel[0].sessions).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd dashboard && npx jest __tests__/db.test.js
```

- [ ] **Step 3: Implement db.js**

Create `dashboard/src/db.js`:

```js
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.CLAUDITICS_DB || path.join(os.homedir(), '.clauditics', 'clauditics.db');

function initDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user          TEXT NOT NULL,
      session_id    TEXT NOT NULL,
      model         TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      timestamp     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      user        TEXT PRIMARY KEY,
      first_seen  TEXT NOT NULL
    );
  `);
  return db;
}

function insertEvent(db, event) {
  db.prepare(`
    INSERT INTO events (user, session_id, model, input_tokens, output_tokens, timestamp)
    VALUES (@user, @session_id, @model, @input_tokens, @output_tokens, @timestamp)
  `).run(event);
}

function insertMember(db, user) {
  db.prepare(`
    INSERT OR IGNORE INTO members (user, first_seen) VALUES (?, ?)
  `).run(user, new Date().toISOString());
}

function getStats(db) {
  const byUser = db.prepare(`
    SELECT user, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as sessions
    FROM events GROUP BY user ORDER BY input_tokens DESC
  `).all();

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as sessions FROM events GROUP BY model ORDER BY sessions DESC
  `).all();

  const byDay = db.prepare(`
    SELECT substr(timestamp,1,10) as date, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as sessions
    FROM events GROUP BY date ORDER BY date DESC LIMIT 30
  `).all();

  return { byUser, byModel, byDay };
}

module.exports = { initDb, insertEvent, insertMember, getStats };
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd dashboard && npx jest __tests__/db.test.js
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/db.js dashboard/src/__tests__/db.test.js
git commit -m "feat(dashboard): SQLite db module with schema and query helpers"
```

---

## Task 11: Dashboard — server config + auth middleware

**Files:**
- Create: `dashboard/src/config.js`
- Create: `dashboard/src/middleware/auth.js`
- Create: `dashboard/src/__tests__/auth.test.js`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/__tests__/auth.test.js`:

```js
const express = require('express');
const request = require('supertest');

// Mock config before requiring auth
jest.mock('../config', () => ({ getTeamToken: () => 'valid-token' }));

const auth = require('../middleware/auth');

const app = express();
app.use(auth);
app.get('/test', (req, res) => res.json({ ok: true }));

describe('auth middleware', () => {
  test('allows request with correct X-Team-Token', async () => {
    const res = await request(app).get('/test').set('X-Team-Token', 'valid-token');
    expect(res.status).toBe(200);
  });

  test('rejects request with wrong token', async () => {
    const res = await request(app).get('/test').set('X-Team-Token', 'wrong');
    expect(res.status).toBe(401);
  });

  test('rejects request with no token', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd dashboard && npx jest __tests__/auth.test.js
```

- [ ] **Step 3: Implement config.js and auth.js**

Create `dashboard/src/config.js`:

```js
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
```

Create `dashboard/src/middleware/auth.js`:

```js
const { getTeamToken } = require('../config');

function auth(req, res, next) {
  const token = req.headers['x-team-token'];
  if (!token || token !== getTeamToken()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = auth;
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd dashboard && npx jest __tests__/auth.test.js
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/config.js dashboard/src/middleware/auth.js dashboard/src/__tests__/auth.test.js
git commit -m "feat(dashboard): server config and auth middleware"
```

---

## Task 12: Dashboard — events and verify routes

**Files:**
- Create: `dashboard/src/routes/events.js`
- Create: `dashboard/src/__tests__/events.test.js`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/__tests__/events.test.js`:

```js
process.env.CLAUDITICS_DB = ':memory:';
jest.mock('../config', () => ({ getTeamToken: () => 'tok', getPort: () => 3000 }));

const express = require('express');
const request = require('supertest');
const { initDb } = require('../db');
const eventsRouter = require('../routes/events');

let app, db;

beforeEach(() => {
  db = initDb();
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); }); // inject db
  app.use(eventsRouter);
});

afterEach(() => db.close());

describe('POST /events', () => {
  const validEvent = { session_id: 'abc', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T00:00:00.000Z' };

  test('201 and saves to DB with valid token', async () => {
    const res = await request(app).post('/events').set('X-Team-Token', 'tok').send(validEvent);
    expect(res.status).toBe(201);
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('Dan');
  });

  test('401 with wrong token', async () => {
    const res = await request(app).post('/events').set('X-Team-Token', 'bad').send(validEvent);
    expect(res.status).toBe(401);
  });

  test('400 when required fields missing', async () => {
    const res = await request(app).post('/events').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    expect(res.status).toBe(400);
  });
});

describe('POST /verify', () => {
  test('200 and upserts member', async () => {
    const res = await request(app).post('/verify').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const members = db.prepare('SELECT * FROM members').all();
    expect(members).toHaveLength(1);
  });

  test('200 on second call for same user (idempotent)', async () => {
    await request(app).post('/verify').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    const res = await request(app).post('/verify').set('X-Team-Token', 'tok').send({ user: 'Dan' });
    expect(res.status).toBe(200);
    const members = db.prepare('SELECT * FROM members').all();
    expect(members).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd dashboard && npx jest __tests__/events.test.js
```

- [ ] **Step 3: Implement events.js**

Create `dashboard/src/routes/events.js`:

```js
const express = require('express');
const { getTeamToken } = require('../config');
const { insertEvent, insertMember } = require('../db');

const router = express.Router();

function validateToken(req, res) {
  if (req.headers['x-team-token'] !== getTeamToken()) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

router.post('/events', (req, res) => {
  if (!validateToken(req, res)) return;
  const { session_id, user, model, input_tokens, output_tokens, timestamp } = req.body;
  if (!session_id || !user || !model || input_tokens == null || output_tokens == null || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    insertEvent(req.db, { session_id, user, model, input_tokens, output_tokens, timestamp });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify', (req, res) => {
  if (!validateToken(req, res)) return;
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'Missing user' });
  try {
    insertMember(req.db, user);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd dashboard && npx jest __tests__/events.test.js
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/routes/events.js dashboard/src/__tests__/events.test.js
git commit -m "feat(dashboard): POST /events and POST /verify routes"
```

---

## Task 13: Dashboard — install and stats routes

**Files:**
- Create: `dashboard/src/routes/install.js`
- Create: `dashboard/src/routes/stats.js`
- Create: `dashboard/src/__tests__/install.test.js`
- Create: `dashboard/src/__tests__/stats.test.js`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/__tests__/install.test.js`:

```js
jest.mock('../config', () => ({ getTeamToken: () => 'abc123', getPort: () => 3000 }));

const express = require('express');
const request = require('supertest');
const installRouter = require('../routes/install');

const app = express();
app.use(installRouter);

describe('GET /install', () => {
  test('returns serverUrl and teamToken with valid query token', async () => {
    // For test, mock the server address by setting env
    process.env.CLAUDITICS_SERVER_URL = 'http://192.168.1.10:3000';
    const res = await request(app).get('/install?token=abc123');
    expect(res.status).toBe(200);
    expect(res.body.teamToken).toBe('abc123');
    expect(res.body.serverUrl).toBeDefined();
  });

  test('401 with wrong token', async () => {
    const res = await request(app).get('/install?token=wrong');
    expect(res.status).toBe(401);
  });
});
```

Create `dashboard/src/__tests__/stats.test.js`:

```js
process.env.CLAUDITICS_DB = ':memory:';
jest.mock('../config', () => ({ getTeamToken: () => 'tok', getPort: () => 3000 }));

const express = require('express');
const request = require('supertest');
const { initDb, insertEvent } = require('../db');
const statsRouter = require('../routes/stats');

let app, db;

beforeEach(() => {
  db = initDb();
  app = express();
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use(statsRouter);
  insertEvent(db, { session_id: 'a', user: 'Dan', model: 'sonnet', input_tokens: 100, output_tokens: 50, timestamp: '2026-03-25T10:00:00.000Z' });
  insertEvent(db, { session_id: 'b', user: 'Alice', model: 'opus', input_tokens: 200, output_tokens: 80, timestamp: '2026-03-25T11:00:00.000Z' });
});

afterEach(() => db.close());

describe('GET /api/stats', () => {
  test('returns byUser, byModel, byDay with valid token', async () => {
    const res = await request(app).get('/api/stats').set('X-Team-Token', 'tok');
    expect(res.status).toBe(200);
    expect(res.body.byUser).toHaveLength(2);
    expect(res.body.byModel).toHaveLength(2);
    expect(res.body.byDay).toHaveLength(1);
  });

  test('401 without token', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd dashboard && npx jest __tests__/install.test.js __tests__/stats.test.js
```

- [ ] **Step 3: Implement install.js and stats.js**

Create `dashboard/src/routes/install.js`:

```js
const express = require('express');
const { getTeamToken, getPort } = require('../config');

const router = express.Router();

router.get('/install', (req, res) => {
  const token = req.query.token;
  if (!token || token !== getTeamToken()) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const serverUrl = process.env.CLAUDITICS_SERVER_URL || `http://localhost:${getPort()}`;
  res.json({ serverUrl, teamToken: getTeamToken() });
});

module.exports = router;
```

Create `dashboard/src/routes/stats.js`:

```js
const express = require('express');
const { getTeamToken } = require('../config');
const { getStats } = require('../db');

const router = express.Router();

router.get('/api/stats', (req, res) => {
  if (req.headers['x-team-token'] !== getTeamToken()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const stats = getStats(req.db);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd dashboard && npx jest __tests__/install.test.js __tests__/stats.test.js
```

- [ ] **Step 5: Run all dashboard tests**

```bash
cd dashboard && npx jest
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/routes/install.js dashboard/src/routes/stats.js dashboard/src/__tests__/install.test.js dashboard/src/__tests__/stats.test.js
git commit -m "feat(dashboard): GET /install and GET /api/stats routes"
```

---

## Task 14: Dashboard — server entry point

**Files:**
- Create: `dashboard/src/server.js`

Wires together Express, db injection middleware, auth (on appropriate routes), and all routers. Serves static UI from `ui/dist/` when it exists.

- [ ] **Step 1: Create server.js**

No separate test — covered by integration tests in prior tasks. Verify manually.

Create `dashboard/src/server.js`:

```js
const path = require('path');
const express = require('express');
const { initDb } = require('./db');
const { getPort } = require('./config');
const eventsRouter = require('./routes/events');
const installRouter = require('./routes/install');
const statsRouter = require('./routes/stats');

const app = express();
app.use(express.json());

// Inject db into all requests
const db = initDb();
app.use((req, _res, next) => { req.db = db; next(); });

// Routes (install is unauthenticated, others have per-route auth)
app.use(installRouter);
app.use(eventsRouter);
app.use(statsRouter);

// Serve React UI if built
const UI_DIST = path.join(__dirname, '..', 'ui', 'dist');
try {
  require('fs').accessSync(UI_DIST);
  app.use(express.static(UI_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(UI_DIST, 'index.html')));
} catch (_) {
  app.get('/', (_req, res) => res.json({ status: 'Clauditics dashboard running. UI not built yet.' }));
}

const port = getPort();
app.listen(port, () => {
  console.log(`Clauditics dashboard running on http://localhost:${port}`);
});

module.exports = app; // for testing
```

- [ ] **Step 2: Smoke test — start the server**

First create a minimal `~/.clauditics/server-config.json` for local testing:
```bash
node -e "const os=require('os'),path=require('path'),fs=require('fs'); const p=path.join(os.homedir(),'.clauditics','server-config.json'); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p, JSON.stringify({teamToken:'test-token',port:3000},null,2));"
```

Then start the server:
```bash
cd dashboard && node src/server.js
```

Expected: `Clauditics dashboard running on http://localhost:3000`

Hit `Ctrl+C` to stop.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/server.js
git commit -m "feat(dashboard): Express server entry point"
```

---

## Task 15: Dashboard — React UI scaffold

**Files:**
- Create: `dashboard/ui/index.html`
- Create: `dashboard/ui/vite.config.js`
- Create: `dashboard/ui/src/main.jsx`
- Create: `dashboard/ui/src/App.jsx`
- Create: `dashboard/ui/src/api.js`

- [ ] **Step 1: Add UI devDependencies to dashboard/package.json**

```bash
cd dashboard && npm install --save-dev vite @vitejs/plugin-react react react-dom recharts
```

- [ ] **Step 2: Create vite.config.js**

Create `dashboard/ui/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { proxy: { '/api': 'http://localhost:3000', '/verify': 'http://localhost:3000' } },
});
```

- [ ] **Step 3: Create index.html**

Create `dashboard/ui/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Clauditics</title></head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 4: Create api.js**

Create `dashboard/ui/src/api.js`:

```js
export async function fetchStats(teamToken) {
  const res = await fetch('/api/stats', {
    headers: { 'X-Team-Token': teamToken },
  });
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}
```

- [ ] **Step 5: Create App.jsx**

Create `dashboard/ui/src/App.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { fetchStats } from './api';
import Overview from './components/Overview';
import Models from './components/Models';
import Timeline from './components/Timeline';
import UserDetail from './components/UserDetail';

export default function App() {
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('overview');
  const [selectedUser, setSelectedUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('teamToken') || '');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetchStats(token)
      .then(setStats)
      .catch(e => setError(e.message));
  }, [token]);

  if (!token) {
    return (
      <div style={{ padding: 32 }}>
        <h1>Clauditics</h1>
        <input placeholder="Team token" onBlur={e => { localStorage.setItem('teamToken', e.target.value); setToken(e.target.value); }} />
      </div>
    );
  }

  if (error) return <div style={{ padding: 32, color: 'red' }}>Error: {error}</div>;
  if (!stats) return <div style={{ padding: 32 }}>Loading...</div>;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>Clauditics</h1>
      <nav style={{ marginBottom: 24 }}>
        {['overview', 'models', 'timeline'].map(t => (
          <button key={t} onClick={() => { setTab(t); setSelectedUser(null); }} style={{ marginRight: 8, fontWeight: tab === t ? 'bold' : 'normal' }}>{t}</button>
        ))}
      </nav>
      {tab === 'overview' && !selectedUser && <Overview data={stats.byUser} onSelectUser={setSelectedUser} />}
      {tab === 'overview' && selectedUser && <UserDetail user={selectedUser} events={stats.byUser.find(u => u.user === selectedUser)?.events || []} onBack={() => setSelectedUser(null)} />}
      {tab === 'models' && <Models data={stats.byModel} />}
      {tab === 'timeline' && <Timeline data={stats.byDay} />}
    </div>
  );
}
```

- [ ] **Step 6: Create main.jsx**

Create `dashboard/ui/src/main.jsx`:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(<App />);
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/ui/
git commit -m "feat(dashboard): React UI scaffold with Vite"
```

---

## Task 16: Dashboard — UI components

**Files:**
- Create: `dashboard/ui/src/components/Overview.jsx`
- Create: `dashboard/ui/src/components/Models.jsx`
- Create: `dashboard/ui/src/components/Timeline.jsx`
- Create: `dashboard/ui/src/components/UserDetail.jsx`

- [ ] **Step 1: Create Overview.jsx**

```jsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Overview({ data }) {
  return (
    <div>
      <h2>Token Usage by User</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <XAxis dataKey="user" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="input_tokens" fill="#6366f1" name="Input" />
          <Bar dataKey="output_tokens" fill="#22d3ee" name="Output" />
        </BarChart>
      </ResponsiveContainer>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead><tr><th>User</th><th>Input Tokens</th><th>Output Tokens</th><th>Sessions</th></tr></thead>
        <tbody>
          {data.map(row => (
            <tr key={row.user}>
              <td>{row.user}</td>
              <td>{row.input_tokens.toLocaleString()}</td>
              <td>{row.output_tokens.toLocaleString()}</td>
              <td>{row.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create Models.jsx**

```jsx
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#ef4444'];

export default function Models({ data }) {
  return (
    <div>
      <h2>Model Usage</h2>
      <PieChart width={400} height={300}>
        <Pie data={data} dataKey="sessions" nameKey="model" cx="50%" cy="50%" outerRadius={100} label>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </div>
  );
}
```

- [ ] **Step 3: Create Timeline.jsx**

```jsx
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Timeline({ data }) {
  const sorted = [...data].reverse(); // oldest first
  return (
    <div>
      <h2>Daily Token Usage</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={sorted}>
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="input_tokens" stroke="#6366f1" name="Input" />
          <Line type="monotone" dataKey="output_tokens" stroke="#22d3ee" name="Output" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Create UserDetail.jsx** (used in future — referenced in App for drill-down)

```jsx
export default function UserDetail({ user, events }) {
  return (
    <div>
      <h2>{user} — Session History</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Timestamp</th><th>Model</th><th>Input</th><th>Output</th></tr></thead>
        <tbody>
          {events.map(e => (
            <tr key={e.session_id}>
              <td>{e.timestamp}</td>
              <td>{e.model}</td>
              <td>{e.input_tokens.toLocaleString()}</td>
              <td>{e.output_tokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Verify UI builds**

```bash
cd dashboard/ui && npx vite build
```

Expected: `dist/` directory created with `index.html` and assets.

- [ ] **Step 6: Commit**

```bash
git add dashboard/ui/src/components/
git commit -m "feat(dashboard): Overview, Models, Timeline, and UserDetail components"
```

---

## Task 17: End-to-end test

**Files:**
- Create: `dashboard/src/__tests__/e2e.test.js`

Starts a real Express server, runs `session-stop.js` as a child process with a fake transcript, verifies the event lands in the DB.

- [ ] **Step 1: Write the e2e test**

Create `dashboard/src/__tests__/e2e.test.js`:

```js
process.env.CLAUDITICS_DB = ':memory:';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { initDb, insertMember } = require('../db');
const eventsRouter = require('../routes/events');

// Fixed token for e2e
process.env.CLAUDITICS_SERVER_CONFIG = path.join(os.tmpdir(), 'e2e-server-config.json');
fs.writeFileSync(process.env.CLAUDITICS_SERVER_CONFIG, JSON.stringify({ teamToken: 'e2e-token', port: 0 }));

const { getTeamToken } = require('../config');

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

  test('session-stop script POSTs event to server and it lands in DB', () => {
    // Write fake transcript
    const transcriptPath = path.join(os.tmpdir(), 'e2e-transcript.jsonl');
    const lines = [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 500, output_tokens: 200 } } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n'));

    // Write clauditics config pointing to our test server.
    // Must match the path session-stop.js computes: os.homedir() + '/.clauditics'
    // The child process gets HOME=os.tmpdir(), so it will look for os.tmpdir()+'/.clauditics'
    const configDir = path.join(os.tmpdir(), '.clauditics');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ mode: 'member', user: 'E2EUser', serverUrl: `http://localhost:${port}`, teamToken: 'e2e-token' }));

    // Write session-current.json in same dir
    const sessionPath = path.join(configDir, 'session-current.json');
    fs.writeFileSync(sessionPath, JSON.stringify({ session_id: 'e2e-session', model: 'claude-sonnet-4-6' }));

    const stopPayload = JSON.stringify({ session_id: 'e2e-session', transcript_path: transcriptPath, hook_event_name: 'Stop' });

    // Override home dir for the child process
    const env = { ...process.env, HOME: os.tmpdir(), USERPROFILE: os.tmpdir() };

    // Run session-stop.js with our payload on stdin
    const scriptPath = path.join(__dirname, '..', '..', '..', 'plugin', 'scripts', 'session-stop.js');
    const result = spawnSync('node', [scriptPath], {
      input: stopPayload,
      env,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);

    // Verify event in DB
    const rows = db.prepare('SELECT * FROM events').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].user).toBe('E2EUser');
    expect(rows[0].input_tokens).toBe(500);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
cd dashboard && npx jest __tests__/e2e.test.js --testTimeout=15000
```

Expected: 1 test passing.

- [ ] **Step 3: Run full test suite**

```bash
npm run test --workspaces
```

Expected: all tests passing across both packages.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/__tests__/e2e.test.js
git commit -m "test: end-to-end session-stop -> POST /events -> DB"
```

---

## Done

At this point:
- Plugin hook scripts are implemented, tested, and packaged as a Claude Code plugin
- Dashboard API is fully tested with integration tests
- React UI builds and serves from the Express server
- End-to-end test confirms data flows from hook → server → DB
- Setup skill guides users through all three modes

**Next steps after implementation:**
1. Push to GitHub and test `/plugin install <url>` from a real Claude Code session
2. Run `/clauditics:setup` to register hooks and verify they fire
3. Start the dashboard server and confirm data appears in the UI
