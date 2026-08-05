# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
68 functional requirements across 25 categories covering the full RouterOS 7+ section surface:
infrastructure core (device targeting, credential management, SSH transport), all major RouterOS
sections (Interfaces, Bridge, PPP, IP sub-sections ×11, Files, Log, RADIUS, System ×18,
Tools ×13), plus infrastructure, audit logging, and testing requirements.

Write operations are present but scoped: IP Addresses, ARP, DHCP static leases, DNS static
entries, Firewall rules/address lists, IP Pools, Routes, IP Services, IP Settings, RADIUS
entries, System (Identity, Clock, NTP, SNMP, Note, LCD), System Tools (Ping, Traceroute,
Bandwidth Test, Torch, Packet Sniffer, Fetch, WoL, Traffic Generator), and Reboot/Shutdown.

**Non-Functional Requirements:**
- **Security (hard):** Zero credential leakage through entire execution chain; SSH host key
  verification enforced; no auth layer in MVP (deployment-trust model, explicitly documented)
- **Reliability:** Per-device failure isolation in fan-out; vault-unavailable = fail-fast;
  configurable SSH command timeout (default 10s); parse errors return raw output for debugging;
  append-only audit log
- **Performance:** Sequential SSH per-device in MVP (documented limitation); vault opened once
  at startup and kept in memory; one SSH session per command, no pooling
- **Maintainability:** Parsers isolated from tool handlers; RouterOS sections in dedicated
  modules; device registry human-editable without tooling
- **Observability:** Structured logs to stderr; session ID traces through runtime logs and
  audit log end-to-end
- **Deployment:** Single `docker-compose up`; no credentials in image; KeePass file as
  read-only volume mount

**Scale & Complexity:**

- Primary domain: TypeScript/Node.js API backend — MCP server
- Complexity level: Medium
- Estimated architectural components: ~8 (MCP server core, transport layer, tool registry,
  device registry, SSH transport, credential manager, audit logger, RouterOS parsers)

### Technical Constraints & Dependencies

- **Runtime:** TypeScript / Node.js
- **SSH:** `ssh2` library — RouterOS 7+ only (v6 explicitly out of scope)
- **KeePass:** `kdbxweb` — `.kdbx` format, master password via `KEEPASS_PASSWORD` env var
- **MCP SDK:** `@modelcontextprotocol/sdk` — both stdio and HTTP/SSE transports
- **Deployment:** Docker + docker-compose; KeePass `.kdbx` mounted read-only as volume
- **Test target:** Real RouterOS 7 hardware required for integration tests
- **No persistent connections:** One SSH session per command; no pooling in MVP

### Cross-Cutting Concerns Identified

1. **Credential management** — vault access touches SSH transport, error messages, audit log,
   and all tool implementations
2. **Audit logging** — every tool call must be captured regardless of transport or target type
3. **Per-device error aggregation** — fan-out results must carry both successes and failures;
   no silent drops
4. **Session ID propagation** — must thread through MCP request → tool dispatch → SSH
   execution → audit log entry
5. **RouterOS output parsing** — decoupled from tool handlers; parse errors must surface raw
   output; all parsers independently unit-testable
6. **Transport abstraction** — server core must be identical regardless of stdio vs HTTP/SSE
   transport

## Starter Template Evaluation

### Primary Technology Domain

TypeScript/Node.js API backend — MCP server (prescribed by PRD)

### Starter Options Considered

- **`@modelcontextprotocol/create-server` v0.3.1** — Official MCP TypeScript scaffold.
  Sets up `@modelcontextprotocol/sdk`, stdio transport entry point, TypeScript config,
  and basic tool registration pattern. Maintained by the MCP team.
- **Manual scaffold** — Full control, higher setup cost. Viable but adds no value given
  the official scaffold is minimal and non-opinionated.
- **`create-mcp-server` v0.0.1** — Community, pre-release, not suitable.

### Selected Starter: `@modelcontextprotocol/create-server` v0.3.1

**Rationale:** The official scaffold is minimal — it establishes the MCP SDK wiring and
TypeScript config without imposing a project structure. This leaves us free to layer in
our architecture (transport abstraction, tool registry, SSH layer, credential manager,
audit logger) without fighting the scaffold.

**Initialization Command:**

```bash
npx @modelcontextprotocol/create-server mikrotik-mcp
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript with strict mode; Node.js runtime
- **MCP SDK:** `@modelcontextprotocol/sdk` v1.29.0
- **Transport:** stdio entry point provided; HTTP/SSE transport to be added manually
- **Build Tooling:** `tsc` compilation to `dist/`; `npm run build` convention
- **Testing Framework:** Not included — Vitest to be added (see Core Architectural Decisions)
- **Code Organization:** Minimal — `src/index.ts` entry point only; full structure defined in Project Structure step

**Note:** Project initialization using this command should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Testing framework: Vitest
- RouterOS command interface: Raw SSH + CLI text parsing
- Device registry source: KeePass vault, dynamic per tool call
- Fleet addressing: single device by ID or `"all"` — no named groups

**Scope Corrections vs. PRD:**
- **FR-AUDIT (Audit Logging) — DROPPED:** The audit logging requirement in the PRD was
  a misinterpretation. "Audit" in the product context means fleet-wide security audits
  via MCP tools (e.g. "check all devices for open DNS resolvers"), not an internal
  execution log. FR-AUDIT-1/2/3 and NFR-REL-5 are removed from scope.
- **FR-CORE-2 (Named Groups) — DROPPED:** No group addressing needed. Fleet is a flat
  list. Targeting is single device by ID or `"all"`.
- **FR-INFRA-4/5 (Device Registry Config File) — REPLACED:** Static config file replaced
  by dynamic KeePass vault resolution on every tool call.

**Deferred Decisions (Post-MVP):**
- Parallel SSH execution (Phase 2 per PRD)
- Alternative credential backends (Phase 2 per PRD)

### Testing

- **Framework:** Vitest — native TypeScript, fast, first-class ESM support
- **Scope:** Unit tests for RouterOS output parsers; unit tests for KeePass credential
  resolution; integration tests against real RouterOS 7 hardware

### RouterOS Command Interface

- **Approach:** Raw SSH + CLI text parsing
- **Method:** Send RouterOS CLI commands directly over SSH (e.g. `/ip address print`),
  parse the returned plain-text output
- **Rationale:** Maximum device compatibility, no extra services required on the device,
  works with RouterOS 7+ out of the box

### Device Registry

- **Source:** KeePass vault — no static config file
- **Group:** Configurable via `KEEPASS_GROUP` env var; default `mikrotik`
- **Field mapping:**
  - Title → device ID (e.g. `chr-85`)
  - Username → SSH username
  - Password → SSH password
  - URL → hostname / IP
  - Port → always 22 (hardcoded)
- **Structure:** Flat list — no sub-groups, no site grouping
- **Lifecycle:** Vault re-read on every tool call — fully stateless, no caching
- **Targeting:** Single device by ID, or `"all"` for full fleet

### Infrastructure & Deployment

- **Transports:** stdio (local) + HTTP/SSE (shared team server)
- **Deployment:** Docker + docker-compose; KeePass `.kdbx` mounted read-only as volume
- **Credentials:** `KEEPASS_PASSWORD` + `KEEPASS_GROUP` env vars; nothing else in image
- **No auth layer in MVP:** deployment-trust model (documented constraint)

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Code naming (TypeScript):**
- Functions/variables: `camelCase` — `getDeviceList`, `sshTimeout`
- Classes/interfaces/types: `PascalCase` — `DeviceResult`, `KeePassCredential`
- Constants/env vars: `SCREAMING_SNAKE_CASE` — `KEEPASS_GROUP`, `SSH_TIMEOUT_MS`
- Files: `kebab-case` — `ssh-transport.ts`, `keepass-client.ts`

**MCP tool names:** `kebab-case` — `interface-list`, `ip-address-list`, `system-reboot`

**RouterOS section modules:** one file per RouterOS section — `interfaces.ts`, `bridge.ts`,
`ip-address.ts`

### Format Patterns

**MCP tool output — every tool returns `DeviceResult[]`:**
```typescript
type DeviceResult = {
  deviceId: string;
  success: boolean;
  data?: unknown;
  error?: string;
};
```

**Error messages:** never include password, hostname credentials, or vault path; always
include `deviceId` and a human-readable message.

**RouterOS CLI commands:** always use `print` with `detail` flag where applicable for
consistent field output — e.g. `/ip address print detail`

### Structure Patterns

**RouterOS section module pattern** — every section module exports a single registration
function:
```typescript
// src/tools/interfaces.ts
export function registerInterfaceTools(server: McpServer, deps: ToolDeps): void
```

**SSH execution pattern** — always via a single `executeCommand(deviceId, command)`
function; tool handlers never open SSH directly.

**KeePass resolution** — always via a single `resolveCredentials(deviceId)` function;
credential objects never leave the credential layer.

### Process Patterns

**Fan-out pattern** — always `Promise.allSettled` over device list, mapped to
`DeviceResult[]`; never `Promise.all` (one failure must not abort others).

**Error propagation** — tool handlers never `throw`; they return `DeviceResult` with
`success: false` and `error` string. Only vault-open failure throws (fail-fast at startup).

**SSH per-command** — open connection, run command, close; no reuse across commands.

### Enforcement: All Agents MUST

- Return `DeviceResult[]` from every tool — no exceptions
- Never access KeePass or SSH directly in tool handlers — always through the abstraction layer
- Never log or include credentials in any output, error, or `data` field
- Register tools via `registerXxxTools` — never ad-hoc in `index.ts`

## Project Structure & Boundaries

### Complete Project Directory Structure

```
mikrotik-mcp/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
│
├── config/
│   └── keepass.kdbx              # mounted as read-only volume at runtime (not committed)
│
├── src/
│   ├── index.ts                  # entry point — selects transport (stdio or HTTP/SSE)
│   ├── server.ts                 # MCP server setup, tool registration, transport-agnostic core
│   │
│   ├── keepass/
│   │   └── keepass-client.ts     # vault open, resolveCredentials(deviceId), listDevices()
│   │
│   ├── ssh/
│   │   └── ssh-transport.ts      # executeCommand(deviceId, command): Promise<string>
│   │
│   ├── types/
│   │   └── index.ts              # DeviceResult, ToolDeps, KeePassCredential, etc.
│   │
│   └── tools/                    # one file per RouterOS section
│       ├── index.ts              # re-exports all registerXxxTools functions
│       ├── interfaces.ts         # FR-IFACE
│       ├── bridge.ts             # FR-BRIDGE
│       ├── ppp.ts                # FR-PPP
│       ├── ip-address.ts         # FR-IPADDR
│       ├── ip-arp.ts             # FR-IPARP
│       ├── ip-dhcp-client.ts     # FR-DHCPC
│       ├── ip-dhcp-server.ts     # FR-DHCPS
│       ├── ip-dns.ts             # FR-DNS
│       ├── ip-firewall.ts        # FR-FW
│       ├── ip-neighbors.ts       # FR-NBR
│       ├── ip-pool.ts            # FR-POOL
│       ├── ip-routes.ts          # FR-ROUTE
│       ├── ip-services.ts        # FR-SVC
│       ├── ip-settings.ts        # FR-IPSET
│       ├── files.ts              # FR-FILES
│       ├── log.ts                # FR-LOG
│       ├── radius.ts             # FR-RADIUS
│       ├── system.ts             # FR-SYS (all 18 sub-requirements)
│       └── tools.ts              # FR-TOOLS (all 13 sub-requirements)
│
└── tests/
    ├── unit/
    │   ├── keepass/
    │   │   └── keepass-client.test.ts
    │   └── tools/                # one test file per section parser
    │       ├── interfaces.test.ts
    │       ├── ip-address.test.ts
    │       └── ...
    └── integration/
        └── tools/                # integration tests against real RouterOS 7 hardware
            ├── interfaces.test.ts
            └── ...
```

### Architectural Boundaries

- **`keepass-client.ts`** — sole owner of vault access; exports `resolveCredentials(deviceId)`
  and `listDevices()`; never called directly from tool handlers
- **`ssh-transport.ts`** — sole owner of SSH connections; called only via `ToolDeps`
  injection; never instantiated in tool files
- **`tools/*.ts`** — pure tool logic; depend on `ToolDeps` interface (injected); no direct
  imports of keepass or ssh modules
- **`server.ts`** — single wiring point; instantiates deps, calls all `registerXxxTools`
- **`index.ts`** — transport selection only (stdio vs HTTP/SSE via env); delegates to `server.ts`

### Data Flow

```
MCP Client
  → index.ts (transport: stdio | HTTP/SSE)
  → server.ts (tool dispatch)
  → tools/xxx.ts (tool handler)
      → keepass-client.ts  resolveCredentials() + listDevices()
      → ssh-transport.ts   executeCommand(deviceId, command) per device
  → DeviceResult[]
  → MCP Client
```

### Requirements to Structure Mapping

| FR Category | Location |
|---|---|
| FR-CORE (targeting/fan-out) | `server.ts` + `keepass-client.ts` |
| FR-CRED (credential mgmt) | `keepass/keepass-client.ts` |
| FR-SSH (SSH transport) | `ssh/ssh-transport.ts` |
| FR-IFACE | `tools/interfaces.ts` |
| FR-BRIDGE | `tools/bridge.ts` |
| FR-PPP | `tools/ppp.ts` |
| FR-IPADDR/ARP/DHCPC/DHCPS/DNS/FW/NBR/POOL/ROUTE/SVC/IPSET | `tools/ip-*.ts` |
| FR-FILES | `tools/files.ts` |
| FR-LOG | `tools/log.ts` |
| FR-RADIUS | `tools/radius.ts` |
| FR-SYS | `tools/system.ts` |
| FR-TOOLS | `tools/tools.ts` |
| FR-INFRA (transports/Docker) | `index.ts`, `Dockerfile`, `docker-compose.yml` |
| FR-TEST | `tests/unit/`, `tests/integration/` |

## Architecture Validation Results

### Coherence Validation ✅

All technology decisions are compatible. `ssh2` + `kdbxweb` + `@modelcontextprotocol/sdk`
are all Node.js libraries with no conflicts. Vitest works with TypeScript strict mode.
Patterns align with NFRs. Structure enforces credential and SSH isolation architecturally
rather than by convention.

### Requirements Coverage Validation ✅

All active FR categories have structural homes. All NFRs are architecturally addressed.
FR-AUDIT, FR-CORE-2, FR-INFRA-4/5 scope corrections documented in Core Decisions.

### Gap Analysis & Resolutions

**Session ID (NFR-OBS-2) — resolved:**
`ToolDeps` interface must include `sessionId: string`, generated per MCP request in
`server.ts` using `crypto.randomUUID()` and injected into all tool handler calls.

**Environment variables — complete list:**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `KEEPASS_PASSWORD` | Yes | — | KeePass master password |
| `KEEPASS_PATH` | No | `/config/keepass.kdbx` | Path to vault file inside container |
| `KEEPASS_GROUP` | No | `mikrotik` | KeePass group to enumerate devices from |
| `SSH_TIMEOUT_MS` | No | `10000` | Per-command SSH timeout in milliseconds |
| `MCP_TRANSPORT` | No | `stdio` | Transport: `stdio` or `http` |
| `MCP_PORT` | No | `3000` | HTTP/SSE listen port (ignored when transport is stdio) |

**Code quality tooling — resolved:**
ESLint + Prettier to be configured in the project scaffold story. Agents must not
introduce alternative formatters.

### Architecture Completeness Checklist

- [x] Project context analyzed and scope corrections documented
- [x] Full technology stack specified with versions
- [x] Device registry design: KeePass-driven, stateless, dynamic
- [x] RouterOS command interface: raw SSH + CLI text parsing
- [x] Fan-out pattern: `Promise.allSettled`, `DeviceResult[]`
- [x] Credential isolation boundary: `keepass-client.ts` only
- [x] SSH isolation boundary: `ssh-transport.ts` only
- [x] Tool registration pattern: `registerXxxTools` per section
- [x] Testing: Vitest, unit + integration, real hardware
- [x] All 25 FR categories mapped to files
- [x] All NFRs architecturally addressed
- [x] Session ID propagation specified
- [x] Environment variables fully enumerated
- [x] Docker deployment structure defined

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION
**Confidence Level:** High

**Key Strengths:**
- Credential isolation is architectural, not procedural — impossible to leak by accident
- Stateless vault + SSH per-call design is simple and fully testable
- One-file-per-section structure scales linearly with RouterOS surface area
- `ToolDeps` injection makes unit testing trivial (mock KeePass + SSH)

**Areas for Future Enhancement (Phase 2):**
- Parallel SSH fan-out (replace sequential execution with concurrent `Promise.allSettled`)
- Connection pooling
- Alternative credential backends

---

## Architecture Revision: Parser Redesign & Fleet Intelligence (2026-04-27)

### Trigger

Fleet-wide dogfooding across all read commands revealed that per-tool parser functions silently drop fields. The architecture's original pattern — dedicated `parseXxx()` functions cherry-picking known fields — is structurally unable to pass through version-specific or newly-added RouterOS fields, and is the root cause of 10 parsing bugs.

### Decision: Universal Record Normalization

**Replace** all per-tool parser functions (`parseFirewallFilter`, `parseFirewallNat`, `parseServices`, etc.) with a single universal normalizer.

```typescript
// src/parsers.ts (new file — replaces parser logic previously in tool files)

const REDACTED_FIELDS = new Set(['secret', 'password', 'private-key']);

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function coerce(v: string): unknown {
  if (v === '') return null;
  if (v === 'yes' || v === 'true') return true;
  if (v === 'no' || v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

export function normalizeRecord(r: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(r)) {
    if (REDACTED_FIELDS.has(key)) {
      out[kebabToCamel(key)] = '[REDACTED]';
    } else {
      out[kebabToCamel(key)] = coerce(value);
    }
  }
  return out;
}
```

**Tool handlers become:**
```typescript
const raw = await d.ssh.executeCommand(cred, '/ip/firewall/filter/print detail');
return parseDetailRecords(raw).map(normalizeRecord);
```

No per-tool mapping. All fields pass through. Booleans are native. Missing fields are `null`.

### Decision: Response Envelope

**All tools** use a shared `buildResponse()` utility that wraps results in metadata:

```typescript
// src/response.ts (new file)

interface ToolResponse {
  _meta: {
    command: string;
    target: string;
    devicesQueried: number;
    devicesResponded: number;
    devicesFailed: number;
    executionMs: number;
    warnings?: string[];
    dryRun?: boolean;
  };
  results: DeviceResult[];
  summary?: FleetSummary;
}
```

This replaces the current bare `JSON.stringify(results, null, 2)` pattern.

### Decision: Fleet Summary Mode

The fan-out response builder supports a `level` parameter:

- **`detail`** (default): Full `DeviceResult[]` as today, but with normalized records
- **`summary`**: Group structurally identical results, return count + sample per group + outlier list
- **`raw`**: Return unprocessed RouterOS CLI text per device (no parsing)

```typescript
interface FleetSummary {
  totalDevices: number;
  groups: Array<{
    count: number;
    deviceIds: string[];
    sample: Record<string, unknown>;
  }>;
  outliers: Array<{
    deviceId: string;
    differences: string[];
  }>;
}
```

Grouping uses structural equality (JSON hash) of the normalized records, ignoring device-specific transient fields (e.g., uptime counters).

### Decision: Write Tool Consolidation

**Remove** all dedicated write tools (`system-identity-set`, `system-clock-set`, `firewall-filter-add`, `firewall-filter-remove`, `firewall-nat-add`, `firewall-nat-remove`, etc.).

**Keep** only `ros-command` as the universal write tool, with `dryRun: true` as default:

```typescript
server.registerTool('ros-command', {
  inputSchema: {
    target: z.string(),
    command: z.string().describe('RouterOS CLI command to execute'),
    dryRun: z.boolean().default(true).describe('If true (default), show command without executing'),
  },
});
```

When `dryRun: true`, the response shows the command and target without executing. The LLM must explicitly pass `dryRun: false` to run mutating operations.

### Decision: Fixture-Based Testing

Parser tests use captured real RouterOS output stored as fixtures:

```
tests/fixtures/
  firewall-filter/
    v7.13-sample.txt     # raw CLI output
    v7.14-sample.txt
    v7.22-sample.txt
  ip-address/
    v7.13-sample.txt
    ...
```

Each test asserts `parseDetailRecords(fixture).map(normalizeRecord)` produces expected typed output. No field present in raw output may be absent from parsed output.

### Updated Project Structure

```
src/
  parsers.ts              # NEW — normalizeRecord, coerce, toBool, kebabToCamel, REDACTED_FIELDS
  response.ts             # NEW — buildResponse(), FleetSummary, groupResults()
  fan-out.ts              # MODIFIED — accepts level param, delegates to response.ts
  tools/*.ts              # MODIFIED — remove per-tool parsers, use normalizeRecord + buildResponse
tests/
  fixtures/               # NEW — real RouterOS output per command per version
```

### Updated Enforcement Rules

- Return `ToolResponse` (with `_meta` envelope) from every tool — no bare `JSON.stringify`
- Never write a per-tool parser function — use `normalizeRecord` universally
- Never add a dedicated write tool — all mutations go through `ros-command`
- All write tool calls default to `dryRun: true`
- Fixture tests must exist for any parser change

### Implementation Handoff

**First implementation story:** `npx @modelcontextprotocol/create-server mikrotik-mcp`,
then scaffold `src/` structure, configure ESLint/Prettier/Vitest, define `ToolDeps` type.

**AI Agent Guidelines:**
- Return `DeviceResult[]` from every tool — no exceptions
- Never bypass `keepass-client.ts` or `ssh-transport.ts`
- Never include credentials in any output or error string
- One `registerXxxTools` function per RouterOS section file
- `sessionId` from `ToolDeps` must be present in all structured log entries

---

## Architecture Revision: REST API Transport Migration (2026-04-28)

### Trigger

RouterOS 7.1+ exposes a REST API at `/rest/...` that returns native JSON, eliminating the need for CLI text parsing — the root cause of every parsing bug encountered while the SSH transport was primary.

The REST API is well-documented by MikroTik, maps 1:1 to RouterOS menu paths, uses standard HTTP verbs (GET/PUT/PATCH/DELETE/POST), and requires only HTTP Basic Auth with the same credentials already stored in KeePass.

### Decision: Smart Transport Abstraction

**Replace** the SSH-only `SshTransport` interface in `ToolDeps` with a unified `DeviceTransport` interface that returns **typed JSON** regardless of underlying protocol.

```typescript
// src/types/index.ts

/** A single record returned by RouterOS (already key-value, string values). */
type RosRecord = Record<string, string>;

/** Unified transport interface — returns parsed records, never raw text. */
export interface DeviceTransport {
  /**
   * Execute a read command and return parsed records.
   * - REST: GET /rest/<path> → JSON array → RosRecord[]
   * - SSH:  executeCommand(path + " print detail") → parseDetailRecords() → RosRecord[]
   */
  query(credential: KeePassCredential, path: string): Promise<RosRecord[]>;

  /**
   * Execute a write/action command and return the response.
   * - REST: POST/PUT/PATCH/DELETE /rest/<path> with body → JSON
   * - SSH:  executeCommand(path + " " + args) → raw string
   */
  execute(credential: KeePassCredential, command: string, args?: Record<string, string>): Promise<unknown>;

  /**
   * Execute a raw command string (for ros-command tool and diagnostics).
   * - REST: POST /rest/<path> with body
   * - SSH:  executeCommand(command) → raw string
   */
  raw(credential: KeePassCredential, command: string): Promise<string>;
}
```

**Key design principle:** The transport is "smart" — it owns the translation between its native protocol and the common `RosRecord[]` return type. REST returns JSON natively (just needs array unwrapping). SSH internally calls `parseDetailRecords()` before returning. Tool handlers never know which transport is active.

**Tool handlers become:**
```typescript
// Before (SSH-only, raw text parsing in handler):
const raw = await d.ssh.executeCommand(cred, '/ip/firewall/filter/print detail');
return parseDetailRecords(raw).map(normalizeRecord);

// After (transport-agnostic, parsed records):
const records = await d.transport.query(cred, '/ip/firewall/filter');
return records.map(normalizeRecord);
```

`normalizeRecord()` is still needed for both transports — REST returns all values as strings (per MikroTik docs), so camelCase conversion and type coercion (`"true"` → `true`, `"22"` → `22`, `""` → `null`) still apply.

### Decision: REST Transport Implementation

```typescript
// src/rest/rest-transport.ts — sole owner of HTTP connections to RouterOS devices

export class RestTransportImpl implements DeviceTransport {
  private readonly port: number;      // default 443, configurable via ROUTEROS_REST_PORT
  private readonly scheme: string;    // default 'https', configurable via ROUTEROS_REST_SCHEME
  private readonly timeoutMs: number; // reuses ROUTEROS_TIMEOUT_MS (default 10000)

  async query(credential: KeePassCredential, path: string): Promise<RosRecord[]> {
    // GET https://<hostname>:<port>/rest/<path>
    // HTTP Basic Auth with credential.username:credential.password
    // Returns JSON array of records
  }

  async execute(credential: KeePassCredential, command: string, args?: Record<string, string>): Promise<unknown> {
    // POST https://<hostname>:<port>/rest/<command>
    // Body: JSON args
    // Returns JSON response
  }

  async raw(credential: KeePassCredential, command: string): Promise<string> {
    // POST https://<hostname>:<port>/rest/<path>
    // Returns JSON stringified for compatibility
  }
}
```

**REST API specifics (from MikroTik documentation):**
- All response values are JSON strings, even numbers and booleans
- `GET /rest/ip/address` = `/ip/address/print`
- `PUT /rest/ip/address` = `/ip/address/add` (body: JSON object)
- `PATCH /rest/ip/address/*1` = `/ip/address/set *1` (body: JSON fields to update)
- `DELETE /rest/ip/address/*1` = `/ip/address/remove *1`
- `POST /rest/<path>` = universal, any console command
- Filtering via query params: `?network=192.0.2.0&dynamic=true`
- Property selection via `?.proplist=address,disabled`
- 60-second hard timeout per request on the RouterOS side
- Errors return `{"error": <code>, "message": "...", "detail": "..."}`

**SSH transport adapts to the same interface:**
```typescript
// src/ssh/ssh-transport.ts — updated to implement DeviceTransport

export class SshTransportImpl implements DeviceTransport {
  async query(credential: KeePassCredential, path: string): Promise<RosRecord[]> {
    // Translates path to CLI: '/ip/firewall/filter' → '/ip/firewall/filter/print detail'
    const raw = await this.executeCommand(credential, path + '/print detail');
    return parseDetailRecords(raw);
  }

  async execute(credential: KeePassCredential, command: string, args?: Record<string, string>): Promise<unknown> {
    // Builds CLI command from path + args
    const raw = await this.executeCommand(credential, command);
    return raw;
  }

  async raw(credential: KeePassCredential, command: string): Promise<string> {
    return this.executeCommand(credential, command);
  }

  // Existing executeCommand() becomes private internal method
}
```

### Decision: Transport Selection via Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ROUTEROS_TRANSPORT` | No | `rest` | Device transport: `rest` or `ssh` |
| `ROUTEROS_REST_PORT` | No | `443` | REST API port on devices |
| `ROUTEROS_REST_SCHEME` | No | `https` | `https` or `http` |
| `ROUTEROS_TIMEOUT_MS` | No | `10000` | Per-command timeout (replaces `SSH_TIMEOUT_MS`) |

**Note:** `SSH_TIMEOUT_MS` is renamed to `ROUTEROS_TIMEOUT_MS` since it now applies to both transports. Backward compatibility: if `SSH_TIMEOUT_MS` is set and `ROUTEROS_TIMEOUT_MS` is not, fall back to `SSH_TIMEOUT_MS`.

**Example configuration:**
```env
ROUTEROS_TRANSPORT=rest
ROUTEROS_REST_PORT=443
ROUTEROS_REST_SCHEME=https
```

### Decision: KeePass Field Mapping Update

The existing KeePass field mapping remains unchanged:
- Title → device ID
- Username → auth username (same for SSH and REST Basic Auth)
- Password → auth password (same for SSH and REST Basic Auth)
- URL → hostname/IP
- Port → **currently hardcoded to 22** — becomes unused when REST is active. The REST port is configured fleet-wide via the `ROUTEROS_REST_PORT` env var rather than per-device.

**Future option:** If per-device port variation is needed, the KeePass Port field could be used.

### Decision: Updated ToolDeps Interface

```typescript
export interface ToolDeps {
  keepass: KeePassClient;
  transport: DeviceTransport;  // was: ssh: SshTransport
  sessionId: string;
}
```

All tool handlers change from `d.ssh.executeCommand(...)` to `d.transport.query(...)` or `d.transport.execute(...)`.

### Decision: Diagnostic/Action Commands

Some RouterOS commands are not simple CRUD on a resource path — they're actions (ping, traceroute, bandwidth-test, torch, etc.). These use the `POST` method in REST and `raw()` in the transport interface:

```typescript
// Diagnostics example — ping
// SSH:  /ping address=192.0.2.1 count=4
// REST: POST /rest/ping  body: {"address":"192.0.2.1","count":"4"}

const result = await d.transport.execute(cred, '/ping', { address, count: String(c) });
```

REST has a 60-second hard timeout on the RouterOS side. Long-running diagnostic commands (bandwidth-test, torch) must include duration/count limits. The `raw()` method is kept for `ros-command` tool backward compatibility.

### Impact on Existing Architecture Decisions

| Original Decision | Status | Notes |
|---|---|---|
| Raw SSH + CLI text parsing | **Superseded** | REST is primary; SSH retained as fallback transport behind same interface |
| `SshTransport` interface | **Replaced** | By `DeviceTransport` — SSH becomes one implementation |
| `ssh-transport.ts` sole owner of SSH | **Preserved** | Still true, but now implements `DeviceTransport` |
| `parseDetailRecords` + `normalizeRecord` | **Preserved for SSH path** | REST doesn't need text parsing, but `normalizeRecord` still needed for type coercion |
| `SSH_TIMEOUT_MS` env var | **Renamed** | → `ROUTEROS_TIMEOUT_MS` (backward compatible) |
| Port always 22 (hardcoded) | **Transport-dependent** | SSH still 22; REST uses `ROUTEROS_REST_PORT` |
| One SSH session per command | **Transport-dependent** | REST uses HTTP keep-alive (Node.js default); SSH unchanged |

### Impact on Epic 11 Stories

| Story | Original Scope | New Status |
|---|---|---|
| **11-1** Universal Parser & Type Coercion | `parsers.ts` with `normalizeRecord` | **Done** — already implemented. Remains needed for both transports (type coercion). |
| **11-2** Response Envelope & Metadata | `_meta` wrapper on all responses | **Unchanged** — still needed, transport-independent |
| **11-3** Migrate All Tools to Universal Parser | Remove per-tool parsers | **Replaced** — becomes "Migrate all tools to `DeviceTransport` interface". Per-tool parsers are eliminated by using `transport.query()` which returns pre-parsed records. |
| **11-4** Fleet Summary Mode | `level` param with grouping | **Unchanged** — transport-independent |
| **11-5** Write Tool Consolidation & Dry-Run | `ros-command` with `dryRun` | **Unchanged** — transport-independent; REST makes dry-run even cleaner (show the HTTP request that would be sent) |
| **11-6** Fixture-Based Parser Tests | Real RouterOS output fixtures | **Modified** — REST fixtures are JSON (trivial to validate). SSH fixtures still useful for fallback path. Lower priority. |
| **11-7** Runtime Schema Validation | Zod `.safeParse()` on outputs | **Unchanged** — transport-independent |

**New stories needed:**
| Story | Scope |
|---|---|
| **11-8** REST Transport Implementation | Create `RestTransportImpl`, `DeviceTransport` interface, env var handling |
| **11-9** SSH Transport Adaptation | Refactor `SshTransportImpl` to implement `DeviceTransport`, move parsing inside transport |
| **11-10** Tool Handler Migration | Change all `d.ssh.executeCommand()` calls to `d.transport.query()`/`.execute()`, update `ToolDeps` |
| **11-11** Diagnostic Command Adaptation | Migrate ping, traceroute, torch, bandwidth-test etc. to `transport.execute()` with proper arg mapping |

### Updated Data Flow

```
MCP Client
  → index.ts (MCP transport: stdio | HTTP/SSE)
  → server.ts (tool dispatch, transport selection)
  → tools/xxx.ts (tool handler)
      → keepass-client.ts   resolveCredentials() + listDevices()
      → DeviceTransport     query() | execute() | raw()
          ├── RestTransportImpl   GET/POST/PUT/PATCH/DELETE → JSON
          └── SshTransportImpl    SSH → CLI text → parseDetailRecords()
      → normalizeRecord()   type coercion (both paths)
  → DeviceResult[]
  → MCP Client
```

### Updated Project Structure

```
src/
  types/
    index.ts              # MODIFIED — DeviceTransport interface, RosRecord type
  rest/
    rest-transport.ts     # NEW — RestTransportImpl
  ssh/
    ssh-transport.ts      # MODIFIED — implements DeviceTransport, parsing internalized
  parsers.ts              # PRESERVED — used internally by SSH transport
  server.ts               # MODIFIED — transport selection based on ROUTEROS_TRANSPORT
  tools/*.ts              # MODIFIED — d.transport.query() instead of d.ssh.executeCommand()
```

### Updated Enforcement Rules

- Tool handlers call `d.transport.query()` for reads and `d.transport.execute()` for writes — never construct HTTP requests or SSH commands directly
- `rest-transport.ts` is the sole owner of HTTP connections to RouterOS devices — no other module may use `fetch` against device IPs
- `ssh-transport.ts` remains sole owner of SSH connections
- `normalizeRecord()` is called on all records regardless of transport (REST values are strings too)
- Never bypass `DeviceTransport` in tool handlers — no direct `ssh2` or `fetch` imports in `tools/`
- Credential handling unchanged: passwords flow through `DeviceTransport` methods only, never logged or included in output

### Security Considerations

- **HTTP vs HTTPS:** HTTP Basic Auth over unencrypted HTTP exposes device credentials to passive eavesdropping. Deployments should enable `www-ssl` on RouterOS and set `ROUTEROS_REST_SCHEME=https`; plain HTTP is acceptable only on a trusted, segmented management network.
- **REST Basic Auth credentials** are the same as SSH credentials — no new secret surface.
- **Error sanitization:** `RestTransportImpl` must strip credentials from error messages, same as `SshTransportImpl.sanitize()`.
- **TLS verification:** When `ROUTEROS_REST_SCHEME=https`, self-signed certs require either `NODE_TLS_REJECT_UNAUTHORIZED=0` (not recommended) or importing the RouterOS CA cert. Document this clearly.

### Migration Strategy

**Phase 1 (stories 11-8, 11-9):** Build both transports implementing `DeviceTransport`. SSH transport internalizes parsing. Both pass the same test suite.

**Phase 2 (story 11-10):** Migrate all tool handlers from `d.ssh.executeCommand()` to `d.transport.query()`/`.execute()`. This is the big diff — ~100 call sites across all tool files.

**Phase 3 (story 11-11):** Adapt diagnostic/action commands that don't fit the simple query/execute pattern.

**Phase 4 (stories 11-2, 11-4, 11-5):** Response envelope, fleet summary, and dry-run — now built on the cleaner transport-agnostic foundation.
