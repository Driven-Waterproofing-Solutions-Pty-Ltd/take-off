# Project plan: Total inventory → consolidate → Hermes integration → single cowork session

**Status:** Plan + schema. Not yet executing — see §8 for the blockers I need cleared first.
**Drop target:** This document is the manifest for a new cowork session whose end state is "everything important consolidated, everything else archived, Hermes online."

---

## 0. The end-state I'm targeting

> "Eventually archive everything and just have 1 cowork session open in the app."

Concretely that means:

- **One live cowork session** containing the canonical, current Driven operational state — the active to-do list, the active jobs, the active customer/vendor maps, the active rate cards, the takeoff backlog, the email inbox snapshot, the financial position. Today's reality.
- **All other cowork sessions archived** to cold storage with a manifest (so anything historic is recoverable but doesn't clutter the app).
- **Aqua, take-off, hermes, the Tauri ProTakeoff** all rationalised: which lives, which is archived, which is merged into another.
- **A single source of truth** for the methodology / skill / rate cards / FFE conventions / counting rule (the `takeoff_knowledge` table extended to be the universal Driven knowledge base, not just takeoff).
- **Hermes** integrated as a first-class part of the live session (spec pending — see §5 / §8).

If that target description is wrong, fix it in §0 before I start.

---

## 1. Investigation scope — 5 workstreams

Each workstream is a self-contained "data puller" agent that produces one or more JSONL inventories + sidecar markdown. Pullers do NOT think — they collect. Synthesis happens in §6.

### W1 — Aqua deep audit

| What | How | Output |
|---|---|---|
| CF deployed surface | `workers_list`, `workers_get_worker`, `workers_get_worker_code` (bundle search), `d1_databases_list`, `r2_buckets_list`, `kv_namespaces_list`, hyperdrive configs | `aqua/cf-surface.jsonl` (one row per binding) |
| API routes | grep deployed worker bundle for `app.{get,post,put,delete}\(["'](/api/v1/[^"']*)["']` across `aqua-cron`, `aqua-m365-mcp`, and anything else aqua-prefixed | `aqua/routes.jsonl` |
| D1 schemas | `d1_database_query` `SELECT name, sql FROM sqlite_master WHERE type IN ('table','index')` on every aqua D1 | `aqua/db-schemas.jsonl` |
| Workers Builds health | `workers_builds_list_builds` per worker, full history pagination | `aqua/builds.jsonl` |
| Observability | `query_worker_observability` for last 7d errors per worker | `aqua/errors.jsonl` |
| UI walkthrough | Need the Aqua URL + CF Access creds; walkthrough recorded as a checklist of every page + every flaw | `aqua/ui-walkthrough.md` |
| Open issues | aqua-m365-mcp has 10 builds all failing — root-cause that | `aqua/known-issues.md` |
| Scheduled jobs | `aqua-cron` source already shows 29 scheduled paths — verify each fires, last success time | `aqua/cron-status.jsonl` |

### W2 — GitHub repos (historical + current)

| What | How | Output |
|---|---|---|
| Repo inventory | List every repo Driven owns. **Blocked: my GitHub MCP scope is `driven-waterproofing-solutions-pty-ltd/take-off` only — see §8.** | `github/repos.jsonl` |
| Per-repo commits | All branches, all commits, full history. Author + message + diff stat per commit | `github/commits.jsonl` |
| PRs | All PRs open/merged/closed with title, body, reviews, all comments | `github/prs.jsonl` |
| Issues | All issues with full thread | `github/issues.jsonl` |
| Actions runs | All workflow runs with status + duration + last failure log | `github/actions.jsonl` |
| Secrets / vars | Names only (cannot read values via API) | `github/secrets.jsonl` |
| Repo configs | Branch protection, default branch, settings, codeowners | `github/configs.jsonl` |
| Archive verdict | Per-repo: keep / archive / merge-into-X | `github/triage.jsonl` |

User suggested "Kimi for data pulling not thinking" — that's a fit here. Kimi can paginate GitHub API at scale without burning reasoning tokens. **Not available in this session** — see §3 for the substitute (parallel `Agent` subagents).

### W3 — Local files / build artefacts

| What | How | Output |
|---|---|---|
| Tauri ProTakeoff source | walk `/home/user/take-off/*` excluding `take-off-web/`; sha256 every file; identify any divergence from web port | `local/protakeoff-files.jsonl` |
| take-off-web source | same for `/home/user/take-off/take-off-web/` | `local/web-files.jsonl` |
| Session scratch | `/tmp/takeoff/*` (the Daisy / Allambie / Reuben rasters + crops) | `local/scratch.jsonl` |
| Build outputs | any `dist/` / `target/` / `.output/` | `local/build-artefacts.jsonl` |
| Hidden state | `.claude/` skills, `.github/workflows/`, any `.env*` | `local/hidden.jsonl` |
| Secrets risk | every hardcoded URL / API key / token across all of the above — flagged regardless of repo or `.gitignore` status | `local/secrets-risk.md` ⚠️ priority |

### W4 — Cowork code + Claude session history

| What | How | Output |
|---|---|---|
| Cowork repo | Source, schema, session storage layout, ingestion contract. **Blocked: I don't have repo access.** | `cowork/code.jsonl` |
| Cowork D1/storage | Which CF D1 holds session data? Schema? | `cowork/storage.jsonl` |
| Current sessions | Every session UUID, its input/ and output/ contents, last activity | `cowork/sessions.jsonl` |
| Claude.ai chat transcripts | Every Claude session referenced from cowork plus any standalone ones. **Blocked: no API access to claude.ai transcripts.** | `claude/sessions.jsonl` |
| Session-to-archive verdict | Per-session: live / archive / merge-into-target | `cowork/triage.jsonl` |

### W5 — Hermes scope

| What | How | Output |
|---|---|---|
| What is Hermes | **Blocked: undefined. See §8.** | `hermes/spec.md` |
| Existing code (if any) | repo, last activity, deploy status | `hermes/code.jsonl` |
| Desired endpoints | derived from spec | `hermes/endpoints.jsonl` |
| Integration surface with cowork | how it gets called from the live session | `hermes/integration.md` |

---

## 2. The unified data schema

All five workstreams emit JSONL with shared envelope columns so the synthesiser can join across them:

```json
{
  "workstream": "W1|W2|W3|W4|W5",
  "category": "route|table|file|commit|pr|session|...",
  "id": "<stable identifier>",
  "title": "<human-readable>",
  "path_or_uri": "<where it lives>",
  "metadata": { ... category-specific ... },
  "size_bytes": null,
  "last_modified_at": "<iso8601>",
  "owner": "<github user / worker / db / null>",
  "verdict": "live|archive|merge|delete|unknown",
  "merge_target": null,
  "notes": "...",
  "collected_at": "<iso8601>",
  "collected_by": "<agent id>"
}
```

Each row is uniquely keyed `(workstream, category, id)`. Re-runs are idempotent via upsert. The synthesiser only ever reads the JSONL — never the raw sources — so my main-context budget stays bounded regardless of how much Aqua / Github / cowork there is.

---

## 3. Orchestration topology

User suggested "bulk terminal agents or something, maybe Kimi for data pulling". Translation in this environment:

```
                  ┌──────────────────┐
                  │  Orchestrator    │  ← me, this session, holds plan + synth
                  │  (Claude main)   │
                  └────────┬─────────┘
                           │ spawns Agent calls in parallel
       ┌───────────┬───────┼───────┬───────────┐
       ▼           ▼       ▼       ▼           ▼
   ┌───────┐  ┌────────┐ ┌────┐ ┌──────┐ ┌─────────┐
   │ W1    │  │ W2     │ │ W3 │ │ W4   │ │ W5      │
   │ Aqua  │  │ GitHub │ │Loc │ │Cowork│ │ Hermes  │
   │ puller│  │ puller │ │ pul│ │pullr │ │ scoper  │
   └───┬───┘  └────┬───┘ └─┬──┘ └──┬───┘ └────┬────┘
       │ writes JSONL │      │      │           │
       └──────┬───────┴──────┴──────┴───────────┘
              ▼
       ┌─────────────────┐
       │ /tmp/cowork-    │  ← shared output dir
       │ inventory/*.jsonl
       └────────┬────────┘
                │
                ▼
       ┌──────────────────┐
       │ Synthesiser      │  ← me, second pass: reads JSONL, builds graph,
       │ (Claude main)    │   resolves dedupe + cross-refs + verdicts
       └────────┬─────────┘
                ▼
       ┌──────────────────┐
       │ Drop builder     │  ← me, third pass: produces the cowork session
       │ (Claude main)    │   bundle + archive bundle
       └──────────────────┘
```

**Agent spec per puller** (uniform — only inputs/outputs vary):
- Tool subset: minimum required (W1 needs CF MCP; W2 needs GitHub MCP; W3 needs Read/Glob/Bash; W4 needs Bash + whatever cowork API exists; W5 needs only spec input from user)
- Output format: append JSONL to one well-known path
- Hard rule: NO interpretation, NO archival decisions, NO synthesis. Verdict field stays `unknown` — synthesiser fills it.
- Hard rule: NEVER skim. Paginate all the way. If a list says `total_pages: 13`, the puller fetches all 13.

**True parallel execution** via simultaneous `Agent` tool calls in a single message. 5 pullers run concurrently; the orchestrator waits for all five to come to rest before the synthesiser starts.

**Kimi substitute:** I can spawn `Agent` subagents with `model: haiku` for the dumb pagination work — cheaper, faster, no reasoning needed. The orchestrator + synthesiser stay on the planning model.

---

## 4. Phases + timeline

| # | Phase | Duration | Output | Gates |
|---|---|---|---|---|
| 0 | Define end-state + clear §8 blockers | 1 session of user input | Confirmed §0 + Hermes spec + GitHub scope + cowork storage handle | User input |
| 1 | Inventory (parallel pull, 5 workstreams) | 1–2 days of Agent runs | 5 sets of JSONL in `/tmp/cowork-inventory/` | Phase 0 done |
| 2 | Synthesise — verdicts, dedupe, cross-references | 1 main-session pass | `consolidation-graph.json` + per-area `triage.md` | All five inventories complete |
| 3 | Build the live cowork session bundle | 1 main-session pass | `cowork-live-session/` with input/, output/, manifest.json | Verdicts approved by user |
| 4 | Build the archive bundle | 1 main-session pass | `cowork-archive-<date>.tar.gz` + index | Verdicts approved |
| 5 | Hermes integration | depends on spec | Hermes wired into the live session | Spec confirmed |
| 6 | Migration + cutover | live operation | Cowork in the app shows ONE live session; everything else archived | Phases 3–5 verified |

**Soft commitment:** Phases 0–2 can be done in this session and the next. Phases 3–6 are real work that needs your sign-off at each verdict gate.

---

## 5. The cowork live-session schema

Inferred from what I saw at SharePoint paths like `Documents/Cowork/sessions/<uuid>/input/...` and `output/...`. The live session looks like:

```
cowork/sessions/<live-session-uuid>/
├── manifest.json              ← session metadata, see below
├── README.md                  ← human-readable session purpose
├── input/                     ← canonical inputs
│   ├── jobs/                  ← active builder jobs (1 dir per job)
│   │   └── <job-id>/
│   │       ├── plan.pdf
│   │       ├── ffe.pdf
│   │       └── meta.json
│   ├── customers.jsonl        ← active Xero contacts
│   ├── rate-cards.jsonl       ← current + proposed billing rates
│   ├── cost-recipes.jsonl     ← material draws per assembly
│   ├── takeoff-knowledge.jsonl ← the D1 takeoff_knowledge corpus
│   └── inboxes/               ← active email threads
│       └── <builder>/...
├── output/                    ← live working state
│   ├── takeoffs/              ← in-progress + recent
│   ├── quotes/                ← drafts + pushed
│   ├── invoices/              ← draft + sent
│   ├── certificates/          ← Form 43s
│   └── digests/               ← daily summaries
├── archives/                  ← pointer to cold-storage bundle
│   └── index.json
└── hermes/                    ← Hermes-managed artefacts (§5.1 — pending)
```

### manifest.json

```json
{
  "session_id": "<uuid>",
  "title": "Driven live operations",
  "created_at": "<iso8601>",
  "owner": "office@drivenwp.com",
  "purpose": "Single canonical live session — all other sessions archived",
  "linked_systems": {
    "aqua": "https://aqua.drivenwp.com",
    "takeoff_worker": "https://takeoff-worker.office-351.workers.dev",
    "xero_tenant_id": "<tenant>",
    "hermes": "<url or null>"
  },
  "archive_bundle": {
    "uri": "s3://... or r2://...",
    "manifest": "archives/index.json",
    "session_count": 0,
    "size_bytes": 0
  },
  "knowledge_corpus_d1": "takeoff-production:takeoff_knowledge",
  "agent_entry_points": {
    "takeoff": "https://takeoff-worker.../api/ai/turn",
    "aqua_chat": "https://aqua.../api/v1/chat",
    "hermes": "<pending>"
  }
}
```

### 5.1 Hermes subtree

```
hermes/
├── manifest.json              ← pointer to hermes-db D1 + hermes-blobs R2 + Vectorize index
├── skills-export.jsonl        ← snapshot of active skills (regenerated nightly)
├── user-profile.json          ← snapshot of user_profile_facts for the active user
├── deliveries-last-30d.jsonl  ← outbound message log slice
└── threads-active.jsonl       ← live thread index (for cowork UI)
```

These are projections from the live `hermes-db` D1 into the cowork session,
not authoritative copies. Source of truth stays in D1 / Vectorize / R2.
Cowork session reads these projections for display; writes go back through
the Hermes API.

---

## 6. Synthesis rules (Phase 2 specifics)

**Dedupe:** Two rows match if `path_or_uri` matches OR `(category, content_sha256)` matches. Keep newer; archive older.

**Cross-reference:** Build edges where:
- A commit references a session id → link
- A worker reads a D1 table → link
- A cowork session input file matches a local file by sha256 → link
- A Claude session id appears in a commit message → link

**Verdict assignment heuristic** (synthesiser proposes; user approves before Phase 3 runs):
- `live` — referenced in the last 14 days AND points to a system still deployed
- `archive` — referenced in the last 90 days OR has historical value but no active use
- `merge` — duplicates a `live` item; keep one, archive the other under a redirect
- `delete` — duplicate with no archival value (e.g. transient builds)
- `unknown` — needs human judgment

Anything in `unknown` after auto-assignment goes into a triage queue the user clears once.

---

## 7. Hermes — locked spec

**Definition (user, 2026-06-18):**
> "When I say Hermes I just mean a version of Claude wrapped in my own UI with
> all the tools we've built but constant learning and memory and all the shit
> like aqua has on CF but better. Channels: SMS, M365 / Copilot, email."

So Hermes is **not** Nous Research's Hermes-LLM family — that name shows up in
the research dispatch as prior art only. Hermes here = our internal codename
for "Driven's own Claude". Public branding (if ever) can rename.

### 7.1 Identity stack

| Layer | Choice | Why |
|---|---|---|
| LLM | Anthropic Claude (Opus 4.8 / Sonnet 4.6 router by task) | User asked for Claude specifically. Router lets simple turns use Sonnet, hard turns escalate. |
| Memory | CF Durable Object per user (working) + Vectorize (episodic recall) + D1 (structured events) + R2 (artefact blobs) | "Constant learning" = persistent + searchable across sessions. CF-native to match the "like aqua but better" rule. |
| Skills | Cookbook table in D1: each skill = name, prompt, tool bindings, success metrics; promoted/demoted by usage | Mirrors the Nous hermes-agent skill-creation loop without depending on their codebase. |
| Tool fleet | Every existing Driven tool exposed as MCP server + registered as Claude tool definition | "All the tools we've built." Inventory pass W1/W3 surfaces them; Hermes pulls them all in. |
| UI | Extension of `take-off-web` (existing Next.js / web app already in repo) — NOT a new app | Cheapest path. Reuses auth, layout, deploy pipeline. Hermes becomes a chat surface inside take-off-web. |
| Channels | Twilio (SMS), Microsoft Graph (Outlook email + Teams + Copilot), Outlook calendar — all via existing MCP servers in this session | We already have Twilio MCP + Outlook MCP + Calendar MCP wired up. Adapters are thin. |
| Deploy | CF Workers + Workers AI binding + Durable Objects + Vectorize + D1 + R2 + KV | "On CF but better." Same primitives as aqua, fixed sprawl. |

### 7.2 Cloudflare topology

```
                        ┌─────────────────────────────┐
                        │  hermes.drivenwp.com  (UI)  │
                        │  Workers Static Assets +    │
                        │  take-off-web app shell     │
                        └──────────────┬──────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────┐
                        │  hermes-edge Worker         │
                        │  - session auth (CF Access) │
                        │  - per-user routing         │
                        └──────────────┬──────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
        ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────┐
        │ hermes-core      │  │ HermesUserDO    │  │ hermes-tools     │
        │ Worker           │  │ (Durable Object │  │ Worker           │
        │ - Claude API     │  │  per user)      │  │ - tool dispatch  │
        │   call           │  │ - working ctx   │  │ - MCP fan-out    │
        │ - tool loop      │◄─┤ - identity     ─►│ - takeoff /       │
        │ - skill select   │  │   profile       │  │   aqua / m365 /  │
        │ - memory recall  │  │ - active thread │  │   twilio / etc   │
        └─────┬──────┬─────┘  └─────────────────┘  └──────────────────┘
              │      │
              │      ▼
              │   ┌──────────────────┐
              │   │ Vectorize        │  episodic recall
              │   │ hermes-episodic  │  (past convos, chunked + embedded)
              │   └──────────────────┘
              ▼
        ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
        │ D1: hermes-db    │  │ R2: hermes-blobs │  │ KV: hermes-cache │
        │ - users          │  │ - PDFs, screens, │  │ - session tokens │
        │ - threads        │  │   plans, audio   │  │ - rate limit     │
        │ - messages       │  │ - generated      │  │ - hot facts      │
        │ - skills         │  │   artefacts      │  │                  │
        │ - tool_calls     │  └──────────────────┘  └──────────────────┘
        │ - delivery_log   │
        │ - user_profile   │
        └──────────────────┘
                  ▲
                  │ inbound triggers (cron + webhook)
                  │
        ┌─────────┴────────┐
        │ Channel adapters │ — each a thin Worker / queue consumer
        │ - hermes-sms     │ Twilio webhook → normalise → enqueue to core
        │ - hermes-email   │ M365 Graph subscription → enqueue
        │ - hermes-teams   │ Teams webhook / Copilot bot → enqueue
        │ - hermes-cron    │ scheduled triggers → wake core
        └──────────────────┘
```

### 7.3 D1 schema (initial draft)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,             -- user UUID
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  phone_e164 TEXT,
  m365_upn TEXT,
  created_at INTEGER NOT NULL,
  preferences_json TEXT            -- channel prefs, response style, etc.
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,             -- thread UUID (per channel x conversation)
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,           -- 'web' | 'sms' | 'email' | 'teams' | 'cron'
  external_id TEXT,                -- Twilio convo SID, Outlook conversationId, etc.
  title TEXT,
  state TEXT NOT NULL,             -- 'active' | 'idle' | 'closed'
  last_message_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  role TEXT NOT NULL,              -- 'user' | 'assistant' | 'tool' | 'system'
  content_json TEXT NOT NULL,      -- full structured content (text + tool_use + tool_result blocks)
  tokens_in INTEGER,
  tokens_out INTEGER,
  model TEXT,                      -- which Claude variant served this turn
  created_at INTEGER NOT NULL
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,            -- the skill's playbook
  tool_bindings_json TEXT,         -- which tools this skill expects
  origin TEXT NOT NULL,            -- 'seeded' | 'learned' | 'user-authored'
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE skill_invocations (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  outcome TEXT NOT NULL,           -- 'success' | 'failure' | 'abandoned'
  duration_ms INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  message_id TEXT REFERENCES messages(id),
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,             -- outbound delivery record
  thread_id TEXT NOT NULL REFERENCES threads(id),
  channel TEXT NOT NULL,
  external_id TEXT,                -- Twilio SID, Graph message id, etc.
  status TEXT NOT NULL,            -- 'queued' | 'sent' | 'delivered' | 'failed'
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  sent_at INTEGER,
  delivered_at INTEGER
);

CREATE TABLE user_profile_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fact TEXT NOT NULL,              -- a single fact Hermes has learned
  source_message_id TEXT REFERENCES messages(id),
  confidence REAL NOT NULL,        -- 0.0-1.0
  last_confirmed_at INTEGER,
  superseded_by TEXT,              -- self-ref if updated
  created_at INTEGER NOT NULL
);

CREATE TABLE memory_index (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  chunk TEXT NOT NULL,
  vectorize_id TEXT,               -- pointer into Vectorize index
  created_at INTEGER NOT NULL
);
```

### 7.4 Skill / learning loop

After each turn, Hermes runs a post-turn reflection (cheap Sonnet call):
1. **Did a skill fire?** If yes, record outcome in `skill_invocations`.
2. **Should this turn become a skill?** If the user gave positive signal and
   the work was novel, propose a new skill. Stash as draft in `skills` with
   `origin='learned'`, low confidence. Promotes to active after N successful
   re-uses.
3. **Did we learn a fact about the user?** Append to `user_profile_facts`
   with confidence + source.
4. **Episodic memory:** chunk the turn, embed, push to Vectorize. Index row
   in `memory_index`.

Pre-turn:
1. Hermes recalls top-K episodic chunks from Vectorize for the user query.
2. Loads any candidate skills where `tool_bindings` match the apparent intent.
3. Injects `user_profile_facts` for the active user as a system memo.
4. Calls Claude with the assembled context + the standard tool list.

### 7.5 Tool fleet — sourced from the inventory pass

W1 (Aqua) + W3 (local) outputs feed directly into Hermes's tool registry.
Every aqua-* worker that exposes a useful endpoint becomes a Hermes tool;
every ProTakeoff measurement primitive becomes one too. The inventory's
`category=route` rows are the candidate set.

Bootstrap registration script (Phase 5 of §4) reads
`/tmp/cowork-inventory/aqua/routes.jsonl` and emits Claude tool definitions
matching each useful route. Manual triage filters out the noise.

### 7.6 Channel adapters

| Channel | Inbound | Outbound | Auth |
|---|---|---|---|
| Web (UI) | direct fetch from take-off-web | streaming SSE back | CF Access |
| SMS | Twilio inbound webhook → hermes-sms Worker | Twilio Messages API | Twilio signature verify + CF Access for admin UI |
| Email | M365 Graph change-notification subscription → hermes-email Worker | Graph `sendMail` | M365 app registration (existing in aqua) |
| Teams / Copilot | Teams bot framework webhook OR Copilot agent manifest → hermes-teams Worker | Graph `chats/{id}/messages` | M365 app registration |
| Cron | CF Cron Triggers fire `hermes-cron` Worker | (no outbound, wakes core) | n/a |

### 7.7 Comparison: aqua's existing pattern vs. Hermes's improvements

| Aqua today (observed in inventory pass) | Hermes target |
|---|---|
| Tool sprawl across multiple workers, unclear ownership | Single core + thin channel adapters |
| No first-class memory (no Vectorize, no episodic recall) | Vectorize + Durable Object working memory + episodic |
| Workers Builds failing repeatedly on aqua-m365-mcp | Smaller worker surface, simpler builds, observability gates merges |
| No skill loop — every turn is fresh prompt | Skill creation + promotion loop, learned playbooks compound |
| Aqua-cron has 29 paths with unclear last-success status | All cron triggers logged with deliveries / outcomes in D1 |
| No unified UI | take-off-web becomes Hermes's UI; one URL |
| Hardcoded URLs / secrets risk (flagged in W3) | All secrets via CF Secrets Manager + Wrangler bindings, audited |

### 7.8 Build sequence (replaces old §7 placeholder)

| # | Step | Output | Depends on |
|---|---|---|---|
| H0 | Confirm naming — keep "Hermes" internally, decide public name later | one-liner | user nod |
| H1 | Provision CF resources: `hermes-db` D1, `hermes-blobs` R2, `hermes-cache` KV, `hermes-episodic` Vectorize, `HermesUserDO` Durable Object class | wrangler.toml | inventory pass done (so we know what bindings collide with aqua) |
| H2 | Land D1 schema (§7.3) + seed users row for `office@drivenwp.com` | migration 0001 | H1 |
| H3 | `hermes-core` Worker scaffold: Claude API call + tool loop + memory recall + post-turn reflection | deployable worker | H2 |
| H4 | take-off-web UI shell for Hermes chat (streaming SSE, message list, tool-call display) | UI route `/hermes` | H3 |
| H5 | Tool registry bootstrap from inventory JSONL → Claude tool definitions | tool registration module | W1 + W3 done |
| H6 | SMS adapter (Twilio webhook + send) | `hermes-sms` Worker | H3 |
| H7 | Email adapter (Graph subscription + send) | `hermes-email` Worker | H3 |
| H8 | Teams / Copilot adapter | `hermes-teams` Worker | H3 |
| H9 | Cron adapter — daily digest, email triage, scheduled sends | `hermes-cron` Worker | H3 + H7 |
| H10 | Skill loop hardening — promotion rules, failure handling, user-authored skill UI | code + UI | H3 + observed real-world usage |
| H11 | Cutover: archive aqua's overlap with Hermes; redirect channels from aqua-m365-mcp to hermes-* | cutover plan + DNS / webhook config | H6/H7/H8 + W1 verdicts |

### 7.9 Open questions for §7 only

| # | Question | Default if user doesn't answer | Block? |
|---|---|---|---|
| H-Q1 | Single-tenant (just office@drivenwp.com) or multi-tenant from day 1? | Single-tenant; schema supports multi-tenant later | no |
| H-Q2 | M365 Copilot integration mode — declarative agent (manifest) or full Teams bot? | Teams bot first (simpler); add Copilot manifest later | no |
| H-Q3 | Voice (SMS + Twilio Voice) in scope, or text-only? | Text-only for now | no |
| H-Q4 | Run Hermes-LLM weights as fallback when Anthropic API is down? | No — keep it Claude-only, simpler | no |
| H-Q5 | Memory deletion / right-to-forget UI required? | Yes, build admin endpoint; not blocking H3 | no |
| H-Q6 | Public name when shipped externally? | Decide later, internal codename stays Hermes | no |

None of these block H1–H4. Hermes can start standing up against the current set of defaults.

---

## 8. Blockers — status as of 2026-06-18

| # | Blocker | Status | Detail |
|---|---|---|---|
| 1 | GitHub scope | ⏳ Partial-clear | W2 covers `take-off` (in-scope now) + `aqua` (needs MCP scope expansion in next session — give me the exact repo slug, e.g. `driven-waterproofing-solutions-pty-ltd/aqua`) |
| 2 | Cowork repo location + storage | 🔍 Investigate | First action of W4 = find where cowork lives via CF API + grep. Plan adjusted (§3) so W4 starts with discovery before any inventory |
| 3 | Aqua URL + CF Access creds | ⏳ User sending | Will land via chat. W1's UI section runs once received. |
| 4 | Hermes definition | ✅ Resolved | User clarification 2026-06-18: "version of Claude wrapped in my own UI with all the tools we've built but constant learning and memory and all the shit like aqua has on CF but better — channels: SMS, M365/Copilot, email." Full spec in §7. Public name TBD; internal codename stays Hermes. |
| 5 | Claude.ai session export | ❌ No path | Out of scope unless you export manually (settings → data export) into a readable folder. W4's Claude piece flagged gap-only. |
| 6 | End-state in §0 | ✅ Implicitly confirmed | Proceeding on the §0 description as written |

**Cleared to start now:** W1 CF-bundle audit (no URL needed yet) + W3 local files + W4 cowork discovery. The three can run in parallel.

**Waiting on:** Aqua URL + token (W1 UI), `aqua` repo slug + GitHub scope expansion (W2).

---

## 9. What I commit to once §8 is cleared

- Spawn the 5 parallel pullers in one message (Agent tool, `Explore` subagent type for read-only, `general-purpose` where writes are needed for the cowork/local pullers).
- Land all five JSONL inventories within one main session.
- Produce the synthesised verdict triage + manifest in the next session.
- NO "skimming" — every list paginated end-to-end, every JSONL fully written, every hidden file surfaced. The puller agents have hard rules against summarisation.

---

## 10. Drop format for cowork

This entire document, plus the produced inventories + manifests, gets bundled as:

```
cowork/sessions/<new-uuid>/
├── manifest.json              ← session "Total consolidation 2026-06-18"
├── README.md                  ← same content as §0 + §1
├── input/
│   └── plan/
│       └── cowork-consolidation-plan.md   ← THIS document
├── output/
│   └── (inventories + verdicts land here as Phase 1+2 execute)
└── archives/
    └── (archived sessions land here once Phase 4 executes)
```

Drop the directory into cowork's session store and it's ready to run.
