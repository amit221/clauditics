# Clauditics — Claude Code Analytics Plugin Design

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Clauditics is a Claude Code plugin that collects per-user token usage analytics across a team. It uses Claude Code's native hooks system to capture session data and either stores it locally (personal mode) or ships it to a self-hosted dashboard (team mode).

---

## Problem

The Claude team plan provides minimal analytics. Teams cannot see per-user token consumption, model usage breakdown, or usage trends over time.

---

## Goals

- Track token usage (input + output) per user per session
- Track which model was used per session
- Support solo users (personal mode, zero server infra)
- Support teams (owner runs a dashboard, members send data to it)
- Never interrupt a Claude Code session under any circumstance

---

## Non-Goals

- Tool-level tracking (which tools were used)
- Conversation content capture
- Cost estimation (out of scope for v1)
- Cloud/SaaS hosted backend
- Multi-team / multi-tenancy
- Plugin marketplace submission
- Config or DB schema migration tooling (v1 schemas carry no forward-compatibility guarantees)

---

## Repository Structure

```
clauditics/
├── plugin/                          ← Claude Code plugin
│   ├── .claude-plugin/
│   │   └── plugin.json              ← plugin manifest
│   ├── hooks/
│   │   └── hooks.json               ← SessionStart + Stop hook definitions
│   ├── scripts/
│   │   ├── session-start.js         ← capture model, verify config, flush queue
│   │   └── session-stop.js          ← parse transcript for tokens, write/send event
│   └── skills/
│       ├── setup/SKILL.md           ← /clauditics:setup (first-run wizard)
│       ├── report/SKILL.md          ← /clauditics:report (personal mode CLI summary)
│       └── invite/SKILL.md          ← /clauditics:invite (owner generates member link)
├── dashboard/                       ← Node.js server (team owners only)
│   ├── src/
│   │   ├── server.js                ← Express API
│   │   ├── db.js                    ← SQLite helpers
│   │   └── routes/
│   │       ├── events.js            ← POST /events, POST /verify
│   │       └── stats.js             ← GET /api/stats
│   └── ui/                          ← React dashboard (bundled into server)
└── package.json                     ← npm workspaces monorepo root
```

---

## Modes

| Mode | Who | Dashboard | Plugin data path |
|------|-----|-----------|-----------------|
| **Personal** | Solo user | none — CLI report only | writes to local NDJSON files |
| **Team Owner** | Team admin | runs Express server | POSTs to own server at `localhost:<port>` |
| **Team Member** | Developer | none | POSTs to owner's server via HTTP |

**Note:** Owner mode is functionally identical to member mode in the plugin — both POST to a server URL. The difference is that for owners, `serverUrl` is `http://localhost:<port>` and they own the receiving server.

---

## Installation & Setup

### Install (everyone)
The plugin lives in a GitHub repository. Anyone installs it inside Claude Code:
```
/plugin install https://github.com/<owner>/clauditics
```

### First-run setup
On first session start, `session-start.js` detects no config and outputs instructions to run the setup wizard skill. The user then runs:
```
/clauditics:setup
```

The wizard asks:

```
? How are you using Clauditics?
  ❯ Personal (just me, local storage)
    Team — I'm the owner (I run the dashboard)
    Team — I'm a member (I have an invite URL)
```

**Personal:** wizard writes `~/.clauditics/config.json` with `mode: personal`.

**Owner:** wizard prompts for a port (default: 3000), starts the dashboard as a background process (see Server Startup below), writes config with `mode: owner` and `serverUrl: http://localhost:<port>`, then prints the invite command to share with members.

**Member:** wizard prompts for the invite URL, performs a `GET` on it to retrieve `serverUrl` and `teamToken` (see Invite Flow), then prompts for a display name (defaults to `$USER` / `$USERNAME`). Writes config with `mode: member`.

### Config file (`~/.clauditics/config.json`)
```json
{
  "mode": "personal | owner | member",
  "user": "Dan",
  "serverUrl": "http://192.168.1.10:3000",
  "teamToken": "abc123"
}
```

### Member invite flow

Owner runs `/clauditics:invite` → prints an invite URL embedding the server address:
```
http://<owner-ip>:3000/install?token=abc123
```

Member pastes this URL into the setup wizard. The wizard does:
```
GET http://<owner-ip>:3000/install?token=abc123
```
Server responds with:
```json
{ "serverUrl": "http://192.168.1.10:3000", "teamToken": "abc123" }
```
Wizard writes these to `~/.clauditics/config.json` — no manual entry of URLs or tokens.

**Network constraint:** Members must be able to reach the owner's machine at the specified address. For distributed teams, this requires a VPN, port forwarding, or a cloud VM. The plugin does not solve connectivity — this is a deployment concern outside v1 scope.

### Team token

A single static team token is generated once during owner setup using `crypto.randomUUID()`. It is stored in `~/.clauditics/server-config.json` on the owner's machine:
```json
{ "teamToken": "abc123-...", "port": 3000 }
```
The server reads this file at startup. All incoming requests are validated against this single token. There is one token per team — all members share it. Token rotation is out of scope for v1.

### Owner server startup

When the setup wizard starts the dashboard server, it spawns a detached Node.js process:
```
node dashboard/src/server.js --port <port> &
```
The PID is saved to `~/.clauditics/server.pid`. The server does **not** auto-start on reboot — the owner restarts the Node.js process manually by running `node dashboard/src/server.js` from the repo directory. A future version may add a `server` skill or `pm2` integration.

If the server is already running (PID file exists and process is alive), the wizard skips the start step.

---

## Hook Payloads

Claude Code delivers hook context as JSON on stdin. Token usage data is **not** included in hook payloads — it must be extracted by parsing the session transcript file.

### `SessionStart` payload (stdin)
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "SessionStart",
  "model": "claude-sonnet-4-6"
}
```

### `Stop` payload (stdin)
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/current/working/directory",
  "hook_event_name": "Stop",
  "stop_hook_active": true
}
```

Note: `model` is present in `SessionStart` but **not** in `Stop`. It must be captured at session start and carried to session stop via a temp file.

### Transcript JSONL format

Each line in `transcript_path` is a JSON object. Assistant turns include a `usage` field:
```json
{ "type": "assistant", "message": { "model": "claude-sonnet-4-6", "usage": { "input_tokens": 850, "output_tokens": 210 } } }
```

Token totals for a session are computed by summing `usage.input_tokens` and `usage.output_tokens` across all lines that contain a `usage` field.

---

## Plugin Hooks

Defined in `plugin/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node ~/.claude/plugins/clauditics/scripts/session-start.js" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "node ~/.claude/plugins/clauditics/scripts/session-stop.js" }]
      }
    ]
  }
}
```

### `session-start.js`

Receives `SessionStart` payload on stdin.

1. Parse stdin — extract `session_id`, `model`, `transcript_path`
2. Write `~/.clauditics/session-current.json`:
   ```json
   { "session_id": "abc123", "model": "claude-sonnet-4-6" }
   ```
3. Read `~/.clauditics/config.json` — if missing, print message instructing user to run `/clauditics:setup` and exit 0 (never block)
4. If mode is `owner` or `member`: POST `/verify` to server (see API contracts below)
   - On any failure: append warning to `~/.clauditics/errors.log`, continue
5. Flush `~/.clauditics/queue.ndjson` if it exists (see Queue Flush below). No mode check is needed — personal mode never writes to the queue, so the file will not exist. The flush is a no-op in personal mode by file absence.

### `session-stop.js`

Receives `Stop` payload on stdin.

1. Parse stdin — extract `transcript_path` (source: Stop hook stdin, not `session-current.json`)
2. Read `~/.clauditics/session-current.json` for `session_id` and `model`
   - If file missing: log to errors.log, exit 0
3. Parse `transcript_path` JSONL — sum all `usage.input_tokens` and `usage.output_tokens`
4. Read `~/.clauditics/config.json` for `user`
5. Build event:
   ```json
   {
     "session_id": "abc123",
     "user": "Dan",
     "model": "claude-sonnet-4-6",
     "input_tokens": 1200,
     "output_tokens": 340,
     "timestamp": "2026-03-25T18:00:00.000Z"
   }
   ```
6. **Personal mode:** append event as one JSON line to `~/.clauditics/events/YYYY-MM-DD.ndjson`
7. **Owner/Member mode:** POST event to `<serverUrl>/events` with header `X-Team-Token: <teamToken>`
   - On failure: append event to `~/.clauditics/queue.ndjson`
8. Delete `~/.clauditics/session-current.json`

### Queue flush (called from `session-start.js`)

The queue is a NDJSON file where each line is a failed event. Flush logic:

1. Read all lines from `~/.clauditics/queue.ndjson`
2. For each event (one at a time, in order):
   - POST to `/events`
   - If success: mark line for removal
   - If failure: stop flushing (server is still down), leave remaining events in queue
3. Rewrite the queue file with only the un-flushed events
4. Queue has no size or age limit in v1 — this is acceptable for the expected event volume

---

## API Contracts

All authenticated plugin requests include the header `X-Team-Token: <teamToken>`. The server validates this header on every endpoint except `GET /install`, which uses a query-string token instead (no header required — the member has no config yet). All other endpoints return `401` if the header is missing or invalid.

Queue flush code reads `serverUrl` and `teamToken` from `~/.clauditics/config.json` — the same source used by `session-stop.js`.

### `POST /events`

**Request body:**
```json
{
  "session_id": "abc123",
  "user": "Dan",
  "model": "claude-sonnet-4-6",
  "input_tokens": 1200,
  "output_tokens": 340,
  "timestamp": "2026-03-25T18:00:00.000Z"
}
```

**Success response:** `201 Created`, body: `{ "ok": true }`

**Error responses:** `401` (bad token), `400` (missing required fields), `500` (DB error)

---

### `POST /verify`

Acts as an upsert: registers the member if not already known, confirms registration if already known.

**Request body:**
```json
{ "user": "Dan" }
```

**Success response:** `200 OK`, body: `{ "ok": true }`

**Error responses:** `401` (bad token), `500` (DB error)

**Side effect:** On first call for a `user`, inserts a row into a `members` table (user, first_seen). This is how the owner's dashboard knows who is on the team.

---

### `GET /install?token=<teamToken>`

Used by the member setup wizard to retrieve connection details.

**Request:** No body. Token is validated via query string (`?token=<teamToken>`). No `X-Team-Token` header is required — the member does not have config yet at this point.

**Success response:** `200 OK`:
```json
{ "serverUrl": "http://192.168.1.10:3000", "teamToken": "abc123" }
```

**Error response:** `401` if token is invalid.

---

### `GET /api/stats`

Returns aggregated data for the dashboard UI.

**Response:**
```json
{
  "byUser": [{ "user": "Dan", "input_tokens": 124300, "output_tokens": 38900, "sessions": 47 }],
  "byModel": [{ "model": "claude-sonnet-4-6", "sessions": 42 }],
  "byDay": [{ "date": "2026-03-25", "input_tokens": 8200, "output_tokens": 2100, "sessions": 5 }]
}
```

---

## SQLite Schema

```sql
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user          TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  timestamp     TEXT NOT NULL
);

CREATE TABLE members (
  user        TEXT PRIMARY KEY,
  first_seen  TEXT NOT NULL
);
```

Schema is v1 with no migration tooling. Breaking changes require a fresh database.

---

## Dashboard UI (Team Owners)

### Tech stack
- **Server:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`)
- **UI:** React (bundled into server static files, served at `/`)

### Views
- **Overview:** total tokens per user (table + bar chart)
- **Models:** model usage breakdown across team
- **Timeline:** daily token totals over time
- **User detail:** per-user session history table

---

## Personal Mode: CLI Report

The `/clauditics:report` skill reads from `~/.clauditics/events/YYYY-MM-DD.ndjson` (all files in that directory) and prints a terminal summary:

```
Clauditics — Usage Report
────────────────────────────────
Total sessions:     47
Total input tokens: 124,300
Total output tokens: 38,900

By model:
  claude-sonnet-4-6    89%
  claude-opus-4-6      11%

Last 7 days:
  2026-03-19  ████░░░░  8,200 tokens
  2026-03-20  ██░░░░░░  4,100 tokens
  ...
```

Data source path: `~/.clauditics/events/YYYY-MM-DD.ndjson` — one file per day, one JSON object per line.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Config missing on session start | Print setup instructions, exit 0, do not block session |
| `session-current.json` missing at Stop | Log to errors.log, skip event, exit 0 |
| Transcript file missing or unparseable | Log to errors.log, skip event, exit 0 |
| `/verify` POST fails | Log warning to errors.log, continue session |
| `/events` POST fails | Append event to queue.ndjson, retry next SessionStart |
| Queue flush fails partway | Stop flushing, leave remaining events in queue |
| Local file write fails (personal) | Log to errors.log, skip silently |
| Server receives invalid token | Return 401 |
| Unhandled JS exception in any script | Caught at top level, logged to errors.log, exit 0 |

**Core principle:** All hook scripts wrap their entire body in a try/catch. Any error results in a log entry and `exit 0`. The plugin must never cause Claude Code to block or fail.

### Error log format

All entries written to `~/.clauditics/errors.log` use this format (one entry per line):
```
[2026-03-25T18:00:00.000Z] [session-stop] Failed to POST /events: connect ECONNREFUSED 127.0.0.1:3000
```
Format: `[ISO timestamp] [script-name] <message>`

---

## Testing

### Plugin (`plugin/`)
- Unit: `session-stop.js` — mock transcript JSONL with known token counts, assert correct sums
- Unit: `session-stop.js` — mock HTTP POST, assert correct event payload shape and `X-Team-Token` header
- Unit: `session-start.js` — mock `/verify` failure, assert session continues (exit 0)
- Unit: queue flush — seed queue with 3 events, mock server returning 200 for first 2 and 500 for third, assert queue file contains only the third event

### Dashboard (`dashboard/`)
- Integration: `POST /events` with valid token → assert row in SQLite
- Integration: `POST /events` with invalid token → assert 401
- Integration: `GET /api/stats` with seeded fixture data → assert correct aggregation
- Integration: `POST /verify` new user → assert row in `members` table

### End-to-end
- One test: `session-stop.js` runs against a real local Express server → event appears in DB

---

## Out of Scope (v1)

- Tool-level analytics
- Cost estimation
- Authentication beyond a shared team token
- Multiple teams / multi-tenancy
- Plugin marketplace submission
- Auto-start server on reboot
- Config or DB schema migration tooling
