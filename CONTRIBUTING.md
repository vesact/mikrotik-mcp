# Contributing to mikrotik-mcp

Thanks for your interest in contributing!

## Getting started

```bash
npm ci
npm run build
npm test
```

Unit tests (`npm test`) run entirely against fixtures — no MikroTik hardware required. Integration tests (`npm run test:integration`) need a reachable RouterOS device; copy `.env.test.example` to `.env.test` and point it at a lab device. **Never run integration tests against production equipment.**

### Editor setup

Install the official [Biome extension](https://biomejs.dev/guides/editors/first-party-extensions/) for your editor (VS Code, Zed, IntelliJ) and set it as the default formatter. It replaces the ESLint and Prettier extensions — having those installed alongside it will produce conflicting formatting.

## Guidelines

- **TypeScript, strict mode.** Linting and formatting are both handled by [Biome](https://biomejs.dev) (config in `biome.json`). Run `npm run check` before pushing — `npm run check:fix` applies everything Biome can fix on its own. CI runs the same checks via `npm run ci`.
- **Tests accompany changes.** New tools or parsers need unit tests; transport changes should include fixture-based tests.
- **No credentials in code.** Test scripts must read connection details from environment variables (see `scripts/test-rest-transport.ts` for the pattern). Anything containing real device details belongs in `.gitignore`.
- **REST first.** New tools should use the REST transport. SSH is reserved for free-form command execution (`ros-command`).
- **Read-only classification.** When adding a tool, decide whether it belongs in the `READ_ONLY_TOOLS` allow-list in `src/server.ts`. Only pure state queries qualify — anything that writes configuration or generates network traffic does not.

## Pull requests

1. Fork and create a feature branch.
2. Make your change with tests.
3. Ensure `npm run build && npm run check && npm test` all pass.
4. Open a PR describing what the change does and why.

## Reporting bugs

Open a GitHub issue with the RouterOS version, the tool invoked, and the (sanitized) error output. Please redact hostnames, IPs, and credentials from logs before posting.
