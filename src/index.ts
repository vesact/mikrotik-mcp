/**
 * Entry point — selects transport based on MCP_TRANSPORT env var.
 * stdout is reserved for MCP protocol messages; all logs go to stderr.
 *
 * HTTP mode supports both:
 *  - Streamable HTTP (2025-03-26) on POST/GET/DELETE /mcp
 *  - Legacy SSE (2024-11-05) on GET /sse + POST /messages
 */

import { randomUUID } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from './server.js';

const transportType = process.env.MCP_TRANSPORT ?? 'stdio';
const httpPort = parseInt(process.env.MCP_HTTP_PORT ?? '3000', 10);
const httpHost = process.env.MCP_HOST ?? '0.0.0.0';

/** Active transports keyed by session ID */
const transports: Record<string, StreamableHTTPServerTransport | SSEServerTransport> = {};

/**
 * Parse JSON body from an incoming request (needed for the raw http module).
 */
function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', reject);
  });
}

async function main(): Promise<void> {
  process.stderr.write(`[mikrotik-mcp] Starting with transport: ${transportType}\n`);

  if (transportType === 'stdio') {
    const server = await createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('[mikrotik-mcp] Server running on stdio\n');
    return;
  }

  if (transportType !== 'http') {
    process.stderr.write(`[mikrotik-mcp] Unknown transport: ${transportType}\n`);
    process.exit(1);
  }

  // Pre-create the MCP server (opens KeePass vault once, fail-fast).
  // Each transport session connects its own server instance so sessions are isolated.

  // ── HTTP mode ──────────────────────────────────────────────────────────

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${httpHost}:${httpPort}`);

    try {
      // ── Health endpoint ──
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // ── Streamable HTTP: /mcp (POST, GET, DELETE) ──
      if (url.pathname === '/mcp') {
        await handleStreamableHttp(req, res);
        return;
      }

      // ── Legacy SSE: GET /sse ──
      if (url.pathname === '/sse' && req.method === 'GET') {
        await handleSseConnect(req, res);
        return;
      }

      // ── Legacy SSE: POST /messages ──
      if (url.pathname === '/messages' && req.method === 'POST') {
        await handleSseMessage(req, res, url);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      process.stderr.write(
        `[mikrotik-mcp] Request error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
    }
  });

  httpServer.listen(httpPort, httpHost, () => {
    process.stderr.write(
      `[mikrotik-mcp] Server running on http://${httpHost}:${httpPort}/mcp\n` +
        `[mikrotik-mcp] Legacy SSE available on /sse + /messages\n`,
    );
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    process.stderr.write('[mikrotik-mcp] Shutting down...\n');
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
      } catch {
        /* best effort */
      }
      delete transports[sid];
    }
    process.exit(0);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Streamable HTTP handlers
// ═══════════════════════════════════════════════════════════════════════════

async function handleStreamableHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport | undefined;

  if (sessionId && transports[sessionId]) {
    const existing = transports[sessionId];
    if (!(existing instanceof StreamableHTTPServerTransport)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Session uses a different transport' },
          id: null,
        }),
      );
      return;
    }
    transport = existing;
  } else if (!sessionId && req.method === 'POST') {
    // Must parse body to check if it's an initialize request
    const body = await parseJsonBody(req);
    if (isInitializeRequest(body)) {
      // Bound to a const so the closures below see a non-optional transport.
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          process.stderr.write(`[mikrotik-mcp] StreamableHTTP session: ${sid}\n`);
          transports[sid] = created;
        },
      });
      created.onclose = () => {
        const sid = created.sessionId;
        if (sid) delete transports[sid];
      };
      transport = created;
      const server = await createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session' },
          id: null,
        }),
      );
      return;
    }
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session' },
        id: null,
      }),
    );
    return;
  }

  // For existing sessions, parse body and forward
  const body = await parseJsonBody(req);
  await transport.handleRequest(req, res, body);
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy SSE handlers
// ═══════════════════════════════════════════════════════════════════════════

async function handleSseConnect(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  process.stderr.write(`[mikrotik-mcp] SSE session: ${transport.sessionId}\n`);

  res.on('close', () => {
    delete transports[transport.sessionId];
  });

  const server = await createServer();
  await server.connect(transport);
}

async function handleSseMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId || !transports[sessionId]) {
    res.writeHead(400);
    res.end('Invalid or missing sessionId');
    return;
  }
  const existing = transports[sessionId];
  if (!(existing instanceof SSEServerTransport)) {
    res.writeHead(400);
    res.end('Session uses a different transport');
    return;
  }
  const body = await parseJsonBody(req);
  await existing.handlePostMessage(req, res, body);
}

// ═══════════════════════════════════════════════════════════════════════════

main().catch((err: unknown) => {
  process.stderr.write(
    `[mikrotik-mcp] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
