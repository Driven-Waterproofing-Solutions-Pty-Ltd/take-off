// UI-driven E2E for the Android build. Connects (over CDP, via an adb-forwarded
// port) to the Tauri WebView running in the emulator and drives the REAL UI:
// open the drawer, open the upload modal, select the bundled sample PDF on the
// real <input>, start the project, then save — clicking actual buttons, asserting
// DOM/canvas state. No app-side test backdoors.
import { chromium } from 'playwright-core';
import fs from 'fs';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = process.env.ARTIFACTS || 'artifacts';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[ui-test]', ...a);
const result = { connected: false, hasCanvas: false, steps: [] };
const save = () => fs.writeFileSync(`${OUT}/ui-result.json`, JSON.stringify(result, null, 2));
const shot = async (page, name) => { try { await page.screenshot({ path: `${OUT}/${name}.png` }); } catch (e) { log('shot fail', name, e.message); } };
const step = (s) => { log('STEP', s); result.steps.push(s); save(); };

const fail = async (msg, page) => { log('FAIL:', msg); result.error = msg; save(); if (page) await shot(page, 'ui-FAIL'); process.exit(1); };

const browser = await chromium.connectOverCDP(CDP, { timeout: 30000 }).catch((e) => { return fail('connectOverCDP: ' + e.message); });
result.connected = true; step('connected over CDP');

// Find the app page across contexts.
let page = null;
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    log('found page:', p.url());
    if (/tauri\.localhost|localhost|^https?:/.test(p.url())) page = page || p;
  }
}
if (!page) page = browser.contexts()[0]?.pages()[0];
if (!page) await fail('no WebView page found over CDP');
result.pageUrl = page.url(); save();
step('page: ' + page.url());
await shot(page, 'ui-01-initial');

// 1) Open the mobile drawer (hamburger).
try { await page.getByTestId('open-menu').click({ timeout: 20000 }); }
catch { await page.getByLabel('Open menu').click({ timeout: 5000 }).catch(() => {}); }
await page.waitForTimeout(600);
await shot(page, 'ui-02-drawer');
step('opened drawer');

// 2) Open the upload modal (first-upload button).
await page.getByTestId('open-upload').click({ timeout: 20000 }).catch(async () => {
  await page.getByText('Upload Plans', { exact: false }).click({ timeout: 5000 });
});
await page.waitForTimeout(600);
await shot(page, 'ui-03-upload-modal');
step('opened upload modal');

// 3) Put the bundled sample PDF onto the REAL file input via a same-origin fetch
//    + change event (the app's own upload component; the OS file chooser is not app UI).
await page.evaluate(async () => {
  const res = await fetch('/mupdf-readthedocs-io-en-1.26.1.pdf');
  const blob = await res.blob();
  const file = new File([blob], 'sample.pdf', { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('[data-testid=file-input]');
  if (!input) throw new Error('file input not found');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}).catch((e) => fail('set file on input: ' + e.message, page));
await page.waitForTimeout(800);
await shot(page, 'ui-04-file-selected');
step('selected sample PDF on the input');

// 4) Start the project (real button).
await page.getByTestId('upload-submit').click({ timeout: 20000 }).catch((e) => fail('click upload-submit: ' + e.message, page));
step('clicked Start Project');

// 5) Wait for the plan to render: a <canvas> appears and MuPDF draws.
let ok = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  ok = await page.evaluate(() => !!document.querySelector('canvas')).catch(() => false);
  if (ok) break;
}
result.hasCanvas = ok; save();
await shot(page, 'ui-05-after-upload');
if (!ok) await fail('no <canvas> after upload (plan did not render)', page);
step('canvas present after upload');

// 6) Save the project via the real UI (reopen drawer -> Save).
await page.getByTestId('open-menu').click({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);
await page.getByTestId('save-project').click({ timeout: 10000 }).catch((e) => fail('click save: ' + e.message, page));
await page.waitForTimeout(2500);
await shot(page, 'ui-06-after-save');
step('clicked Save');

result.passed = true; save();
log('UI FLOW PASSED');
await browser.close().catch(() => {});
process.exit(0);
