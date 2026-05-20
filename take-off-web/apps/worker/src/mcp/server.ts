import type { Env } from '../env';
import { tools, type ToolName } from '@takeoff/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { setScalePreset, setScaleManual } from '../tools/scale';
import { addArea, addLinear, addCount, addArc } from '../tools/measure';
import { snapToVector } from '../tools/snap';
import {
  listItems,
  searchProjects,
  recallCustomer,
  listAssemblies,
  applyAssembly,
  buildQuote,
} from '../tools/memory';
import { pushToXero } from '../tools/xero';
import { sha256Hex } from '../lib/crypto';

type Handler = (env: Env, input: unknown) => Promise<unknown>;

// Only tools that can be fully executed server-side belong on the MCP surface.
// load_pdf and get_page_image are client-driven (browser uploads to R2, MuPDF
// renders the page) and are intentionally hidden from MCP discovery so AI
// clients don't try to invoke unusable contracts.
const MCP_TOOLS: ToolName[] = [
  'set_scale_preset',
  'set_scale_manual',
  'add_area',
  'add_linear',
  'add_count',
  'add_arc',
  'snap_to_vector',
  'list_items',
  'search_projects',
  'recall_customer',
  'list_assemblies',
  'apply_assembly',
  'build_quote',
  'push_to_xero',
];

const handlers: Partial<Record<ToolName, Handler>> = {
  set_scale_preset: (env, i) => setScalePreset(env, i as Parameters<typeof setScalePreset>[1]),
  set_scale_manual: (env, i) => setScaleManual(env, i as Parameters<typeof setScaleManual>[1]),
  add_area: (env, i) => addArea(env, i as Parameters<typeof addArea>[1]),
  add_linear: (env, i) => addLinear(env, i as Parameters<typeof addLinear>[1]),
  add_count: (env, i) => addCount(env, i as Parameters<typeof addCount>[1]),
  add_arc: (env, i) => addArc(env, i as Parameters<typeof addArc>[1]),
  snap_to_vector: (env, i) => snapToVector(env, i as Parameters<typeof snapToVector>[1]),
  list_items: (env, i) => listItems(env, (i as { project_id: string }).project_id),
  search_projects: (env, i) => searchProjects(env, i as Parameters<typeof searchProjects>[1]),
  recall_customer: (env, i) => recallCustomer(env, i as Parameters<typeof recallCustomer>[1]),
  list_assemblies: (env, i) => listAssemblies(env, i as Parameters<typeof listAssemblies>[1]),
  apply_assembly: (env, i) => applyAssembly(env, i as Parameters<typeof applyAssembly>[1]),
  build_quote: (env, i) => buildQuote(env, (i as { project_id: string }).project_id),
  push_to_xero: (env, i) => pushToXero(env, i as Parameters<typeof pushToXero>[1]),
};

async function verifyMcpToken(env: Env, authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length);
  if (env.MCP_BOOTSTRAP_TOKEN && token === env.MCP_BOOTSTRAP_TOKEN) return true;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT id FROM mcp_clients WHERE token_hash = ?')
    .bind(hash)
    .first();
  if (row) {
    await env.DB.prepare('UPDATE mcp_clients SET last_seen_at = ? WHERE id = ?')
      .bind(Date.now(), row.id as string)
      .run();
    return true;
  }
  return false;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result });
}
function jsonRpcError(id: unknown, code: number, message: string, data?: unknown, status = 200) {
  return Response.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } },
    { status }
  );
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (!(await verifyMcpToken(env, request.headers.get('authorization') ?? undefined))) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    // JSON-RPC: -32700 = Parse error
    return jsonRpcError(null, -32700, 'Parse error: invalid JSON', undefined, 400);
  }

  if (body.method === 'initialize') {
    return jsonRpcResult(body.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'takeoff-mcp', version: '0.1.0' },
    });
  }

  if (body.method === 'tools/list') {
    const list = MCP_TOOLS.map((name) => ({
      name,
      description: tools[name].description,
      inputSchema: zodToJsonSchema(tools[name].input, {
        $refStrategy: 'none',
        target: 'jsonSchema7',
      }),
    }));
    return jsonRpcResult(body.id, { tools: list });
  }

  if (body.method === 'tools/call') {
    const params = body.params as { name: ToolName; arguments?: unknown } | undefined;
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (!name || !MCP_TOOLS.includes(name)) {
      return jsonRpcError(body.id, -32601, `Unknown or unavailable tool: ${name}`);
    }
    const handler = handlers[name];
    if (!handler) {
      return jsonRpcError(body.id, -32601, `No handler for tool: ${name}`);
    }
    const schema = tools[name].input;
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return jsonRpcError(body.id, -32602, 'Invalid arguments', parsed.error.flatten());
    }
    try {
      const out = await handler(env, parsed.data);
      return jsonRpcResult(body.id, {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
        isError: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonRpcResult(body.id, {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      });
    }
  }

  return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
}

export async function mintMcpClientToken(
  env: Env,
  bootstrapHeader: string | undefined,
  clientName: string
): Promise<{ id: string; token: string }> {
  if (!env.MCP_BOOTSTRAP_TOKEN || bootstrapHeader !== `Bearer ${env.MCP_BOOTSTRAP_TOKEN}`) {
    throw new Error('forbidden');
  }
  const id = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const hash = await sha256Hex(token);
  await env.DB.prepare(
    'INSERT INTO mcp_clients (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(id, clientName, hash, Date.now())
    .run();
  return { id, token };
}
