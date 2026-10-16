/**
 * Single source of truth for MCP tool definitions. Both the remote
 * Streamable HTTP transport (in this Worker) and the stdio adapter
 * (in mcp-stdio/) consume this list.
 *
 * Each tool's handler runs inline (no extra fetch) — the MCP layer
 * shares the Worker's request context for logging and correlationId.
 */

import type { Env, RequestVars } from '../env';
import { handleForm43 } from './handlers/form43';
import { handleAddress } from './handlers/address';
import { handleMemory } from './handlers/memory';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolContext {
  env: Env;
  vars: RequestVars;
}

export type ToolResult =
  | { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
  | { content: Array<{ type: 'text'; text: string }>; isError: true };

export const TOOLS: ToolDef[] = [
  {
    name: 'form43_prefill',
    description:
      'Build a Form 43 (QLD Certificate of Compliance for Waterproofing) prefill payload from a job snapshot. Pass the site address, scope of work, install date, and any other job fields you have. Returns parsed street/suburb/state/postcode/LGA plus default membranes and detected wet areas.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        site_address: { type: 'string', description: 'Full Australian address — Geoscape format ideal, free-form accepted.' },
        scope_of_work: { type: 'string' },
        install_date: { type: 'string', description: 'DD/MM/YYYY or YYYY-MM-DD' },
        builder_name: { type: 'string' },
        lot_number: { type: 'string' },
        purchase_order: { type: 'string' },
        contact_name: { type: 'string' },
        contact_phone: { type: 'string' },
      },
      required: ['site_address'],
    },
  },
  {
    name: 'form43_save',
    description:
      'Persist a completed Form 43 certificate. Two-turn: first call without confirm returns the pending payload; second call with confirm:true commits to the form43_records table. Soft-deletes only (HR-12 spirit).',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean' },
        job_id: { type: 'string' },
        street_address: { type: 'string' },
        suburb: { type: 'string' },
        postcode: { type: 'string' },
        lga: { type: 'string' },
        building_class: { type: 'string' },
        building_desc: { type: 'string' },
        products_used: { type: 'array', items: { type: 'string' } },
        areas_waterproofed: { type: 'array', items: { type: 'string' } },
        certifier_ref: { type: 'string' },
        da_number: { type: 'string' },
        insp_date: { type: 'string' },
        cert_date: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['street_address'],
    },
  },
  {
    name: 'form43_list',
    description: 'List recent active Form 43 records (newest first).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', maximum: 100 } },
    },
  },
  {
    name: 'form43_get',
    description: 'Fetch one Form 43 record by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'form43_delete',
    description: 'Soft-delete a Form 43 record (sets is_active=0). Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'address_autocomplete',
    description:
      'Australian address autocomplete via Geoscape Predictive (G-NAF), the official AU national address dataset. Falls back to OpenStreetMap Nominatim when GEOSCAPE_API_KEY is not configured. Returns ranked candidates with GNAF PID when available.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', maximum: 10 },
        state: { type: 'string', description: 'QLD | NSW | VIC | WA | SA | NT | ACT | TAS' },
      },
      required: ['query'],
    },
  },
  {
    name: 'address_verify',
    description:
      'Verify an Australian address. With a GEOSCAPE_API_KEY, returns the canonical G-NAF record with lat/lng. Without a key, returns the top Nominatim match. LGA filled in for QLD addresses.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        gnaf_pid: { type: 'string' },
      },
    },
  },
  {
    name: 'parse_address',
    description:
      'Offline regex-based Australian address parser. Returns lot, unit, street1, suburb, state, postcode and computed LGA for QLD. No network call — use this for deterministic field splitting when a Geoscape call is overkill.',
    inputSchema: {
      type: 'object',
      properties: { raw: { type: 'string' } },
      required: ['raw'],
    },
  },
  {
    name: 'save_memory',
    description:
      'Persist a fact, preference, decision, or builder note into long-term memory. Embedded into Vectorize (BGE 1024-dim) for semantic recall. Two-turn: pass confirm:true to commit.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        category: { type: 'string', enum: ['PREFERENCE', 'FACT', 'DECISION', 'BUILDER', 'GENERAL'] },
        memory_type: { type: 'string', enum: ['LONG_TERM', 'SHORT_TERM', 'PINNED'] },
        source_session_id: { type: 'string' },
        expires_at: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_memory',
    description: 'Semantic search across memory (Vectorize). Falls back to literal LIKE when embeddings are unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', maximum: 20 },
        semantic: { type: 'boolean', default: true },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_recent_memory',
    description: 'List the most recent active memories, optionally filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', maximum: 50 },
        category: { type: 'string', enum: ['PREFERENCE', 'FACT', 'DECISION', 'BUILDER', 'GENERAL'] },
      },
    },
  },
  {
    name: 'pin_memory',
    description: 'Promote a memory to PINNED (never_expires=1). Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
];

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (name.startsWith('form43_')) return await handleForm43(name, input, ctx);
    if (name === 'address_autocomplete' || name === 'address_verify' || name === 'parse_address') {
      return await handleAddress(name, input, ctx);
    }
    if (name === 'save_memory' || name === 'search_memory' || name === 'list_recent_memory' || name === 'pin_memory') {
      return await handleMemory(name, input, ctx);
    }
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (e: unknown) {
    return { isError: true, content: [{ type: 'text', text: `Tool ${name} failed: ${(e as Error).message}` }] };
  }
}
