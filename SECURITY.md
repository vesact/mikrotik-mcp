# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via [GitHub Security Advisories](../../security/advisories/new) — do not open a public issue.

We aim to acknowledge reports within 5 business days.

## Scope and deployment guidance

This server executes commands on network infrastructure. Treat any deployment as security-sensitive:

- **Protect the KeePass vault.** The vault master password is provided via environment variable; anyone with access to the container environment can read device credentials. Restrict access to the host accordingly.
- **Do not expose the HTTP transport publicly.** The MCP HTTP endpoint has no built-in authentication. Bind it to a trusted network, or front it with an authenticating reverse proxy.
- **Use `READ_ONLY=true`** for any agent that only needs monitoring access. This withholds all write, execution, and active-diagnostic tools at the protocol level — it is the server's enforcement mechanism, and no client-side configuration can bypass it.
- **Approve writes in the MCP client.** The server runs write tools on the first call and has no built-in confirmation step; a server-side prompt would be advisory only, since nothing prevents a client from skipping it. Configure per-tool approval or allow/deny rules in the client (e.g. Claude Code permission rules, Claude Desktop per-tool approval), where the decision is enforced and can be scoped per agent. Reserve unattended, pre-approved access for agents that genuinely need it.
- **Prefer HTTPS to devices.** Keep `ROUTEROS_REST_SCHEME=https` and use valid certificates on RouterOS (`/certificate` + `www-ssl`) wherever possible.
- **`ros-command` is an escape hatch.** It executes arbitrary RouterOS commands over SSH, verbatim, on every device matched by `target` — no validation, no preview, no rollback. It is annotated as a destructive write tool (`destructiveHint: true`). Withhold it via read-only mode, or deny it specifically in the client, if your use case does not require it.
- **Restrict the RouterOS accounts in the vault.** Tool permissions bound what an approved command can do; a device account limited to the groups an agent actually needs is the last line of defence behind client approval.

## Dependency overrides

`kdbxweb` (the KeePass library) declares `@xmldom/xmldom ^0.7.4`, which resolves to versions carrying open XML-injection/DoS advisories. `package.json` therefore forces the patched `@xmldom/xmldom@^0.8.13` via npm `overrides` — all KeePass vault tests pass against it. Do **not** raise this override to the 0.9.x line: it changes parsing behavior and breaks kdbxweb vault loading (verified). Remove the override only once kdbxweb updates its own dependency.
