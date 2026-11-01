# Security

Office Bus automates desktop applications that are already signed in on your PC. It is not a sandbox and it does not protect you from a malicious instruction.

## What it does

- Connects to WorkBuddy (`127.0.0.1:9331`) and 千问办公 (`127.0.0.1:9444`) over the Chromium DevTools Protocol.
- Runs `qoderclicn` locally for custom members and batch tasks.
- Serves a local panel on `127.0.0.1:8765`.

## What it does not do

- It does not store account passwords.
- It does not send screenshots or chat data to a cloud service.
- It does not bypass the apps' login or verification flows.

## Recommendations

- Keep the panel bound to `127.0.0.1`; do not expose port `8765` to the public internet.
- Gate publishing, payments and deletions behind `office_request_approval`.
- Treat custom-member permissions as best-effort: WorkBuddy and 千问 receive a task-level restriction, not a hard sandbox.
- Review the member list before running a group instruction that can send or publish content.

## Reporting

If you find a vulnerability, please open a private security advisory or contact the maintainer rather than filing a public issue with exploit details.
