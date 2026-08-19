# Clash AI Chain CLI

`clash-ai` is a local Node.js setup wizard for selective AI chain routing. It is designed for Clash Verge Rev and Mihomo Party on macOS, Windows, and Linux.

The wizard starts by optionally importing your own static-IP file. It parses YAML, JSON, Clash `proxies` objects, `socks5://`/`http://` lines, or simple `server port username password` lines without executing the file. It shows masked candidates, asks you to confirm the subscription, and automatically detects that subscription's main proxy group. The final local terminal preview shows the complete selected endpoint so you can verify it, then asks for `yes` or `no` before writing. It backs up the files first, uses atomic writes, validates the generated configuration, and reports how to roll back. It never downloads a subscription or runs an existing JavaScript script.

Interactive setup always displays the subscription confirmation step, even when only one remote/local subscription is available. Internal Clash Verge entries such as merge, script, rules, proxies, and groups are hidden from setup.

Service-specific groups such as YouTube, Telegram, OpenAI, Netflix, and Emby are not presented as setup choices. The CLI scores the subscription-name match and common main-group names such as `节点选择`, `自留地`, `Proxy`, or `GLOBAL`. Advanced users can still override the result with `--general "group name"`.

Before asking for a static-IP file, setup performs a read-only preflight on the explicitly selected profile or the single active profile. It checks the currently bound script as plain text. If it contains the Clash AI Chain CLI marker—or the complete signature of the earlier compatible “Clash Verge AI 定向链式代理脚本”—setup exits immediately without reading the static-IP file, backing up, writing, activating, or restarting. A second check runs after manual profile selection when the target could not be determined during preflight. Use `--force` only when you intentionally need to replace the static IP or reinstall the script.

## Install and run

```text
npm install
node bin/clash-ai.js detect
node bin/clash-ai.js profiles
node bin/clash-ai.js setup
```

To provide the static-IP file non-interactively:

```text
clash-ai setup --static-ip-file "/path/to/static-ip.yaml" --static-ip-index 1
```

The file is read-only. JavaScript/TypeScript files are rejected. The CLI does not test or claim that an endpoint is residential; it only parses the node fields and asks you to confirm the candidate.

If the path is wrong or the format cannot be recognized, the wizard prints the reason and asks for the path again instead of exiting. macOS drag-and-drop paths with escaped spaces or parentheses, such as `static_proxies\ \(1\).txt`, are normalized automatically.

To expose the `clash-ai` command locally on your PATH, run `npm link` once after installing. The package also exposes the same entry point after a global install:

```text
clash-ai setup
```

Useful non-destructive commands:

```text
clash-ai detect
clash-ai profiles --client clash-verge-rev
clash-ai profiles --client clash-verge-rev --all  # include internal merge/script/rules entries
clash-ai preview --client clash-verge-rev --profile <profile-id> --landing <proxy-name> --general <group-name>
clash-ai doctor
```

To undo an installation, use the backup directory printed by the report:

```text
clash-ai rollback --backup <backup-directory>
```

## What is installed

The generated Clash script sends the selected AI domains (OpenAI/ChatGPT, Gemini, Claude, Grok, and X/Twitter) through the selected residential node with its selected `dialer-proxy` front group. YouTube and X/Twitter use the selected normal proxy group. Mainland China domains and IPs, private ranges, and LAN names go `DIRECT`; the final fallback is the normal proxy group, never the residential chain.

The CLI preserves existing profile files and existing scripts. It creates a new script file and binds it to the selected profile. It does not change the system proxy or TUN settings. On unsupported Mihomo Party layouts it stops at preview/export mode instead of guessing a path.

On macOS, after the final confirmation the CLI first quits the selected client and waits for it to stop completely, then writes the backed-up profile metadata, opens the client again, and re-reads `profiles.yaml` to verify that the exact new script is still bound. This order prevents Clash Verge from saving an older in-memory profile over the newly written binding while it quits. A report says `status: success` only when the client restarted and the binding check passed.

`--no-restart` is an advanced/manual mode. Close the client yourself before using it. The CLI can verify the file binding, but it reports a partial result until the client is manually started or reloaded.

## Credentials and backups

The selected node's credentials are read from the local profile only and are written into the new local script because Mihomo needs them. Candidate lists and JSON output remain masked; the final interactive terminal preview prints the selected server, username, and password in full at the user's request. Do not share screenshots or capture that terminal output in logs. Credentials are never committed to the repository, and tests use fake values only. Backups intentionally contain the original configuration, so protect the printed backup directory and remove it when no longer needed.

This project is a local configuration helper, not a proxy service. Check the rules and the selected endpoint before confirming an installation, and follow the laws and terms that apply to your network.

## License

MIT. See [LICENSE](LICENSE).
