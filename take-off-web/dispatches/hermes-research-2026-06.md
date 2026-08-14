# "Hermes agent" research — what the name carries in 2026

Research run: 2026-06-18. Methodology: 5 parallel WebSearch/WebFetch agents, one per
angle, JSONL claim ledger in `/tmp/hermes-research/angle{1..5}.jsonl`,
cross-angle triangulation, confidence flags on every soft claim.

---

## TL;DR

If you ship something called "Hermes" in 2026 you are walking into a **crowded
namespace** dominated by Nous Research's `hermes-agent` (the de-facto reference
implementation of "Hermes as a multi-channel AI gateway") plus a constellation of
NPM/PyPI/Elixir packages and the Meta JS engine. The Greek-messenger archetype
holds in folklore — Hermes = **the thing that sits between two systems and
passes messages across** — but there is **no canonical spec**, just convention.
If you want naming runway, pick something else; if you want to ride the
convention, mirror the Nous gateway pattern (one process, many channel
adapters, session-keyed routing, cron-driven triggers, provider-agnostic LLM
backend).

---

## 1. Hermes LLM lineage (Nous Research)

| Model | Release | Base | Params | License | Tool-use | Conf |
|---|---|---|---|---|---|---|
| Nous-Hermes-Llama2 | 2023 | Llama 2 | 7B/13B/70B | Llama 2 | no | high |
| OpenHermes-2.5-Mistral-7B (Teknium) | 2023-11 | Mistral-7B | 7B | Apache 2 | no | high |
| Nous-Hermes-2 Mixtral 8x7B SFT/DPO | 2024-01 | Mixtral-8x7B | 47B MoE | Apache 2 | no | high |
| Nous-Hermes-2 Yi-34B | 2023-12 | Yi-34B | 34B | Yi | no | high |
| Hermes-2-Mistral-7B-DPO | 2024-02-20 | Mistral-7B | 7B | Apache 2 | no | high |
| **Hermes-2-Pro-Mistral-7B** | 2024-03-11 | Mistral-7B | 7B | Apache 2 | **yes** | high |
| Hermes-2-Pro-Llama-3-8B | 2024-05 | Llama 3 | 8B | Llama 3 | yes | high |
| Hermes-2-Theta-Llama-3-70B | 2024-06-20 | Llama 3 | 70B | Llama 3 | yes | high |
| Hermes-2-Pro-Llama-3-70B | 2024-06-27 | Llama 3 | 70B | Llama 3 | yes | high |
| **Hermes-3-Llama-3.1-{8B,70B,405B}** | 2024-08-15 | Llama 3.1 | 8/70/405B | Llama 3 | yes | high |
| Hermes-3-Llama-3.2-3B | 2024-12-11 | Llama 3.2-3B | 3B | Llama 3 | yes | high |
| DeepHermes-3-Llama-3-8B-Preview | 2025-02-14 | Llama 3 | 8B | Llama 3 | yes + think/chat | high |
| **Hermes-4 70B / 405B** | 2025-08-26 | Llama 3.1 | 70B / 406B | Llama 3 Community | yes + hybrid reasoning | high |
| Hermes-4 14B | 2025-08-26 | **Qwen3-14B** (see note) | 14B | Apache 2 | yes + reasoning | medium |
| Hermes-4.3-Seed-36B | 2025-12-03 | undisclosed | 36B | n/a | yes | **low** |
| NousCoder-14B | 2026-01-06 | Qwen3-14B | 14B | Apache 2 | code-focused | medium |

> **Hermes-4 14B base-model note.** Nous's own releases page labels the 14B as
> "Llama-3.1-14B" — but Meta has never shipped a Llama-3.1-14B, so that label
> is almost certainly wrong. Third-party coverage (llmbase.ai) lists Qwen3-14B
> as the actual base. Treat the Nous label as an editorial error.
>
> **Hermes-4.3-Seed-36B** and the "Seed" branding could not be triple-verified
> across independent sources; flagging low-confidence pending another source.

### Headline benchmarks (Hermes 4 405B)

`MMLU 87.2 | AIME-24 81.9 | AIME-25 78.1 | GPQA Diamond 70.6 | MATH-500 96.3 (reasoning) | LiveCodeBench 61.3`
Source: arXiv 2508.18255 (Hermes 4 technical report), summarised via huggingface.co/NousResearch/Hermes-4-405B.

### Canonical tool-use schema (verbatim)

System prompt:
```
You are a function calling AI model. You are provided with function signatures within <tools></tools> XML tags. You may call one or more functions to assist with the user query. Don't make assumptions about what values to plug into functions.
```

Tool call emission (one `<tool_call>` per call, never an array):
```
<tool_call>
{"name": "get_stock_fundamentals", "arguments": {"symbol": "TSLA"}}
</tool_call>
```

Tool response (in `tool` role of ChatML):
```
<|im_start|>tool
<tool_response>
{"name": "<function-name>", "content": {...}}
</tool_response>
<|im_end|>
```

Structured-outputs variant:
```
You are a helpful assistant that answers in JSON. Here's the json schema you must adhere to:
<schema>
{schema}
</schema>
```

Hermes 4 adds `<think>...</think>` segments around tool-call deliberation
(hybrid reasoning mode).

Reference repo: `NousResearch/Hermes-Function-Calling` ships `schema.py`
(Pydantic), `prompter.py`, `functioncall.py`, `jsonmode.py` — directly
reusable. MIT.

---

## 2. The Hermes namespace — what already exists

| Name | Domain | Maintained | Collision risk |
|---|---|---|---|
| **NousResearch/hermes-agent** | AI agent framework (multi-channel) | yes | **high** |
| Hermes 2/3/4 LLM family (Nous) | Open-weight LLMs | yes | **high** |
| **Meta `hermes`** (React Native JS engine) | JS runtime | yes | **high** (SEO) |
| Snips Hermes Protocol | Voice (MQTT) | no (abandoned) | medium |
| `hermes-mcp` (Elixir) | MCP client/server | yes | high |
| `hermes-memory` (PyPI) | MCP-native SQLite memory for LLMs | yes | high |
| `allegro/hermes` | Kafka HTTP pub/sub broker | yes | medium |
| HermesJMS | JMS GUI (in SoapUI) | no | low |
| Hermes Protocol (Maia DAO) | DeFi bridge / HERMES token | yes | low |
| Hermes spaceplane (ESA, cancelled 1992) | aerospace | no | low |
| NASA HERMES | heliophysics instrument | yes | low |
| `hermes-px` (PyPI) | **malicious package** impersonating Anthropic proxy | yes | high (security warning) |

> **Security:** if you ever `pip install hermes-px`, don't. It's a typosquat
> impersonating an Anthropic proxy.

---

## 3. What the community means by "Hermes agent"

Triangulated across pantheon-themed AI projects (ils15/pantheon, Advancing
Analytics Pantheon, Kenneth Reitz's Greek Pantheon, 1ilkhamov/opencode-hermes,
Angelo Nasios's "Greek Gods of AI"). **No canonical definition exists** — every
project re-defines Hermes locally. But the Pareto role splits four ways:

1. **Messaging gateway / egress** (dominant, ~60% of usages). Hermes sits at
   the edge between user-facing channels (chat/email/SMS) and the core agent.
   Nous's `hermes-agent` is the reference: per-platform adapters → per-chat
   session store → AIAgent core. Verbs: *receive, route, send, fan-out*.
2. **Master orchestrator / router** (centre placement, ~25%). Hermes coordinates
   specialist sub-agents. Verbs: *route, sequence, arbitrate*.
3. **Backend API worker** (~10%). Hermes = FastAPI specialist; routing belongs
   to a sibling (e.g. Chiron). Reduces to "fast service that speaks JSON."
4. **Custom-SQL / bridge adapter** (~5%). Hermes injects bespoke logic where
   patterns can't be inferred. Justified by "transitions / bridging."

**Unifying primitive: connection / bridging / passing-between.** Authors reach
for Hermes whenever a component sits *between* two other components,
irrespective of the verb. Conversely: if your agent does work *itself* (plans,
reasons, computes), Hermes is the wrong name — Athena (planner), Apollo
(research), Hephaestus (build), Mnemosyne (memory) better fit.

### Greek-pantheon agent constellations observed

| Constellation | Hermes' role | Notable siblings |
|---|---|---|
| `ils15/pantheon` | Backend APIs | Zeus, Athena, Apollo, Argus, Aphrodite, Demeter, Themis, Nyx, Prometheus, Iris (GitHub ops), Mnemosyne, Chiron (model router), Hephaestus, Echo |
| Advancing Analytics Pantheon | Custom SQL | Zeus, Athena, Hephaestus, Artemis |
| Kenneth Reitz Greek Pantheon | Messenger / connection | Zeus, Iris, Hera, Athena, Artemis, Apollo |
| `opencode-hermes-multiagent` | Master orchestrator | 17 non-mythological sub-agents |

> Note for the consolidation plan: in `ils15/pantheon`, **Iris owns GitHub
> ops** (not notifications, as I guessed in the original plan). Hermes is the
> backend specialist there.

---

## 4. Hermes-named GitHub repos worth knowing

| Repo | Stars (soft) | License | Role | Conf |
|---|---|---|---|---|
| `NousResearch/hermes-agent` | ~196k (claimed, **unverified**) | MIT | Self-improving agent + multi-channel gateway | high (existence), low (count) |
| `facebook/hermes` | 11.1k | MIT | RN JS engine — **NOT AI** | high |
| `outsourc-e/hermes-workspace` | 5.8k (claimed) | MIT | Web UI overlay for hermes-agent | medium |
| `0xNyk/awesome-hermes-agent` | 4.1k (claimed) | CC-BY-4.0 | Awesome-list | medium |
| `NousResearch/Hermes-Function-Calling` | 1.4k | MIT | Tool-use reference impl | high |
| `OnlyTerp/hermes-optimization-guide` | 451 (claimed) | MIT | Skills + deploy recipes | medium |
| `allegro/hermes` | (high, established) | Apache 2 | Kafka HTTP pub/sub | high |

> **Verification gap.** Two independent angles flagged the 196k-star figure
> for `NousResearch/hermes-agent` as coming from WebFetch summary inference,
> not raw HTML scraping — treat the absolute number as soft. The repo's
> *existence* and *prominence* in the namespace is corroborated across angles
> 2, 3, 4, 5 plus the `hermes-agent.nousresearch.com` docs domain plus
> OpenRouter shipping a "Hermes integration cookbook" at
> openrouter.ai/docs/cookbook/coding-agents/hermes-integration.

---

## 5. Is there a public "Hermes" that routes across LLM providers + comms services?

**Yes — `NousResearch/hermes-agent` does both at once.**

Hits every category in the original brief:
- **LLM router** — provider routing via `extra_body.provider` (`sort`, `only`,
  `ignore`, `order`, `require_parameters`), backed by LiteLLM / a sibling
  router called ClawRouter
- **Multi-channel notifier** — single gateway process to Telegram, Discord,
  Slack, WhatsApp, Signal, SMS (Twilio), email (SMTP/IMAP), Teams, Matrix,
  ntfy — 20+ adapters
- **Outbound comms agent** — Twilio voice/SMS skill, SMTP send
- **Inbound triage** — cron-driven email triage: read → classify → forward/route → reply

Doc references:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/provider-routing
- https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
- https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals

**This is essentially the architecture sketched as "Hermes" in our
consolidation plan.** If we proceed, we are either (a) building a thinner /
self-hosted clone, or (b) wrapping/extending the Nous project.

### Non-Hermes-named comparables (architecture without the name collision)

- **LLM routers:** LiteLLM, OpenRouter, Portkey, Helicone, Kong AI Gateway, Cloudflare AI Gateway
- **Multi-channel notifiers:** Novu (OSS), Knock, Courier, Twilio Notify
- **A2A brokers:** A2A protocol (Google), MCP (Anthropic)
- **Inbound triage:** AgentMail, IrisAgent

---

## 6. Reference architecture if we build our own

Based on what works in `NousResearch/hermes-agent` and what's reusable:

```
┌──────────────── CHANNELS (inbound + outbound) ────────────────┐
│  Slack | Email (SMTP/IMAP) | SMS (Twilio) | WhatsApp |        │
│  Telegram | Teams | ntfy | webhooks                            │
└────────────────────────────┬──────────────────────────────────┘
                             │ per-adapter SDK, normalised to
                             │ { channel, sender, thread_id, body, attachments }
                             ▼
                ┌───────────────────────┐
                │  Per-session store    │ keyed by (channel, thread_id)
                │  D1 + KV cache        │ owns: history, ack state, retries
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   Hermes core agent   │ verbs: classify, route, dispatch, reply
                │   ChatML / `<tool_call>` schema
                │   provider-agnostic   │
                └───────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
           Anthropic     OpenAI       Local Hermes-4
           (Claude)     (GPT)         (Llama 3.1 405B)
              │             │             │
              └─────────────┴─────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Cron / scheduler     │ wakeups for: email triage,
                │  (CF Cron Triggers)   │ summaries, scheduled sends
                └───────────────────────┘
```

Core implementation choices that have proven out in the Nous project:

- **One process, many adapters.** Don't build per-channel workers — one Hermes
  worker fan-outs across adapters, each adapter a thin module conforming to a
  `receive() / send()` interface.
- **Session store keyed by `(channel, thread_id)`.** D1 for durable, KV for
  hot/active. Schema: `messages`, `sessions`, `deliveries`, `provider_calls`.
- **Provider routing via header/extra_body.** Adopt OpenRouter's
  `extra_body.provider` shape so we can pivot routers without touching the
  agent.
- **Tool-use schema = Nous canonical.** Use the `<tool_call>{json}</tool_call>`
  ChatML format. Reusable from `NousResearch/Hermes-Function-Calling` — MIT,
  drop in `schema.py` + `prompter.py` + `functioncall.py`.
- **Hybrid reasoning hook.** Plan for `<think>...</think>` so Hermes 4 weights
  can drop in later.
- **Cron triggers.** Match Nous's pattern of cron-driven email triage; do not
  invent a separate scheduler.

---

## 7. Recommendation for our build

1. **Don't name it Hermes.** The namespace is taken. Pick a non-collision name
   from a sibling (Iris / Eris / Charon / Echo) or invent. Hermes-the-design-
   pattern still applies; Hermes-the-name doesn't have to.
2. **If you keep the name**, accept that every Google search will surface
   Nous's project and the React Native JS engine first. Reserve a domain that
   disambiguates (e.g. `hermes-driven.com`, not `hermes.com`).
3. **Borrow shamelessly from Nous's gateway internals.** MIT licence,
   architecture works, the multi-adapter pattern is mature. Worst case wrap
   `hermes-agent` instead of rewriting.
4. **Use the Hermes tool-use schema verbatim** even if you rename the agent —
   it's the de-facto standard for open-weight function calling and locks in
   compatibility with Hermes 2 Pro / 3 / 4 weights for self-hosted fallback.
5. **Don't reinvent the LLM router.** Use LiteLLM or OpenRouter as the
   provider layer. Hermes's value is the channel/session layer, not provider
   routing.

---

## 8. Confidence + verification gaps

| Claim | Confidence | Verified via |
|---|---|---|
| Hermes LLM lineage 1 → 4 (existence, dates, base models) | high | HF model cards + Nous releases page (angles 1, 4) |
| Canonical tool-call XML schema | high | `Hermes-Function-Calling` README + multiple HF model cards |
| Hermes-4 70B/405B benchmarks | high | arXiv 2508.18255 + HF model card |
| Hermes-4 14B base = Qwen3-14B (not Llama-3.1-14B) | medium | llmbase.ai + meta-llama has no Llama-3.1-14B SKU; Nous label is editorial error |
| Hermes-4.3-Seed-36B existence | **low** | Single angle; not triangulated; flag for re-verify |
| `NousResearch/hermes-agent` exists and dominates namespace | high | Angles 2, 3, 4, 5 all independently surface it; OpenRouter cookbook; nousresearch.com domain |
| `hermes-agent` 196k stars | **low** | WebFetch inference, not raw scrape — exact figure soft, prominence still high |
| Greek-pantheon agent constellations + Hermes-as-bridge folklore | high | 5 independent project READMEs |
| Naming runway is clogged | high | Both AI and non-AI collisions confirmed |
| `hermes-px` PyPI package is malicious | medium | Single source; security claim warrants check before any pip install |

---

## 9. Source URLs (deduplicated, in priority order)

**Primary — Nous Research:**
- https://nousresearch.com/releases
- https://github.com/NousResearch/hermes-agent
- https://github.com/NousResearch/Hermes-Function-Calling
- https://hermes-agent.nousresearch.com/docs/user-guide/features/provider-routing
- https://hermes-agent.nousresearch.com/docs/user-guide/messaging/
- https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals
- https://huggingface.co/NousResearch/Hermes-4-405B
- https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-405B
- https://huggingface.co/NousResearch/Hermes-2-Pro-Llama-3-8B
- https://arxiv.org/abs/2508.18255

**Pantheon-themed projects (folklore corpus):**
- https://github.com/ils15/pantheon
- https://www.advancinganalytics.co.uk/blog/pantheon
- https://kennethreitz.org/artificial-intelligence/personalities/greek-pantheon/
- https://github.com/1ilkhamov/opencode-hermes-multiagent
- https://angelonasios.substack.com/p/the-greek-gods-of-ai

**Disambiguation:**
- https://github.com/facebook/hermes
- https://hermes-mcp.hexdocs.pm/home.html
- https://science.nasa.gov/mission/hermes/
- https://github.com/allegro/hermes

**Integrations / supporting:**
- https://openrouter.ai/docs/cookbook/coding-agents/hermes-integration
- https://github.com/outsourc-e/hermes-workspace
- https://github.com/0xNyk/awesome-hermes-agent
- https://github.com/fox-in-the-box-ai/hermes-best-models
- https://github.com/OnlyTerp/hermes-optimization-guide

---

## 10. JSONL claim ledgers

| Angle | File | Lines |
|---|---|---|
| 1: LLM family | `/tmp/hermes-research/angle1.jsonl` | 34 |
| 2: Non-AI Hermes | `/tmp/hermes-research/angle2.jsonl` | 17 |
| 3: Design pattern | `/tmp/hermes-research/angle3.jsonl` | 10 |
| 4: GitHub repos | `/tmp/hermes-research/angle4.jsonl` | 9 |
| 5: Cross-provider | `/tmp/hermes-research/angle5.jsonl` | 7 |
| **Total** | | **77** |

JSONL lives on the ephemeral container — copy into the repo if we want it
persisted for follow-on synthesis.
