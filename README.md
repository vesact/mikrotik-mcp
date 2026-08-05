# mikrotik-mcp

[![CI](https://github.com/vesact/mikrotik-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vesact/mikrotik-mcp/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/ghcr.io-vesact%2Fmikrotik--mcp-blue?logo=docker)](https://github.com/vesact/mikrotik-mcp/pkgs/container/mikrotik-mcp)

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server for managing fleets of [MikroTik RouterOS](https://mikrotik.com/software) devices from AI assistants such as Claude.

It exposes **65 tools** covering system administration, interfaces, bridging, IP, firewall, DHCP/DNS, PPP, monitoring, and diagnostics — all executed over the RouterOS **REST API**, with SSH reserved for free-form `ros-command` execution. Device credentials are never passed through the model: they are resolved from a **KeePass vault** at runtime.

## Highlights

- **Fleet-aware by design** — every tool accepts a `target` of a single device ID, a comma-separated list (`R1,R2,R3`), or `all`. Commands fan out in parallel and return per-device results; one unreachable device never fails the batch.
- **REST-first transport** — structured JSON from the RouterOS REST API (RouterOS v7.1+), no brittle terminal scraping. SSH is used only for the `ros-command` escape hatch.
- **KeePass-backed credentials** — devices are enumerated from a `.kdbx` vault group. The LLM only ever sees device IDs, never passwords.
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

### 1. Prepare the credential vault

Create a KeePass vault (e.g. `config/vault.kdbx`) with one entry per device inside a group (default: `mikrotik`):

- **Title** → device ID (how you'll refer to the device in prompts)
- **Username / Password** → RouterOS credentials
- **URL** → device hostname or IP

### 2. Run with Docker (shared HTTP server)

Using the prebuilt image:

```bash
docker run -d -p 8000:8000 \
  -v ./config:/config:ro \
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
| `KEEPASS_PASSWORD` | — (required) | Master password of the KeePass vault |
| `KEEPASS_PATH` | `/config/keepass.kdbx` | Path to the `.kdbx` vault file |
| `KEEPASS_GROUP` | `mikrotik` | Vault group to enumerate devices from |
| `ROUTEROS_REST_PORT` | `443` | REST API port on target devices |
| `ROUTEROS_REST_SCHEME` | `https` | `https` or `http` |
| `ROUTEROS_TIMEOUT_MS` | `10000` | REST request timeout |
| `SSH_TIMEOUT_MS` | `10000` | Per-command SSH timeout (`ros-command`) |
| `ROUTEROS_SETUP_PORT` | `80` (unchanged) | Target `www` port when bootstrapping via `setup-new-device` |
| `MCP_TRANSPORT` | `stdio` (`http` in the Docker image) | MCP transport |
| `MCP_HTTP_PORT` | `3000` (`8000` in the Docker image) | HTTP listen port |
| `MCP_HOST` | `0.0.0.0` | HTTP bind address |
| `READ_ONLY` | `false` | Expose only read-only state-query tools |

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

- Node.js ≥ 22 (or Docker)
- RouterOS v7.1+ with the REST API enabled (`www-ssl` or `www` service) on managed devices
- SSH enabled on devices only if you use `ros-command` or `setup-new-device`

## Development

```bash
npm ci
npm run build          # TypeScript → dist/
npm test               # unit tests (Vitest, no hardware needed)
npm run lint           # ESLint
npm run format         # Prettier
npm run test:integration   # integration tests against real hardware (see .env.test.example)
```

Unit tests run against fixtures, including a committed test vault (`tests/fixtures/test-vault.kdbx`, password `test-password-123` — fake credentials only). Integration tests require a reachable RouterOS device and are configured via `.env.test`.

## Architecture

```
MCP client (Claude, …)
   │  stdio / Streamable HTTP
   ▼
mikrotik-mcp server ──► KeePass vault (device inventory + credentials)
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
