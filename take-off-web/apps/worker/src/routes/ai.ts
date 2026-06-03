import { Hono } from 'hono';
import type { Env } from '../env';
import { tools, type ToolName } from '@takeoff/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { requireAuth } from '../lib/auth';

// Anthropic proxy. The browser-side agent (and the in-app chat panel) drive
// the tool-use loop; this endpoint runs a single model turn server-side so
// the API key never reaches the client. The browser executes the returned
// tool_use blocks against the same REST endpoints the canvas uses, then posts
// the next turn with the tool_results appended.
//
// Why a proxy and not the full loop here: the worker can't render PDFs (MuPDF
// is browser-only), so vision turns must originate in the browser. See
// dispatches/takeoff-agent-design.md.

const app = new Hono<{ Bindings: Env; Variables: { auth: { via: string; identity: string } } }>();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

// Tools the agent/chat may call. push_to_xero is deliberately EXCLUDED — the
// model proposes a quote via build_quote and stops; a human pushes the DRAFT
// through the review gate. load_pdf/get_page_image are client-executed (the
// browser renders + uploads), so they're offered to the model but resolved
// browser-side, not server-side.
const AGENT_TOOLS: ToolName[] = [
  'get_page_image',
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
];

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: 'ephemeral' };
}

function buildToolDefs(allow: ToolName[]): AnthropicTool[] {
  const names = allow.filter((n) => n in tools);
  return names.map((name, i) => {
    const schema = zodToJsonSchema(tools[name].input, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name,
      description: tools[name].description,
      input_schema: schema,
      // Cache the whole tool list by marking the final entry — Anthropic
      // caches everything up to and including the breakpoint.
      ...(i === names.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    };
  });
}

interface TurnBody {
  // Anthropic message array — caller owns the running transcript (text +
  // tool_use + tool_result blocks). We don't persist it; the loop is stateless
  // server-side.
  messages: unknown[];
  system?: string;
  model?: string;
  maxTokens?: number;
  // Optional override of the tool allowlist (subset of AGENT_TOOLS). Anything
  // outside AGENT_TOOLS is dropped — the proxy never widens the surface.
  toolNames?: ToolName[];
}

app.use('*', requireAuth);

app.post('/turn', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  const body = await c.req.json<TurnBody>();
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: 'messages[] required' }, 400);
  }

  const allow = (body.toolNames ?? AGENT_TOOLS).filter((n) => AGENT_TOOLS.includes(n));
  const toolDefs = buildToolDefs(allow.length ? allow : AGENT_TOOLS);

  const system = [
    {
      type: 'text',
      text:
        body.system ??
        'You are a quantity-surveyor assistant for a waterproofing contractor. ' +
          'Use the provided tools to measure plans accurately. Always confirm the ' +
          'page scale is calibrated before measuring. Snap every polygon to PDF ' +
          'vectors. Never attempt to send anything to Xero — propose a quote with ' +
          'build_quote and stop for human review.',
      // Cache the system prompt across the multi-turn loop.
      cache_control: { type: 'ephemeral' as const },
    },
  ];

  const payload = {
    model: body.model ?? DEFAULT_MODEL,
    max_tokens: body.maxTokens ?? DEFAULT_MAX_TOKENS,
    system,
    tools: toolDefs,
    messages: body.messages,
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    // Surface Anthropic's status so the browser loop can back off on 429/529.
    return c.json({ error: 'anthropic request failed', status: res.status, detail }, 502);
  }

  const data = (await res.json()) as {
    content: unknown[];
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  // Return exactly what the browser loop needs: the assistant content blocks
  // (text + tool_use), the stop reason, and usage for the cost guard.
  return c.json({
    content: data.content,
    stopReason: data.stop_reason,
    usage: data.usage ?? null,
  });
});

export default app;
