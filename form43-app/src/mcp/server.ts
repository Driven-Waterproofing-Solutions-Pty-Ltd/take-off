/**
 * MCP Streamable HTTP transport (JSON-RPC 2.0).
 *
 * Implements the minimum surface needed for ChatGPT, Claude.ai, Claude Desktop
 * (via mcp-remote) and aqua to connect to the Worker:
 *   - initialize           → returns protocolVersion + capabilities
 *   - tools/list           → returns the tool catalogue
 *   - tools/call           → dispatches to handlers
 *   - notifications/*      → accepted, no-op
 *
 * Auth: bearerAuth middleware mounted before this router enforces
 * FORM43_API_TOKEN. The transport itself is auth-agnostic.
 */

import { Hono } from 'hono';
import type { AppType } from '../shared/types';
import { TOOLS, dispatchTool } from './tools';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const router = new Hono<AppType>();

router.post('/', async (c) => {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const ctx = { env: c.env, vars: { correlationId: c.get('correlationId'), tokenHash: c.get('tokenHash') } };

  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map((req) => handleRpc(req, ctx)));
    return c.json(responses.filter((r) => r !== null));
  }
  const response = await handleRpc(body, ctx);
  if (response === null) return new Response(null, { status: 204 });
  return c.json(response);
});

// GET /mcp is the server-event stream endpoint. We don't push events
// unsolicited yet, so respond with an empty 200 to satisfy the handshake.
router.get('/', (c) => {
  c.header('Content-Type', 'text/event-stream');
  return c.body('');
});

async function handleRpc(
  req: JsonRpcRequest,
  ctx: { env: import('../env').Env; vars: { correlationId: string; tokenHash: string } },
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: { name: 'form43-app', version: '0.1.0' },
            capabilities: { tools: {} },
          },
        };

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

      case 'tools/call': {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        const name = params?.name;
        if (!name) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
        }
        const result = await dispatchTool(name, params?.arguments ?? {}, ctx);
        return { jsonrpc: '2.0', id, result };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        if (req.method.startsWith('notifications/')) {
          return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
        }
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
  } catch (e: unknown) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: (e as Error).message } };
  }
}

export default router;
