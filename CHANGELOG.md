# Changelog

## 0.1.3

- Added macOS candidates for the Chinese-named `千问办公.app` bundle and process.
- Final macOS path/process polish.

## 0.1.2

- macOS support: app paths under `/Applications`, process detection with `pgrep`, launch/restart with `pkill`, and `open` for browser login.
- Cross-platform config auto-detection for WorkBuddy and QwenWork on Windows and macOS.
- README requirements and setup paths updated for both platforms.

## 0.1.1

- Renamed the project from Office Bus to **BotCrew**.
- Package, client loader id, bundle patch, repository and release assets renamed to `dsh-botcrew` / `botcrew`.
- Data directory moved to `~/.dsh/botcrew`.
- Screenshots, locale metadata, README and market entry refreshed.

## 0.1.0

- Initial DSH bundle: Host panel service, Client group chat, MCP engine.
- Group chat with members, `@` mentions, attachments, output modes and multiple threads.
- WorkBuddy and 千问 adapters, handoff, task status, artifacts and approvals.
- Member management with custom members, per-member permission switches and removal confirmation.
- First-run environment detection with automatic app launch, restart consent and qwen CLI login.
- Local work panel at `127.0.0.1:8765`.
