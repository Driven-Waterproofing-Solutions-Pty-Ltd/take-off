import type { ToolContext, ToolResult } from '../tools';
import { parseAustralianAddress } from '../../shared/address-parse';
import { lookupLGA } from '../../shared/qld-lga';
import { predictiveSearch, verifyByPid } from '../../modules/address/geoscape';
import { osmSearch } from '../../modules/address/osm-nominatim';
import type { AddressCandidate } from '../../shared/types';

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fillLGA(cands: AddressCandidate[]): void {
  for (const c of cands) {
    if (!c.lga && c.state === 'QLD' && c.suburb && c.postcode) c.lga = lookupLGA(c.suburb, c.postcode);
  }
}

export async function handleAddress(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const db = ctx.env.FORM43_DB;
  const apiKey = ctx.env.GEOSCAPE_API_KEY;

  if (name === 'address_autocomplete') {
    const query = String(input.query ?? '').trim();
    if (!query) return jsonResult({ success: false, error: 'Missing query' });
    const limit = Math.min((input.limit as number) ?? 10, 10);
    const state = input.state as string | undefined;

    let candidates: AddressCandidate[];
    let provider: string;
    if (apiKey) {
      candidates = await predictiveSearch(query, apiKey, db, { limit, state });
      provider = 'geoscape_predictive';
    } else {
      candidates = await osmSearch(query, db, limit);
      provider = 'osm';
    }
    fillLGA(candidates);
    return jsonResult({ success: true, data: { provider, query, candidates } });
  }

  if (name === 'address_verify') {
    const address = input.address as string | undefined;
    let pid = input.gnaf_pid as string | undefined;

    if (apiKey) {
      if (!pid && address) {
        const preds = await predictiveSearch(address, apiKey, db, { limit: 1 });
        pid = preds[0]?.id;
      }
      if (!pid) return jsonResult({ success: false, error: 'No GNAF match' });
      const cand = await verifyByPid(pid, apiKey, db);
      if (!cand) return jsonResult({ success: false, error: 'GNAF PID not found' });
      fillLGA([cand]);
      return jsonResult({ success: true, data: { provider: 'geoscape_verify', candidates: [cand] } });
    }

    const cands = await osmSearch(address ?? '', db, 1);
    if (cands.length === 0) return jsonResult({ success: false, error: 'No OSM match' });
    fillLGA(cands);
    return jsonResult({ success: true, data: { provider: 'osm', candidates: cands } });
  }

  if (name === 'parse_address') {
    const raw = String(input.raw ?? '').trim();
    if (!raw) return jsonResult({ success: false, error: 'Missing raw' });
    const parsed = parseAustralianAddress(raw);
    const lga = parsed.state === 'QLD' ? lookupLGA(parsed.suburb, parsed.postcode) : '';
    return jsonResult({ success: true, data: { parsed, lga } });
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown address tool: ${name}` }] };
}
