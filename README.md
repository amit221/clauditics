# Clauditics

Per-user token usage analytics for Claude Code. Tracks input/output tokens across sessions — locally for personal use, or centrally for teams via a self-hosted dashboard.

## How it works

Clauditics installs two Claude Code hooks:

- **SessionStart** — records the session ID and model
- **Stop** — reads the session transcript, calculates token totals, and saves the event

No data leaves your machine unless you choose team mode and run your own dashboard.

---

## Installation

Clauditics is a Claude Code plugin. Install it by running `/plugins install` inside Claude Code and pointing it at this repo.

Once installed, run the setup wizard:

```
/clauditics:setup
```

The wizard walks you through choosing a mode and registers the hooks in `~/.claude/settings.json` automatically.

---

## Modes

### Personal

Usage is stored locally as NDJSON files in `~/.clauditics/events/YYYY-MM-DD.ndjson`. Nothing is sent anywhere.

**Setup:** choose option A in the wizard. That's it.

**View your usage:**

```
/clauditics:report
```

Prints a summary like:

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

---

### Team — Owner

You run the dashboard server. Events from all team members are stored in a local SQLite database and displayed in a React dashboard.

**Setup:**

1. Clone this repo on the machine that will run the server.
2. Install dashboard dependencies:
   ```bash
   cd dashboard
   npm install
   ```
3. Build the UI (optional, for the web dashboard):
   ```bash
   cd dashboard/ui
   npm install
   npx vite build
   ```
4. Run `/clauditics:setup` in Claude Code, choose option B, and enter the port and repo path. The wizard starts the server and generates a team token.
5. Share the invite URL with your team:
   ```
   /clauditics:invite
   ```
   This prints a URL like `http://your-server:3000/install?token=<token>`. Send it to each team member.

**Starting the server manually after a reboot:**

```bash
node /path/to/clauditics/dashboard/src/server.js
```

Or set `CLAUDITICS_SERVER_CONFIG` to point at your config file:

```bash
CLAUDITICS_SERVER_CONFIG=~/.clauditics/server-config.json node dashboard/src/server.js
```

`server-config.json` format:
```json
{ "teamToken": "your-secret-token", "port": 3000 }
```

**Dashboard:** open `http://localhost:3000` in a browser to see usage by user, model, and day.

---

### Team — Member

You connect to your team's dashboard. Events are POSTed to the server after each session.

**Setup:**

1. Get an invite URL from your team owner.
2. Run `/clauditics:setup` in Claude Code, choose option C, and paste the invite URL. The wizard fetches your credentials and writes the config.

**Offline resilience:** if the server is unreachable when a session ends, the event is saved to `~/.clauditics/queue.ndjson` and automatically flushed the next time a session starts and the server is back up.

---

## Slash commands

| Command | Who | What |
|---|---|---|
| `/clauditics:setup` | Everyone | First-run wizard — configures mode and installs hooks |
| `/clauditics:report` | Personal | Prints local token usage summary |
| `/clauditics:invite` | Team owners | Prints the member invite URL |

---

## File layout

```
~/.clauditics/
  config.json          # mode, user, serverUrl, teamToken
  server-config.json   # owner only: teamToken and port for the server
  session-current.json # active session (created on start, deleted on stop)
  events/              # personal mode: YYYY-MM-DD.ndjson event files
  queue.ndjson         # team member mode: events queued while server was down
  errors.log           # hook errors (silent, never blocks Claude)
  scripts/             # hook scripts copied here during setup
```

```
clauditics/
  plugin/              # Claude Code plugin
    scripts/           # hook scripts (session-start.js, session-stop.js, ...)
    skills/            # /clauditics:setup, :report, :invite
    hooks/             # hooks.json reference (installed by setup)
  dashboard/           # Express + SQLite server + React UI
    src/               # server, routes, db
    ui/                # React frontend (Vite)
```

---

## Development

```bash
# Install all dependencies
npm install

# Run all tests
npm test

# Run the real-Claude e2e test (patches ~/.claude/settings.json temporarily)
cd plugin && npm run test:e2e
```

Requirements: Node.js 18+, Claude Code installed and authenticated.

---

## Dashboard API

The dashboard exposes three endpoints, all requiring the `X-Team-Token` header except `/install`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/events` | token | Record a usage event |
| `POST` | `/verify` | token | Register/verify a team member |
| `GET` | `/install` | none | Returns `{ serverUrl, teamToken }` from the invite URL |
| `GET` | `/api/stats` | token | Returns usage stats by user, model, and day |
