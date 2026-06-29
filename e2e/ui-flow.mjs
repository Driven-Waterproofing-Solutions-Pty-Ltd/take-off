// UI-driven E2E for the Android build. Talks to the Tauri WebView's PAGE-level
// CDP target (Android WebView doesn't support Playwright's browser-level CDP), and
// drives the REAL UI: real .click() on real buttons, a real change event on the
// real file <input>, asserting DOM/canvas state. No app-side test backdoors.
import CDP from 'chrome-remote-interface';
import fs from 'fs';

const PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const HOST = '127.0.0.1';
const OUT = process.env.ARTIFACTS || 'artifacts';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[ui-test]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { connected: false, hasCanvas: false, steps: [] };
const persist = () => fs.writeFileSync(`${OUT}/ui-result.json`, JSON.stringify(result, null, 2));
const step = (s) => { log('STEP', s); result.steps.push(s); persist(); };
const fail = async (msg) => { log('FAIL:', msg); result.error = String(msg); persist(); process.exit(1); };

// Pick the app's page target.
const targets = await CDP.List({ host: HOST, port: PORT }).catch((e) => fail('CDP.List: ' + e.message));
log('targets:', JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url }))));
const pageTarget = targets.find((t) => t.type === 'page' && /tauri\.localhost|localhost|^https?:/.test(t.url)) || targets.find((t) => t.type === 'page');
if (!pageTarget) await fail('no page target over CDP');

// Connect by target id with an explicit IPv4 host so Node doesn't try ::1
// (the WebView's webSocketDebuggerUrl often says "localhost" but adb forward is IPv4).
let client = null;
for (let i = 0; i < 5 && !client; i++) {
  client = await CDP({ host: HOST, port: PORT, local: true, target: pageTarget.id }).catch((e) => { log('connect attempt', i + 1, 'failed:', e.message); return null; });
  if (!client) await sleep(2000);
}
if (!client) await fail('CDP connect failed after retries');
const { Runtime, Page, DOM } = client;
await Runtime.enable();
await Page.enable().catch(() => {});
await DOM.enable().catch(() => {});
result.connected = true; result.pageUrl = pageTarget.url; step('connected to page: ' + pageTarget.url);

const evalJS = async (expression) => {
  const { result: r, exceptionDetails } = await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'eval error');
  return r.value;
};
const shot = async (name) => {
  try { const { data } = await Page.captureScreenshot({ format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64')); }
  catch (e) { log('shot fail', name, e.message); }
};
const waitFor = async (sel, ms = 20000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await evalJS(`!!document.querySelector(${JSON.stringify(sel)})`)) return true;
    await sleep(500);
  }
  throw new Error('element not found: ' + sel);
};
const click = async (sel, ms = 20000) => {
  await waitFor(sel, ms);
  const ok = await evalJS(`(()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true;})()`);
  if (!ok) throw new Error('click failed: ' + sel);
};

try {
  await shot('ui-01-initial');

  // 1) Open the mobile drawer.
  await click('[data-testid=open-menu]');
  await sleep(600); await shot('ui-02-drawer'); step('opened drawer');

  // 2) Open the upload modal.
  await click('[data-testid=open-upload]');
  await sleep(600); await shot('ui-03-upload-modal'); step('opened upload modal');

  // 3) Put the bundled sample PDF onto the real file <input> (same-origin fetch +
  //    change event — exercises the app's upload component; the OS chooser is not app UI).
  await waitFor('[data-testid=file-input]');
  await evalJS(`(async()=>{
    const res = await fetch('/mupdf-readthedocs-io-en-1.26.1.pdf');
    const blob = await res.blob();
    const file = new File([blob], 'sample.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('[data-testid=file-input]');
    if (!input) throw new Error('no file input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(800); await shot('ui-04-file-selected'); step('selected sample PDF on input');

  // 4) Start the project.
  await click('[data-testid=upload-submit]');
  step('clicked Start Project');

  // 5) Wait for the plan to render (a <canvas> appears).
  let ok = false;
  for (let i = 0; i < 30; i++) { await sleep(1000); ok = await evalJS(`!!document.querySelector('canvas')`).catch(() => false); if (ok) break; }
  result.hasCanvas = ok; persist();
  await shot('ui-05-after-upload');
  if (!ok) throw new Error('no <canvas> after upload (plan did not render)');
  step('canvas present after upload');

  // 6) Save via the real UI (reopen drawer -> Save).
  await click('[data-testid=open-menu]').catch(() => {});
  await sleep(500);
  await click('[data-testid=save-project]');
  await sleep(2500); await shot('ui-06-after-save'); step('clicked Save');

  result.passed = true; persist();
  log('UI FLOW PASSED');
  await client.close().catch(() => {});
  process.exit(0);
} catch (e) {
  await shot('ui-FAIL');
  await fail(e.message || e);
}
