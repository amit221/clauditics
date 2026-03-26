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
