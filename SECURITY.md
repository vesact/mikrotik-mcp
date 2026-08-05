# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via [GitHub Security Advisories](../../security/advisories/new) — do not open a public issue.

We aim to acknowledge reports within 5 business days.

## Scope and deployment guidance

This server executes commands on network infrastructure. Treat any deployment as security-sensitive:

- **Protect the KeePass vault.** The vault master password is provided via environment variable; anyone with access to the container environment can read device credentials. Restrict access to the host accordingly.
- **Do not expose the HTTP transport publicly.** The MCP HTTP endpoint has no built-in authentication. Bind it to a trusted network, or front it with an authenticating reverse proxy.
- **Use `READ_ONLY=true`** for any agent that only needs monitoring access. This withholds all write, execution, and active-diagnostic tools at the protocol level.
- **Prefer HTTPS to devices.** Keep `ROUTEROS_REST_SCHEME=https` and use valid certificates on RouterOS (`/certificate` + `www-ssl`) wherever possible.
- **`ros-command` is an escape hatch.** It executes arbitrary RouterOS commands over SSH (dry-run by default). Disable it via read-only mode if your use case does not require it.

## Dependency overrides

`kdbxweb` (the KeePass library) declares `@xmldom/xmldom ^0.7.4`, which resolves to versions carrying open XML-injection/DoS advisories. `package.json` therefore forces the patched `@xmldom/xmldom@^0.8.13` via npm `overrides` — all KeePass vault tests pass against it. Do **not** raise this override to the 0.9.x line: it changes parsing behavior and breaks kdbxweb vault loading (verified). Remove the override only once kdbxweb updates its own dependency.
