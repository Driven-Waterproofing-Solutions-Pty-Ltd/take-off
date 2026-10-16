#!/usr/bin/env node
/**
 * form43-mcp — stdio MCP adapter
 *
 * Boots an MCP server on stdio (per the @modelcontextprotocol/sdk) and
 * forwards JSON-RPC frames to a remote form43-app Worker over Streamable
 * HTTP. This lets Claude Desktop, mcp-cli, and similar clients drive the
 * cloud Worker without supporting remote MCP natively.
 *
 * Configure via env:
 *   FORM43_BASE_URL   — e.g. https://form43.drivenwp.workers.dev
 *   FORM43_API_TOKEN  — bearer token (same as the Worker's secret)
 *   FORM43_MCP_DEBUG  — optional, set to 1 for stderr logging
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = process.env.FORM43_BASE_URL;
const API_TOKEN = process.env.FORM43_API_TOKEN;
const DEBUG = process.env.FORM43_MCP_DEBUG === '1';

if (!BASE_URL) {
  console.error('FORM43_BASE_URL is required');
  process.exit(1);
}
if (!API_TOKEN) {
  console.error('FORM43_API_TOKEN is required');
  process.exit(1);
}

function debug(...args: unknown[]): void {
  if (DEBUG) console.error('[form43-mcp]', ...args);
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

async function callRemote(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = Math.floor(Math.random() * 1e9);
  const body = { jsonrpc: '2.0', id, method, params };
  debug('->', method, JSON.stringify(params).slice(0, 200));

  const res = await fetch(`${BASE_URL!.replace(/\/$/, '')}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_TOKEN!}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Remote /mcp returned HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as JsonRpcResponse;
  if (json.error) throw new Error(`Remote ${method} error ${json.error.code}: ${json.error.message}`);
  debug('<-', method, 'ok');
  return json.result;
}

const server = new Server(
  { name: 'form43-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = (await callRemote('tools/list')) as { tools: Array<Record<string, unknown>> };
  return { tools: result.tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = (await callRemote('tools/call', {
    name: request.params.name,
    arguments: request.params.arguments ?? {},
  })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return result;
});

const transport = new StdioServerTransport();
await server.connect(transport);
debug('connected stdio transport, base =', BASE_URL);
