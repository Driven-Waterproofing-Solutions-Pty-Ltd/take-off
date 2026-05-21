import { test, expect } from '@playwright/test';

const APP = 'http://127.0.0.1:5173';
const WORKER = 'http://127.0.0.1:8787';
const BOOTSTRAP = 'test-bootstrap';

async function mintToken(): Promise<string> {
  const res = await fetch(`${WORKER}/admin/mcp/tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BOOTSTRAP}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: `e2e-${Date.now()}` }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

test('worker /health is reachable', async () => {
  const res = await fetch(`${WORKER}/health`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test('canvas page loads with no console errors and renders the UI', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Tolerated in Playwright's sandbox / Vite dev — none are app bugs:
      //   - MuPDF warns about node:fs externalisation
      //   - Google Fonts CDN gets a fake cert in the sandbox; we have a
      //     system-sans fallback that renders fine
      //   - "Failed to load resource" wrapper around the same font cert issue
      if (/node:fs|node:module|Module externalized/.test(text)) return;
      if (/Failed to load resource/.test(text)) return;
      if (/fonts\.googleapis\.com/.test(text)) return;
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('requestfailed', (req) => {
    if (/fonts\.googleapis\.com/.test(req.url())) return;
    pageErrors.push(`request failed: ${req.url()} :: ${req.failure()?.errorText}`);
  });

  // Inject the auth token before the app fetches anything.
  const token = await mintToken();
  await page.addInitScript((t) => {
    localStorage.setItem('takeoff_token', t);
  }, token);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });

  // The canvas's initialising loader is on the page until the project manager finishes.
  // Wait until either:
  //   - a loading h2 ("Loading Project…") is gone AND React has mounted, OR
  //   - the body has visible content
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  // Wait until React mounted something into #root.
  await page.waitForFunction(
    () => (document.querySelector('#root')?.children?.length ?? 0) > 0,
    { timeout: 10_000 }
  );
  // And until "Untitled Project" (sidebar title from App.tsx) appears.
  await page.waitForSelector('text=Untitled Project', { timeout: 10_000 });

  // Save a screenshot for the deliverable.
  await page.screenshot({ path: 'e2e-screenshot.png', fullPage: true });

  // Surface any errors we captured.
  if (pageErrors.length) {
    console.error('Uncaught errors:', pageErrors);
  }
  if (consoleErrors.length) {
    console.error('Console errors:', consoleErrors);
  }
  expect(pageErrors, `uncaught errors:\n${pageErrors.join('\n')}`).toHaveLength(0);
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);
});

test('can create project via worker and the listing reflects it', async () => {
  const token = await mintToken();
  const created = await fetch(`${WORKER}/api/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: `Playwright smoke ${Date.now()}` }),
  }).then((r) => r.json() as Promise<{ id: string; name: string }>);

  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

  const list = await fetch(`${WORKER}/api/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json() as Promise<Array<{ id: string }>>);

  expect(list.some((p) => p.id === created.id)).toBe(true);
});
