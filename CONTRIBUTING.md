# Contributing

Thanks for trying BotCrew.

## Development

```powershell
node src/mcp-server.js     # MCP server over stdio
node src/panel-server.js   # local panel on 127.0.0.1:8765
node src/doctor.js         # environment check
node src/mcp-smoke.js      # MCP smoke test
npm pack --dry-run         # inspect the published file list
```

No build step and no runtime npm dependencies. The client bundle (`lib/client.js`) uses the DSH module loader format directly.

## Pull requests

- Keep changes local-first: no cloud relay, no credential storage.
- For UI changes, include a screenshot and test both the group chat and the right-side panel.
- For adapter changes, test against the current WorkBuddy / 千问 versions and note the versions in the PR.
- Do not commit `data/`, generated screenshots with personal content, or `.tgz` files.

## Reporting bugs

Include:

- DSH version and Windows version;
- WorkBuddy / 千问 versions;
- the failing tool name and `task_id` if available;
- whether the ports `:9331` and `:9444` are reachable.

