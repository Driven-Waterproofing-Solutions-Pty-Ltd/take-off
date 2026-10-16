import { test, expect } from '@playwright/test';

// /mcp must only accept per-client tokens minted via /admin/mcp/tokens; the
// bootstrap secret mints those tokens and must not double as a tool bearer.

const WORKER = 'http://127.0.0.1:8787';
const BOOTSTRAP = 'test-bootstrap';

async function mintToken(): Promise<string> {
  const res = await fetch(`${WORKER}/admin/mcp/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOOTSTRAP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `e2e-mcp-auth-${Date.now()}` }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

test('MCP endpoint rejects the bootstrap secret as a bearer token', async () => {
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize' };
  const withBootstrap = await fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOOTSTRAP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(initialize),
  });
  expect(withBootstrap.status).toBe(401);

  const token = await mintToken();
  const withClientToken = await fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(initialize),
  });
  expect(withClientToken.status).toBe(200);
});

test('MCP notifications are acknowledged without a JSON-RPC body', async () => {
  const token = await mintToken();
  const res = await fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  expect(res.status).toBe(202);
  expect(await res.text()).toBe('');
});
