# Autonomous Takeoff Agent — Design (Phase E)

Status: design + foundational proxy landed. Orchestrator + review-gate UI
are the remaining build. Nothing here can run until the worker is deployed
and `ANTHROPIC_API_KEY` is set.

## The constraint that decides everything

The Cloudflare Worker **cannot render PDFs**. MuPDF runs as a WASM module in
a browser Web Worker (`apps/web/src/workers/mupdf.worker.ts`); it is not in
the server bundle, and Workers CPU limits make server-side raster rendering a
non-starter. The vector cache the worker stores (`pages.vector_cache_json`)
is *geometry only* — it has no idea which polygon is "the roof".

So any agent that must **identify** elements ("measure the flat roof", "find
the planter") needs to *see* the page. Vision input can only be produced
where the renderer lives: the browser.

### Decision: client-side orchestration, server-side model proxy

```
  Browser (canvas + MuPDF + vector cache + api.ts)
    │
    │  1. captures viewport PNG + vector summary
    │  2. POST /api/ai/turn  { messages, image?, tools }
    ▼
  Worker /api/ai/turn  ──►  Anthropic Messages API
    │  (holds ANTHROPIC_API_KEY, prompt-caches system+tools)
    ▼
  Claude returns text + tool_use blocks
    │
    │  3. browser executes each tool_use against the SAME REST
    │     endpoints the canvas already uses (add_area, snap, …)
    │  4. appends tool_result, loops to step 2
    ▼
  Review gate → user approves → push_to_xero (DRAFT)
```

Why this and not a headless server agent over `/mcp`:

| | Client-side (chosen) | Headless server (MCP) |
|---|---|---|
| Vision (identify elements) | ✅ browser renders | ❌ no renderer |
| Reuses canvas + snap + REST | ✅ all of it | partial |
| User watches it work live | ✅ shapes appear on canvas | ❌ blind |
| Runs unattended / batch | ⚠ tab must be open | ✅ |
| Gives in-app chat panel free | ✅ same proxy | — |

The headless MCP path still exists and is great for *scripted* work ("add a
polygon at these coords, snap, quote") — that's what Claude Desktop / Copilot
Studio drive. But the *autonomous* "do my takeoff" agent is client-side
because it needs eyes.

A future fully-unattended batch mode could add Cloudflare **Browser
Rendering** to give the worker a headless Chromium for the vision turns. Out
of scope now; the client-side agent proves the loop first.

## Components

### 1. Worker: Anthropic proxy — `apps/worker/src/routes/ai.ts`  ✅ landed
- `POST /api/ai/turn` — one model turn. Body: `{ messages, system?, image?, toolNames? }`.
- Holds `ANTHROPIC_API_KEY`; the key never reaches the browser.
- Builds the Anthropic `tools` array from `packages/shared/tool-schemas.ts`
  (one source of truth — same schemas MCP uses), filtered to a
  canvas-relevant allowlist.
- Prompt-caches the system prompt + tool list (`cache_control`) so the
  multi-turn loop is cheap.
- Returns Claude's raw `content` blocks (text + tool_use) + `stop_reason`
  so the browser can run the tool loop.
- `requireAuth` gated; never exposed to MCP.

### 2. Browser: tool executor — `apps/web/src/lib/agentTools.ts`  (next)
- Maps each `tool_use.name` → the matching `api.*` call (the same client
  the canvas uses). `add_area` → `api.shapes.area`, `snap_to_vector` →
  `api.measure.snap`, `build_quote` → `api.quote.build`, etc.
- For `get_page_image`: renders the current page via `mupdfController`,
  downsizes to ≤1568px (Claude's vision sweet spot), returns base64 PNG +
  a compact vector summary (counts + bbox) as the tool_result.
- Returns a structured `tool_result` block the loop feeds back.

### 3. Browser: orchestrator — `apps/web/src/components/AgentPanel.tsx`  (next)
- Takeoff-specific system prompt ("You are a quantity surveyor. Calibrate
  scale first, then measure each element the user named, snapping every
  polygon to vectors. Never push to Xero without explicit approval.").
- Runs the loop: turn → execute tools → turn … until `stop_reason=end_turn`.
- Streams progress into a side panel; shapes land on the canvas live via
  the existing sync hooks (no special-casing — agent writes go through the
  same `api.*` the user's clicks do).
- **Hard review gate**: `push_to_xero` is removed from the agent's tool
  allowlist. When the agent wants to quote, it calls `build_quote` and
  stops; the panel renders the draft and a human clicks "Push DRAFT to
  Xero", which calls the tool directly. The model can never push.

### 4. Cost + safety guards
- Per-run token budget (config in the panel); loop aborts + reports when hit.
- Max tool-iterations cap (e.g. 40) so a confused model can't spin forever.
- Default model: Sonnet 4.6 for measurement turns; escalate to Opus only
  when the user explicitly asks for "deep analysis" of a complex sheet.
- All writes are already idempotent server-side (client-id item creates,
  shape upserts) so a retried turn can't double-create.

## Build order

1. ✅ `routes/ai.ts` proxy + wire into `index.ts` + `ANTHROPIC_API_KEY` already in env.
2. `lib/agentTools.ts` — browser tool executor + `get_page_image` renderer.
3. `components/AgentPanel.tsx` — orchestrator loop + progress UI + review gate.
4. Wire panel into the canvas toolbar (behind a feature flag).
5. Benchmark against the real 15-page plan; tune the system prompt.

## Verification (once deployed + keyed)
- "Calibrate page 1 using the 5m dimension on the south boundary" → page
  calibrated, no clicks.
- "Measure all flat roof sections" → polygons appear, snapped to vectors,
  areas in m².
- "Apply the TPO assembly to the roofs, show me the quote" → line items.
- Review gate appears; human pushes DRAFT to Xero.
- Same plan, repeat via Claude Desktop over /mcp for the *scripted* path —
  confirms the two surfaces share one engine.
