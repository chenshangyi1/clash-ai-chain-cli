# Clash AI Chain CLI

## Scope

This directory is a standalone local Node.js CLI. It must never fetch remote subscriptions, execute user-provided JavaScript, enable the operating-system proxy, or toggle TUN.

## Safety invariants

- Parse YAML/JSON only. Treat script files as opaque text and never evaluate them.
- Static-IP imports may parse YAML, JSON, or explicitly supported plain-text proxy lines; reject JavaScript/TypeScript input and never fetch a URL from the file.
- Never put real credentials, subscription URLs, tokens, or backup contents in source, fixtures, saved logs, JSON output, or test output. Candidate lists remain masked; the final interactive local preview may show the selected endpoint credentials because the user explicitly requested verification before confirmation.
- Write only after an explicit confirmation from the user.
- Back up every file before changing it. Use atomic replacement for writes.
- Do not modify generated runtime files such as `clash-verge.yaml` or `config.yaml`.
- If a Mihomo Party layout is not positively recognized, export/preview only.

## Verification

Run `npm install`, `npm run check`, and `npm test` from this directory. Tests use fake nodes and temporary directories only.
