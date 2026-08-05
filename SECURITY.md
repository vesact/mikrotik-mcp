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

## Known dependency advisories

`kdbxweb` (the KeePass library) pins `@xmldom/xmldom` 0.8.x, which carries open advisories for XML injection/DoS in its serializer (e.g. GHSA-wh4c-j3r5-mjhp). Forcing the patched 0.9.x line breaks vault loading, so the override is not applied. Practical exposure is low in this server: the only XML kdbxweb processes is the local vault file, which is trusted operator-controlled input, never data from the network or from managed devices. This will be resolved when kdbxweb updates its xmldom dependency.
