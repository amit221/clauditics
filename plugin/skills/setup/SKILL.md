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
