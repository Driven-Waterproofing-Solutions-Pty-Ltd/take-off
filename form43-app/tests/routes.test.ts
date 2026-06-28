import { describe, expect, it, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';

const TOKEN = 'test-token';

async function authedRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${TOKEN}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return SELF.fetch(`http://form43.test${path}`, { ...init, headers });
}

beforeAll(async () => {
  (env as Record<string, string>).FORM43_API_TOKEN = TOKEN;
  (env as Record<string, string>).DISABLE_RATE_LIMIT = '1';

  const migration = `
    CREATE TABLE IF NOT EXISTS form43_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT, street_address TEXT NOT NULL, suburb TEXT, postcode TEXT, lga TEXT,
      building_class TEXT DEFAULT '1a', building_desc TEXT DEFAULT 'New residential dwelling',
      products_used TEXT DEFAULT '[]', areas_waterproofed TEXT DEFAULT '[]',
      certifier_ref TEXT, da_number TEXT, insp_date TEXT, cert_date TEXT, notes TEXT,
      generated_by TEXT DEFAULT 'manual',
      is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, description TEXT NOT NULL,
      resource_id TEXT, correlation_id TEXT, token_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await (env as { FORM43_DB: D1Database }).FORM43_DB.exec(migration.replace(/\s+/g, ' '));
});

describe('auth', () => {
  it('rejects missing bearer', async () => {
    const res = await SELF.fetch('http://form43.test/api/v1/form43/history');
    expect(res.status).toBe(401);
  });
  it('rejects bad bearer', async () => {
    const res = await SELF.fetch('http://form43.test/api/v1/form43/history', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });
  it('allows /health unauthenticated', async () => {
    const res = await SELF.fetch('http://form43.test/health');
    expect(res.status).toBe(200);
  });
});

describe('form43 routes', () => {
  it('serves the standalone HTML at /form43', async () => {
    const res = await SELF.fetch('http://form43.test/form43');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Form 43');
  });

  it('prefills from a job payload', async () => {
    const res = await authedRequest('/api/v1/form43/prefill', {
      method: 'POST',
      body: JSON.stringify({ site_address: 'Lot 42, 25 Cameron Rd, Morayfield QLD 4506', scope_of_work: 'Bathroom and ensuite' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { lga: string; areas: string[] } };
    expect(body.data.lga).toBe('Moreton Bay Regional Council');
    expect(body.data.areas).toEqual(['Bathroom', 'Ensuite']);
  });

  it('saves and reads back a record, then soft-deletes', async () => {
    const save = await authedRequest('/api/v1/form43/save', {
      method: 'POST',
      body: JSON.stringify({
        confirm: true,
        street_address: '25 Cameron Rd',
        suburb: 'Morayfield',
        postcode: '4506',
        lga: 'Moreton Bay Regional Council',
        products_used: ['GCP Silcor 560HB'],
        areas_waterproofed: ['Bathroom'],
      }),
    });
    expect(save.status).toBe(201);
    const { data } = await save.json() as { data: { id: number } };

    const list = await authedRequest('/api/v1/form43/history');
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: Array<{ id: number; street_address: string }> };
    expect(listBody.data.some((r) => r.id === data.id)).toBe(true);

    const del = await authedRequest(`/api/v1/form43/history/${data.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const get = await authedRequest(`/api/v1/form43/history/${data.id}`);
    expect(get.status).toBe(404);
  });

  it('returns 410 on the aqua-era job-data endpoint', async () => {
    const res = await authedRequest('/api/v1/form43/job-data/DW-2026-0001');
    expect(res.status).toBe(410);
  });
});

describe('address routes', () => {
  it('parses an address offline', async () => {
    const res = await authedRequest('/api/v1/address/parse?raw=Lot+42%2C+25+Cameron+Rd%2C+Morayfield+QLD+4506');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { parsed: { lot: string; suburb: string }; lga: string } };
    expect(body.data.parsed.lot).toBe('42');
    expect(body.data.lga).toBe('Moreton Bay Regional Council');
  });
});

describe('mcp transport', () => {
  it('lists tools', async () => {
    const res = await authedRequest('/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('form43_prefill');
    expect(names).toContain('parse_address');
    expect(names).toContain('save_memory');
    expect(names).toContain('form43_pdf');
    expect(names.length).toBe(13);
  });

  it('dispatches parse_address through tools/call', async () => {
    const res = await authedRequest('/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'parse_address', arguments: { raw: '25 Cameron Rd, Morayfield QLD 4506' } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { content: Array<{ text: string }> } };
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.data.parsed.suburb).toBe('Morayfield');
  });

  it('returns pending on first form43_save call (HR-12 two-turn)', async () => {
    const res = await authedRequest('/mcp', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'form43_save', arguments: { street_address: '99 Test St' } },
      }),
    });
    const body = await res.json() as { result: { content: Array<{ text: string }> } };
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.pending).toBe(true);
  });
});
