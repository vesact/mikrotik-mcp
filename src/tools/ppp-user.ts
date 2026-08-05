/**
 * PPP & User Management tools.
 * RouterOS sections: /ppp, /user, /system/scheduler, /system/logging, /system/script
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fanOut } from '../fan-out.js';
import type { KeePassClient, DeviceTransport, ToolDeps } from '../types/index.js';
import { parseDetailRecords, parseKeyValue, normalizeRecord } from '../parsers.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parsePppProfiles(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

/** Parse PPP secrets — password redacted via REDACTED_FIELDS */
export function parsePppSecrets(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parsePppActive(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parsePppAaa(raw: string): Record<string, unknown> {
  return normalizeRecord(parseKeyValue(raw));
}

/** Parse system users — password redacted via REDACTED_FIELDS */
export function parseUsers(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseScheduler(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseLogging(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

export function parseScripts(raw: string): Record<string, unknown>[] {
  return parseDetailRecords(raw).map(normalizeRecord);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerPppUserTools(
  server: McpServer,
  keepass: KeePassClient,
  transport: DeviceTransport,
): void {
  server.registerTool(
    'ppp-profiles-list',
    {
      description: 'List PPP profiles on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ppp/profile');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'ppp-secrets-list',
    {
      description: 'List PPP secrets on one or all devices (passwords redacted)',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ppp/secret');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'ppp-active-list',
    {
      description: 'List active PPP sessions on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/ppp/active');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'ppp-aaa-get',
    {
      description: 'Get PPP AAA configuration on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        const records = await d.transport.query(cred, '/ppp/aaa');
        return records[0] ?? {};
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'system-users-list',
    {
      description: 'List system users on one or all devices (passwords never included)',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/user');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'system-scheduler-list',
    {
      description: 'List scheduled tasks on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/system/scheduler');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'system-logging-list',
    {
      description: 'List logging rules on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/system/logging');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    'system-scripts-list',
    {
      description: 'List stored scripts on one or all devices',
      inputSchema: { target: z.string().describe("Device ID, comma-separated IDs, or 'all'") },
    },
    async ({ target }) => {
      const deps: ToolDeps = { keepass, transport, sessionId: randomUUID() };
      const results = await fanOut(deps, target, async (cred, d) => {
        return d.transport.query(cred, '/system/script');
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
