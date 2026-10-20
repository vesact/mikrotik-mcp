# mikrotik-mcp

[![CI](https://github.com/vesact/mikrotik-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vesact/mikrotik-mcp/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/ghcr.io-vesact%2Fmikrotik--mcp-blue?logo=docker)](https://github.com/vesact/mikrotik-mcp/pkgs/container/mikrotik-mcp)

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server for managing fleets of [MikroTik RouterOS](https://mikrotik.com/software) devices from AI assistants such as Claude.

It exposes **65 tools** covering system administration, interfaces, bridging, IP, firewall, DHCP/DNS, PPP, monitoring, and diagnostics — all executed over the RouterOS **REST API**, with SSH reserved for free-form `ros-command` execution. Device credentials are never passed through the model: they are resolved at runtime from a **KeePass vault**, environment variables, or a JSON inventory file.

## Highlights

- **Fleet-aware by design** — every tool accepts a `target` of a single device ID, a comma-separated list (`R1,R2,R3`), or `all`. Commands fan out in parallel and return per-device results; one unreachable device never fails the batch.
- **REST-first transport** — structured JSON from the RouterOS REST API (RouterOS v7.1+), no brittle terminal scraping. SSH is used only for the `ros-command` escape hatch.
- **Pluggable credential sources** — devices come from a KeePass `.kdbx` vault group, from environment variables, or from a JSON file. The LLM only ever sees device IDs, never passwords.
- **Enforced read-only mode** — `READ_ONLY=true` withholds all 14 write/execution and active-diagnostic tools at the protocol level, exposing only the 51 state-query tools. Ideal for monitoring-only agent access. Approval of individual write calls is left to the MCP client, which is where it can actually be enforced (see [Write operations and approval](#write-operations-and-approval)).
- **Two MCP transports** — `stdio` for local clients (Claude Desktop, Claude Code) and Streamable HTTP (with legacy SSE fallback) for a shared team server.

## Tool overview

| Area | Examples |
|---|---|
| System | identity, clock, health, hardware, packages, license, history, note, certificates, log, files |
| Interfaces & bridging | interface list/stats, enable/disable, interface lists, bridges, ports, VLANs, MAC table, neighbors |
| IP | addresses, ARP, routes, pools, IP settings, IP services |
| Firewall | filter, NAT, mangle, address lists, connection tracking, RADIUS |
| DHCP & DNS | DHCP client/server, leases, networks, DNS settings, static entries |
| PPP & users | profiles, secrets, active sessions, AAA, system users, scheduler, scripts, logging rules |
| Services | NTP, SNMP, reboot/shutdown |
| Diagnostics | ping, traceroute, bandwidth test, torch, packet sniffer, profile, netwatch, fetch, speed test, WoL, MAC/IP scan, traffic generator |
| Fleet & escape hatch | `device-list`, `setup-new-device`, `ros-command` (arbitrary CLI over SSH) |

## Quick start

### 1. Tell the server about your devices

Pick one credential source. The server infers it from the variables you set, or you can name it with `CREDENTIAL_PROVIDER=keepass|env|file`.

**Trying it on one router: environment variables.** No file needed:

```bash
docker run -d -p 8000:8000 \
  -e DEVICE_HOST=192.0.2.1 -e DEVICE_PASSWORD='…' \
  ghcr.io/vesact/mikrotik-mcp:latest
```

`DEVICE_USER` defaults to `admin` and `DEVICE_ID` to the host. For a few devices, set `DEVICES` to a JSON array instead, in the same format as the file below.

**An inventory rendered by a secret injector: a JSON file.** Point `DEVICES_FILE` at it:

```json
[
  { "id": "router-01", "host": "192.0.2.1", "password": "…" },
  { "id": "router-02", "host": "192.0.2.2", "user": "ops", "password": "…", "notes": "rack 4" }
]
```

The file is re-read on every tool call, so edits apply without a restart.

Both of these are read-only, so `setup-new-device` is not exposed with them: there would be nowhere to store the password it generates.

**A team fleet: a KeePass vault.** Create a vault (e.g. `config/vault.kdbx`) with one entry per device inside a group (default: `mikrotik`):

- **Title** → device ID (how you'll refer to the device in prompts)
- **Username / Password** → RouterOS credentials
- **URL** → device hostname or IP

The server re-reads the vault on every tool call, so entries you add or edit by hand are picked up without a restart. `setup-new-device` writes to it, which needs three things:

- **Mount the directory, read-write.** The server saves to a temp file in the same directory and renames it over the vault, so a reader never sees a half-written file. Mounting the vault file on its own still works, but the save then happens in place.
- **Don't leave a desktop KeePass with stale contents open.** Before saving, the server checks that nobody changed the file since it read it, and re-applies its entry on top if they did. A desktop client works the other way: it keeps its own copy in memory, and if it saves without reloading, it erases the entries the server added. Close it during setup, or make sure it reloads the file when it changes on disk before you save.
- **Edit the same file the container mounts.** If you edit a copy synced by Nextcloud, Syncthing or similar, you end up with two vaults that drift apart.

If the vault can't be written, `setup-new-device` resets the device's admin password back to empty and reports a recoverable failure, so you can fix the mount and run it again.

### 2. Run with Docker (shared HTTP server)

With a KeePass vault, using the prebuilt image:

```bash
docker run -d -p 8000:8000 \
  -v ./config:/config \
  -e KEEPASS_PASSWORD='…' \
  ghcr.io/vesact/mikrotik-mcp:latest   # serves MCP on http://localhost:8000/mcp
```

Or build from source:

```bash
cp .env.example .env        # set KEEPASS_PASSWORD at minimum
docker compose up -d
```

### 3. Or run locally over stdio (Claude Desktop / Claude Code)

```bash
npm ci && npm run build
```

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["/path/to/mikrotik-mcp/dist/index.js"],
      "env": {
        "KEEPASS_PATH": "/path/to/vault.kdbx",
        "KEEPASS_PASSWORD": "…"
      }
    }
  }
}
```

Then ask things like:

> "What's the RouterOS version across the whole fleet?"
> "Show DHCP leases on router-01."
> "Add a firewall filter on R1,R2."

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `CREDENTIAL_PROVIDER` | _(inferred)_ | `keepass`, `env` or `file`. Inferred from the variables below; required only when several sources are configured |
| `KEEPASS_PASSWORD` | — | Master password of the KeePass vault (selects `keepass`) |
| `KEEPASS_PATH` | `/config/keepass.kdbx` | Path to the `.kdbx` vault file |
| `KEEPASS_GROUP` | `mikrotik` | Vault group to enumerate devices from |
| `DEVICE_HOST` / `DEVICE_PASSWORD` | — | Single device (selects `env`) |
| `DEVICE_USER` / `DEVICE_ID` / `DEVICE_NOTES` | `admin` / the host / — | Optional fields of that device |
| `DEVICES` | — | JSON array of devices (selects `env`) |
| `DEVICES_FILE` | — | Path to a JSON array of devices (selects `file`) |
| `ROUTEROS_REST_PORT` | `443` | REST API port on target devices |
| `ROUTEROS_REST_SCHEME` | `https` | `https` or `http` |
| `ROUTEROS_TIMEOUT_MS` | `10000` | REST request timeout |
| `SSH_TIMEOUT_MS` | `10000` | Per-command SSH timeout (`ros-command`) |
| `ROUTEROS_SETUP_PORT` | `80` (unchanged) | Target `www` port when bootstrapping via `setup-new-device` |
| `MCP_TRANSPORT` | `stdio` (`http` in the Docker image) | MCP transport |
| `MCP_HTTP_PORT` | `3000` (`8000` in the Docker image) | HTTP listen port |
| `MCP_HOST` | `0.0.0.0` | HTTP bind address |
| `MCP_ALLOWED_HOSTS` | _(unset)_ | Comma-separated `host:port` allow-list for the `Host` header (DNS-rebinding protection) |
| `MCP_ALLOWED_ORIGINS` | _(unset)_ | Comma-separated allow-list for the `Origin` header |
| `READ_ONLY` | `false` | Expose only read-only state-query tools |

When either `MCP_ALLOWED_HOSTS` or `MCP_ALLOWED_ORIGINS` is set, the HTTP transports reject requests whose `Host`/`Origin` headers are not on the list. Leaving both unset disables the check and the server logs a warning at startup — the HTTP endpoint itself has no authentication, so see [SECURITY.md](SECURITY.md) before exposing it.

### Read-only mode

With `READ_ONLY=true` (also accepts `1`/`yes`/`on`), the server exposes only the 51 read-only tools. `ros-command`, `setup-new-device`, and all active diagnostics (ping, traceroute, torch, bandwidth test, scans, …) are withheld — they mutate state or generate network traffic. The allow-list is explicit, so tools added in the future are withheld until deliberately classified.

### Write operations and approval

The server does not implement its own confirmation step for writes. Write tools execute on the first call, and `ros-command` in particular runs whatever it is given, verbatim, on every device matched by `target`.

Approving individual calls is the MCP client's job — it is the layer that can actually enforce a decision and scope it per agent:

- **Claude Code** — permission modes plus `allow`/`ask`/`deny` rules, e.g. `"deny": ["mcp__mikrotik__ros-command"]` or an `ask` rule for the whole server, in `.claude/settings.json`.
- **Claude Desktop** and other hosts — per-tool approval prompts, kept enabled for this server.

`ros-command` carries MCP `annotations` (`readOnlyHint: false`, `destructiveHint: true`) so clients can classify it without parsing its description.

Two server-side controls remain, because they are enforcement rather than instruction:

- `READ_ONLY=true` — the tools are never registered, so no client configuration can invoke them.
- The RouterOS credentials in the vault — a device account with restricted permissions bounds what any approved command can do.

## Requirements

- Node.js ≥ 24 (or Docker)
- RouterOS v7.1+ with the REST API enabled (`www-ssl` or `www` service) on managed devices
- SSH enabled on devices only if you use `ros-command` or `setup-new-device`

## Development

```bash
npm ci
npm run build          # TypeScript → dist/
npm test               # unit tests (Vitest, no hardware needed)
npm run check          # lint + format check (Biome)
npm run check:fix      # apply Biome's fixes and formatting
npm run test:integration   # integration tests against real hardware (see .env.test.example)
```

Unit tests run against fixtures, including a committed test vault (`tests/fixtures/test-vault.kdbx`, password `test-password-123` — fake credentials only). Integration tests require a reachable RouterOS device and are configured via `.env.test`.

## Architecture

```
MCP client (Claude, …)
   │  stdio / Streamable HTTP
   ▼
mikrotik-mcp server ──► credential provider: KeePass vault | env vars | JSON file
   │                       (device inventory + credentials)
   │
   │  fan-out: target = "R1" | "R1,R2" | "all"   (parallel, per-device results)
   ▼
RouterOS REST API (all tools)  /  SSH (ros-command only)
```

The full architecture document lives in [docs/architecture.md](docs/architecture.md), and the original product requirements in [docs/prd.md](docs/prd.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 [Actemium Schweiz AG](https://www.actemium.ch/) — a [VINCI Energies](https://www.vinci-energies.com/) company.

MikroTik and RouterOS are trademarks of Mikrotīkls SIA. This project is not affiliated with or endorsed by MikroTik.
