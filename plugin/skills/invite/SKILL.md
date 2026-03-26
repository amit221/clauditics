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
