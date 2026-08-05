# Product Requirements Document — mikrotik-mcp

**Author:** Actemium Schweiz AG
**Date:** 2026-04-19
**Project Type:** API backend / MCP server | **Domain:** Infrastructure automation | **Complexity:** Medium | **Context:** Greenfield

---

## Executive Summary

`mikrotik-mcp` is a Model Context Protocol (MCP) server that gives AI assistants and automated agents structured, auditable access to MikroTik RouterOS 7+ devices over SSH. Built for network engineering teams managing MikroTik fleets, it eliminates the manual per-device workflow that currently requires Winbox or raw SSH sessions for every operational task.

Engineers interact via natural language — *"show all interfaces with errors across the fleet"*, *"reconfigure RADIUS on a device group"*, *"check system logs post-incident"* — and `mikrotik-mcp` executes those operations across the fleet, returning structured per-device results. Credentials are resolved at runtime from a KeePass `.kdbx` vault; no password ever appears in LLM context or logs.

Built in TypeScript, deployable via Docker, and covered by integration tests against real RouterOS hardware.

### What Makes This Special

Existing MikroTik MCP servers typically share three limitations: single-device only, plaintext credentials in config, and no real-device test coverage. `mikrotik-mcp` is the first to solve all three simultaneously.

Credential isolation is the #1 blocker to enterprise adoption of MikroTik AI tooling. By resolving credentials from a KeePass vault at runtime — master password injected via environment variable, never in LLM context — the tool is deployable in production environments where plaintext config files are a hard blocker. Combined with fleet-wide fan-out and end-to-end test coverage, this is the first MikroTik MCP server a production network team can actually rely on.

---

## Success Criteria

### User Success

- Network engineers complete fleet-wide operational tasks (audit, reconfigure, diagnose) via their AI assistant without opening Winbox or a terminal
- The "aha moment" is reachable: one natural-language prompt produces a consolidated per-device report across the full fleet in seconds
- Active daily/weekly usage by the team in real workflows — not a demo that gets forgotten

### Business Success

- All confirmed Winbox sections are implemented and functional against a production fleet
- The tool is deployed and in regular use by the maintaining team
- Community adoption signals — issues, forks, and reports of production use at other organisations

### Technical Success

- Zero credential leaks — no password ever appears in LLM context, logs, or error messages
- All implemented MCP tool calls pass integration tests against a real RouterOS 7 device
- `docker-compose up` deploys the server reliably with KeePass file mounted as a volume
- SSH host key verification enforced — no silent MITM risk

### Measurable Outcomes

- 100% of confirmed Winbox sections covered with at least one working MCP tool per subsection
- Integration test suite passes against real hardware on every release
- Audit log captures every command: timestamp, session ID, device, command, result — append-only, no silent failures

---

## Product Scope

### MVP (Phase 1)

**Journeys supported:** Fleet audit, targeted group reconfiguration, single-device incident diagnosis, team server deployment.

**Must-Have Capabilities:**
- MCP server with tools covering all confirmed sections: **Interfaces**, **Bridge**, **PPP**, **IP** (Addresses, ARP, DHCP Client/Server, DNS, Firewall, Neighbors, Pools, Routes, Services, Settings), **System** (Identity, Clock, NTP, Users, Scheduler, Scripts, Logging, Certificates, Health, Watchdog, RouterBOOT, Packages, License, Reboot/Shutdown, History, Note, SNMP, LCD), **Files**, **Log**, **RADIUS**, **Tools** (Ping, Traceroute, Bandwidth Test, Torch, Packet Sniffer, Profile, Netwatch, Fetch, Speed Test, MAC Scan, IP Scan, WoL, Traffic Generator)
- Flexible device addressing: single device by ID, named group, full fleet (`"all"`) with per-device aggregated results
- KeePass `.kdbx` credential resolution via `kdbxweb`; `KEEPASS_PASSWORD` from env var; fail-fast on vault unavailability
- SSH transport via `ssh2` (RouterOS 7+); host key verification enforced; one session per command
- stdio and HTTP/SSE MCP transports
- Append-only structured audit log per operation
- Docker deployment: Dockerfile + docker-compose with KeePass `.kdbx` volume mount
- Device registry: config file mapping device IDs → hostname/IP, port, KeePass entry, group memberships
- Unit tests (parsing logic, credential resolution) + integration tests against real RouterOS 7 device

### Phase 2 (Growth)

- Dry-run / preview mode: show what a command would do before executing — critical risk reduction for destructive fleet-wide operations
- Parallel SSH execution for fan-out calls — reduce latency on large fleets
- Alternative credential backends: env-var-only mode; groundwork for HashiCorp Vault / 1Password

### Phase 3 (Expansion)

- Open-source release with polished documentation
- Role-based access control / per-user permissions for shared team server
- RouterOS v6 compatibility
- Automated remediation workflows: detect and fix fleet misconfigurations without manual intervention

### Risk Mitigation

- **Parsing fragility:** RouterOS output parsers are unit-tested and isolated per section; raw output included in parse errors; pinned to RouterOS 7+
- **Vault dependency:** Fail-fast with clear error on vault open failure; no silent degradation to plaintext fallback
- **Adoption risk:** "Aha moment" (fleet audit in <5 minutes) is the first use case — maximises immediate perceived value
- **Scope creep:** If scope must shrink, RADIUS write operations and Tools are deferrable without breaking core fleet-read use cases

---

## User Journeys

### Journey 1: Fleet Audit — Primary User, Happy Path

**Marco** is a network engineer on the team. Monday morning, a weekend incident report suggests some devices may have an open DNS resolver. He opens Claude (with mikrotik-mcp configured) and types: *"Check all devices for open DNS resolvers and give me a per-site report."*

`mikrotik-mcp` fans out the query across the whole fleet. Credentials are fetched silently from the KeePass vault — Marco never typed a password, never opened Winbox. The assistant returns a structured table: 3 devices have the issue, the rest are clean. Marco asks it to fix the 3 affected devices. The audit log captures every command with timestamp, device, and result.

**Before:** 2 hours of manual Winbox sessions. **After:** 3 minutes, zero context switching, full audit trail.

*Requirements revealed:* fleet fan-out, KeePass credential resolution, IP/DNS tools, per-device result aggregation, audit logging.

---

### Journey 2: Targeted Reconfiguration — Grouped Addressing

**Nina** needs to update the RADIUS server address across a device group following an infrastructure migration. She asks: *"Update the RADIUS server on the branch-routers group to 192.0.2.5."*

`mikrotik-mcp` resolves the device group, executes the RADIUS update on each device, and returns a per-device success/failure summary. One device was unreachable — reported cleanly. Nina logs a ticket.

**Before:** Manual SSH to each device, risk of missing one. **After:** One prompt, one structured result, missed device identified immediately.

*Requirements revealed:* named group addressing, RADIUS write tools, per-device error aggregation, unreachable device reporting.

---

### Journey 3: Incident Diagnosis — Error Recovery

**Marco** is paged during an out-of-hours incident. He asks: *"Show me the last 50 log entries and interface status for router-01."*

The device is partially responsive — SSH connects but one command times out. `mikrotik-mcp` returns partial results with a clear timeout error for the failing command. Marco has enough to diagnose without Winbox.

**Before:** connect to the management network, open Winbox, navigate manually — slow and error-prone under time pressure. **After:** Results in seconds, even in degraded device state.

*Requirements revealed:* single-device addressing, Log and Interfaces tools, per-command timeout handling, partial result return with clear error context.

---

### Journey 4: Server Setup — Admin/Ops User

**Alex** deploys `mikrotik-mcp` for the first time: clones the repo, drops the KeePass `.kdbx` file into config, sets `KEEPASS_PASSWORD`, runs `docker-compose up`. The server is immediately available to the team's shared Claude environment via HTTP/SSE. They configure the device registry — no passwords anywhere in the config.

**Before:** Each engineer manages credentials separately — tribal knowledge, inconsistent tooling. **After:** One shared credential-safe server, one config, one audit log for the whole team.

*Requirements revealed:* Docker deployment, device registry config, HTTP/SSE transport, KeePass vault mounting.

---

### Journey 5: Open-Source Operator — Secondary User (Post-MVP)

**Lars** runs a small WISP with 40 MikroTik routers. He finds `mikrotik-mcp` on GitHub and has it running in under an hour. He uses it with Cursor to build a weekly firmware audit script.

*Requirements revealed:* clear documentation, stdio transport for local single-user use, straightforward setup for non-Actemium environments.

---

### Journey Requirements Summary

| Capability Area | Revealed By |
|---|---|
| Fleet fan-out (all devices) | Journey 1 |
| Named group addressing | Journey 2 |
| Single device addressing | Journey 3 |
| KeePass credential resolution | Journeys 1–4 |
| SSH transport with timeout/error handling | Journey 3 |
| Per-device result aggregation + error reporting | Journeys 1–3 |
| Audit logging | Journey 1 |
| IP/DNS, Log, Interfaces, RADIUS tools | Journeys 1–3 |
| Docker + HTTP/SSE transport | Journey 4 |
| stdio transport | Journey 5 |
| Device registry config | Journey 4 |

---

## Innovation & Competitive Context

### Novel Patterns

- **Credential vault isolation for AI tooling:** Runtime KeePass credential resolution keeps passwords entirely out of LLM context and config files — novel in the network operations space.
- **Fleet fan-out with aggregated structured results:** A single tool call targeting a group or full fleet, returning per-device structured results to the LLM — not present in any existing MikroTik MCP server.
- **MCP as the interface layer for network ops:** Using the Model Context Protocol for structured, auditable infrastructure access — distinct from traditional network automation (Ansible, NAPALM) and existing RouterOS API tooling.

### Competitive Landscape

- Existing MikroTik MCP servers are predominantly single-device, store plaintext credentials, and lack real-device test coverage against real hardware
- No existing tool combines fleet-wide addressing + vault credential management + real-device test coverage
- The broader network automation space (Ansible, NAPALM, Netmiko) solves multi-device at scale but has no native MCP/AI assistant integration

### Validation

- Integration tests against a real RouterOS 7 device validate the MCP tool layer
- Deployment on a production fleet provides live validation
- "Aha moment" test: a fleet-wide audit task completed entirely within an AI assistant workflow, without Winbox or SSH

---

## MCP Architecture

### Protocol Contract

`mikrotik-mcp` exposes structured tools over the MCP protocol. Consumers are LLM clients (Claude Desktop, Cursor, VS Code Copilot, custom agents). Each tool call maps to one or more RouterOS SSH commands executed against one or more target devices.

**Every tool follows this contract:**
- **Input:** `target` (device ID, group name, or `"all"`) + tool-specific parameters
- **Output:** `DeviceResult[]` — `{ deviceId: string, success: boolean, data?: unknown, error?: string }`
- **Failure modes:** Vault unavailable (fail-fast), SSH unreachable (per-device error), command timeout (per-device error), parse error (per-device error with raw output)

### Data Schemas

| Schema | Structure |
|---|---|
| Device registry entry | `{ id, hostname/IP, port, kdbxEntry, groups[] }` |
| Tool input | MCP JSON schema; `target` field always present |
| Tool output | `DeviceResult[]` as above |
| Audit log entry | `{ timestamp: ISO8601, sessionId, deviceId, command, success, error? }` |

### Error Handling

| Condition | Behaviour |
|---|---|
| Vault unavailable | Throw immediately, MCP error response, no partial execution |
| Device unreachable / SSH timeout | Per-device error in result array; other devices continue |
| Command parse error | Per-device error with raw RouterOS output |
| Invalid target (unknown ID or group) | MCP error response |

### Concurrency & Transport

- **MVP:** Sequential per-device SSH execution within fan-out — sufficient for fleets of this size; documented as a known limitation
- One SSH session per command; opened and closed on completion; no connection pooling
- Transports: **stdio** (local/single-user) and **HTTP/SSE** (shared team server)

### Implementation Stack

| Component | Technology |
|---|---|
| Runtime | TypeScript / Node.js |
| SSH transport | `ssh2` |
| KeePass vault | `kdbxweb` |
| MCP server | `@modelcontextprotocol/sdk` |
| Deployment | Docker + docker-compose |

---

## Functional Requirements

### FR-CORE: Device Targeting & Fleet Addressing

- **FR-CORE-1:** Target a single device by its configured registry ID
- **FR-CORE-2:** Target a named group of devices by group name
- **FR-CORE-3:** Target the full fleet using a wildcard target (`"all"`)
- **FR-CORE-4:** Return per-device structured results for all multi-device operations
- **FR-CORE-5:** Report unreachable or failed devices individually without aborting the full fan-out operation

### FR-CRED: Credential Management

- **FR-CRED-1:** Resolve device credentials at runtime from a KeePass `.kdbx` vault
- **FR-CRED-2:** Accept the KeePass master password via `KEEPASS_PASSWORD` environment variable
- **FR-CRED-3:** Fail fast with a clear error if the vault is unavailable or cannot be opened
- **FR-CRED-4:** Never expose device credentials in tool outputs, audit logs, or error messages

### FR-SSH: SSH Connectivity & Command Execution

- **FR-SSH-1:** Open an SSH session per command, execute it, and close the session
- **FR-SSH-2:** Enforce SSH host key verification for all connections
- **FR-SSH-3:** Return a per-device error with context when a device is unreachable or a command times out
- **FR-SSH-4:** Return a per-device error with raw RouterOS output when a response cannot be parsed

### FR-IFACE: Interfaces

- **FR-IFACE-1:** List all interfaces (type, name, status, MAC) on one or more devices
- **FR-IFACE-2:** Get detailed interface statistics (TX/RX bytes, errors, drops) on one or more devices
- **FR-IFACE-3:** List interface lists and their members on one or more devices
- **FR-IFACE-4:** Enable or disable an interface on one or more devices

### FR-BRIDGE: Bridge

- **FR-BRIDGE-1:** List bridge interfaces on one or more devices
- **FR-BRIDGE-2:** List bridge port memberships on one or more devices
- **FR-BRIDGE-3:** List bridge VLAN entries on one or more devices
- **FR-BRIDGE-4:** List bridge host/MAC table entries on one or more devices

### FR-PPP: PPP

- **FR-PPP-1:** List PPP profiles on one or more devices
- **FR-PPP-2:** List PPP secrets (usernames, services, profiles) on one or more devices
- **FR-PPP-3:** List active PPP sessions on one or more devices
- **FR-PPP-4:** List PPP AAA configuration on one or more devices

### FR-IPADDR: IP — Addresses

- **FR-IPADDR-1:** List all IP addresses assigned to interfaces on one or more devices
- **FR-IPADDR-2:** Add an IP address to an interface on one or more devices
- **FR-IPADDR-3:** Remove an IP address from an interface on one or more devices

### FR-IPARP: IP — ARP

- **FR-IPARP-1:** List ARP table entries on one or more devices
- **FR-IPARP-2:** Add a static ARP entry on one or more devices
- **FR-IPARP-3:** Remove an ARP entry on one or more devices

### FR-DHCPC: IP — DHCP Client

- **FR-DHCPC-1:** List DHCP client configurations and current lease status on one or more devices
- **FR-DHCPC-2:** Release or renew a DHCP client lease on one or more devices

### FR-DHCPS: IP — DHCP Server

- **FR-DHCPS-1:** List DHCP server instances on one or more devices
- **FR-DHCPS-2:** List active DHCP leases on one or more devices
- **FR-DHCPS-3:** List DHCP networks (gateway, DNS, domain) on one or more devices
- **FR-DHCPS-4:** Add or remove a static DHCP lease on one or more devices

### FR-DNS: IP — DNS

- **FR-DNS-1:** Get DNS resolver configuration (servers, cache TTL, DoH) on one or more devices
- **FR-DNS-2:** List static DNS entries on one or more devices
- **FR-DNS-3:** Add or remove a static DNS entry on one or more devices
- **FR-DNS-4:** Flush the DNS cache on one or more devices

### FR-FW: IP — Firewall

- **FR-FW-1:** List firewall filter rules on one or more devices
- **FR-FW-2:** List NAT rules on one or more devices
- **FR-FW-3:** List mangle rules on one or more devices
- **FR-FW-4:** List address lists and their entries on one or more devices
- **FR-FW-5:** List active connections on one or more devices
- **FR-FW-6:** Add or remove a firewall filter rule on one or more devices
- **FR-FW-7:** Add or remove an address list entry on one or more devices

### FR-NBR: IP — Neighbors

- **FR-NBR-1:** List discovered neighbors (CDP/LLDP/MNDP) on one or more devices

### FR-POOL: IP — Pools

- **FR-POOL-1:** List IP address pools and their ranges on one or more devices
- **FR-POOL-2:** Add or remove an IP pool on one or more devices

### FR-ROUTE: IP — Routes

- **FR-ROUTE-1:** List routing table entries (active/inactive, static/dynamic) on one or more devices
- **FR-ROUTE-2:** Add or remove a static route on one or more devices

### FR-SVC: IP — Services

- **FR-SVC-1:** List IP service configurations (SSH, API, Winbox, WWW — ports and allowed addresses) on one or more devices
- **FR-SVC-2:** Enable, disable, or update an IP service on one or more devices

### FR-IPSET: IP — Settings

- **FR-IPSET-1:** Get IP settings (forwarding, RP filter, TCP settings) on one or more devices
- **FR-IPSET-2:** Update an IP setting on one or more devices

### FR-FILES: Files

- **FR-FILES-1:** List files on one or more devices (name, size, creation time)

### FR-LOG: Log

- **FR-LOG-1:** Retrieve log entries from one or more devices with optional count and topic filters

### FR-RADIUS: RADIUS

- **FR-RADIUS-1:** List configured RADIUS server entries on one or more devices
- **FR-RADIUS-2:** Add a RADIUS server entry on one or more devices
- **FR-RADIUS-3:** Update an existing RADIUS server entry on one or more devices
- **FR-RADIUS-4:** Remove a RADIUS server entry on one or more devices

### FR-SYS: System

- **FR-SYS-1 (Identity):** Get and set router hostname on one or more devices
- **FR-SYS-2 (Clock):** Get and set clock/time/timezone on one or more devices
- **FR-SYS-3 (NTP):** Get and update NTP client configuration on one or more devices
- **FR-SYS-4 (Users):** List local users and groups on one or more devices
- **FR-SYS-5 (Scheduler):** List scheduled tasks on one or more devices
- **FR-SYS-6 (Scripts):** List stored scripts and run a named script on one or more devices
- **FR-SYS-7 (Logging):** List logging rules and targets on one or more devices
- **FR-SYS-8 (Certificates):** List certificates on one or more devices
- **FR-SYS-9 (Health):** Get hardware health (voltage, temperature, fan, PSU) on one or more devices
- **FR-SYS-10 (Watchdog):** Get watchdog configuration on one or more devices
- **FR-SYS-11 (RouterBOOT):** Get RouterBOOT version and boot settings on one or more devices
- **FR-SYS-12 (Packages):** List installed packages and versions on one or more devices
- **FR-SYS-13 (License):** Get license level and software ID on one or more devices
- **FR-SYS-14 (Reboot/Shutdown):** Reboot or shutdown one or more devices
- **FR-SYS-15 (History):** Get configuration change history on one or more devices
- **FR-SYS-16 (Note):** Get and set the system note on one or more devices
- **FR-SYS-17 (SNMP):** Get and update SNMP agent configuration on one or more devices
- **FR-SYS-18 (LCD):** Get LCD panel configuration on one or more devices (no-op if hardware not present)

### FR-TOOLS: Tools

- **FR-TOOLS-1 (Ping):** Execute a ping from one or more devices to a target; return RTT and packet loss
- **FR-TOOLS-2 (Traceroute):** Execute a traceroute from one or more devices to a target
- **FR-TOOLS-3 (Bandwidth Test):** Initiate a bandwidth test from one or more devices to a target
- **FR-TOOLS-4 (Torch):** Get a real-time traffic snapshot for a specified interface and duration on one or more devices
- **FR-TOOLS-5 (Packet Sniffer):** Start/stop packet capture and retrieve a captured summary on one or more devices
- **FR-TOOLS-6 (Profile):** Get a CPU usage profile snapshot on one or more devices
- **FR-TOOLS-7 (Netwatch):** List Netwatch monitor entries and their current status on one or more devices
- **FR-TOOLS-8 (Fetch):** Fetch a file from a URL to one or more devices
- **FR-TOOLS-9 (Speed Test):** Run a speed test and return results on one or more devices
- **FR-TOOLS-10 (MAC Scan):** Run a MAC scan on a specified interface on one or more devices
- **FR-TOOLS-11 (IP Scan):** Run an IP scan on a specified range on one or more devices
- **FR-TOOLS-12 (WoL):** Send a Wake-on-LAN packet from one or more devices to a target MAC
- **FR-TOOLS-13 (Traffic Generator):** Start a traffic generator task on one or more devices

### FR-INFRA: Infrastructure & Deployment

- **FR-INFRA-1:** Operate over stdio transport for local/single-user use
- **FR-INFRA-2:** Operate over HTTP/SSE transport for shared team server use
- **FR-INFRA-3:** Deploy via Docker Compose with the KeePass vault file mounted as a volume
- **FR-INFRA-4:** Configure device registry via a config file: device ID → hostname/IP, port, KeePass entry, group memberships
- **FR-INFRA-5:** Resolve group membership from the device registry at runtime

### FR-AUDIT: Audit Logging

- **FR-AUDIT-1:** Record every tool execution in an append-only structured audit log
- **FR-AUDIT-2:** Each entry captures: ISO8601 timestamp, session ID, target device ID, command, success status, error details if applicable
- **FR-AUDIT-3:** Audit log entries never contain device passwords or the KeePass master password

### FR-TEST: Testing

- **FR-TEST-1:** Unit tests cover RouterOS output parsing logic for all tool implementations
- **FR-TEST-2:** Unit tests cover KeePass credential resolution logic
- **FR-TEST-3:** Integration tests execute tool calls against a real RouterOS 7 device and validate structured output

---

## Non-Functional Requirements

### Security

- **NFR-SEC-1:** Device passwords never appear in tool outputs, LLM context, audit logs, or error messages at any point in the execution chain
- **NFR-SEC-2:** The KeePass master password is never logged, never passed as a CLI argument, and never included in any output
- **NFR-SEC-3:** SSH host key verification is enforced for all connections — no automatic acceptance of unknown host keys
- **NFR-SEC-4:** The MCP server has no authentication layer in MVP — it relies on deployment-level trust (stdio = local process, HTTP/SSE = internal network only); this is documented explicitly as a deployment constraint
- **NFR-SEC-5:** No credentials are written to disk outside the KeePass vault

### Reliability & Error Handling

- **NFR-REL-1:** A single unreachable device must not abort or degrade results for other devices in a fan-out operation
- **NFR-REL-2:** A KeePass vault open failure must abort the operation immediately with a clear error — no partial execution or credential fallback
- **NFR-REL-3:** SSH command timeouts must be configurable; default to 10s per command
- **NFR-REL-4:** Parse errors must include raw RouterOS output to allow debugging without re-running the command
- **NFR-REL-5:** The audit log is append-only — no entry is ever modified or deleted

### Performance

- **NFR-PERF-1:** MVP uses sequential per-device SSH execution within fan-out — acceptable for fleets of this size; documented as a known limitation
- **NFR-PERF-2:** Each SSH session is opened per command and closed on completion — no persistent connection pooling in MVP
- **NFR-PERF-3:** The KeePass vault is opened once at server startup and kept in memory — not re-read on every tool call

### Compatibility

- **NFR-COMPAT-1:** RouterOS 7+ is the only supported target — v6 is explicitly out of scope for MVP
- **NFR-COMPAT-2:** Compatible with any MCP-compliant client (Claude Desktop, Cursor, VS Code Copilot, custom agents)
- **NFR-COMPAT-3:** Both stdio and HTTP/SSE MCP transports supported as defined in the MCP specification

### Maintainability

- **NFR-MAINT-1:** RouterOS output parsers are isolated from MCP tool handlers — a parser change does not require changes to the tool layer
- **NFR-MAINT-2:** Each RouterOS section's tools are grouped in a dedicated module — adding a new section does not require changes to existing modules
- **NFR-MAINT-3:** The device registry format is documented and human-editable without tooling

### Observability

- **NFR-OBS-1:** The server emits structured logs to stderr (not stdout, which is reserved for MCP stdio transport)
- **NFR-OBS-2:** Each tool invocation is traceable end-to-end via a session ID present in both runtime logs and the audit log

### Deployment

- **NFR-DEPLOY-1:** `docker-compose up` is the single command required to start the server in a production environment
- **NFR-DEPLOY-2:** The Docker image contains no credentials — all secrets are injected at runtime via environment variables or volume mounts
- **NFR-DEPLOY-3:** The KeePass `.kdbx` file is mounted as a read-only volume

### Parsing & Output Quality

- **NFR-PARSE-1:** All fields present in RouterOS CLI output must appear in the parsed response — no per-tool field filtering. Unknown or version-specific fields appear in an `_extra` object.
- **NFR-PARSE-2:** Type coercion is applied universally: `yes`/`no`/`true`/`false` → boolean; empty string for absent fields → `null`; pure numeric strings → number; fields in a security blocklist → `"[REDACTED]"`.
- **NFR-PARSE-3:** Every tool response includes a `_meta` envelope: command executed, target, device counts (queried/responded/failed), execution time in ms, and optional warnings array.

### Fleet Intelligence

- **NFR-FLEET-1:** All list/get tools accept an optional `level` parameter (`summary`, `detail`, `raw`). Default is `detail` (full per-device parsed results). `summary` groups identical results and surfaces outliers. `raw` returns unprocessed RouterOS CLI output.

### Write Safety

- **NFR-WRITE-1:** All mutating operations via `ros-command` default to `dryRun: true`. The response shows the exact command and target without executing. The caller must explicitly pass `dryRun: false` to execute.
- **NFR-WRITE-2:** Dedicated per-resource write tools are removed in favour of the universal `ros-command` tool with dry-run protection.
