# Form 43 Agent SDK — Build Handoff

> Hand this whole file to a fresh Claude Code / desktop session. It contains
> everything needed to build a small TypeScript SDK that connects to the
> deployed **form43-app** MCP server (13 tools + self-contained memory) and
> drives it with an LLM. All code below is verbatim and uses current APIs —
> copy it as-is.

---

## 0. The decision: which LLM is the better match?

**Claude (Anthropic) — by a clear margin. Build the primary path on Claude; keep
a provider-portable fallback for OpenAI/Gemini.**

Why Claude wins for *this* target:

1. **MCP is Anthropic's protocol.** The Messages API has a **native remote MCP
   connector** (`mcp_servers` + `mcp_toolset`). You point it at the form43-app
   URL with the bearer and Claude connects server-side and calls all 13 tools
   itself — no client-side tool dispatch, ~20 lines of code. Neither OpenAI nor
   Gemini connects to a remote MCP server this cleanly.
2. **Consistency with aqua.** Aqua's operational default is Claude (its CLAUDE.md
   hard-rule 6), so the Form 43 agent matches the rest of the stack.
3. **Two-turn confirm "just works."** form43-app's write tools (`*_save`,
   `*_delete`, `*_pin`) return a `pending` payload on the first call and commit
   on the second with `confirm:true`. Claude reads the pending hint and
   re-calls with `confirm:true` on its own.

**OpenAI** is a fine fallback — its Responses API also supports remote MCP — and
**Gemini** works via function-calling but is the weakest MCP match. The
fallback path below is written so the *same* MCP client drives any of the three.

**Model:** default to `claude-opus-4-8`. Drop to `claude-sonnet-4-6` only if the
user asks for lower cost. (These are current IDs — do not append date suffixes.)

---

## 1. What you're connecting to

| Thing | Value |
|---|---|
| MCP endpoint | `https://form43-app.office-351.workers.dev/mcp` (Streamable HTTP, JSON-RPC 2.0) |
| Auth | `Authorization: Bearer <FORM43_API_TOKEN>` |
| Tool count | **13** — see groups below |
| Health (no auth) | `https://form43-app.office-351.workers.dev/health` |

Tool groups (names the agent will call):
- **Form 43:** `form43_prefill`, `form43_pdf`, `form43_save`, `form43_list`, `form43_get`, `form43_delete`
- **Address:** `address_autocomplete`, `address_verify`, `parse_address`
- **Memory:** `save_memory`, `search_memory`, `list_recent_memory`, `pin_memory`

Write tools (`form43_save`, `form43_delete`, `save_memory`, `pin_memory`) use the
**two-turn confirm** pattern — pass `confirm: true` to commit. `form43_pdf`
returns the official QBCC PDF base64-encoded.

---

## 2. Project scaffold

```
form43-agent-sdk/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── mcp-client.ts      # JSON-RPC client for the remote MCP server
│   ├── agent-claude.ts    # PRIMARY: Claude native MCP connector (~20 lines)
│   ├── agent-manual.ts    # FALLBACK: manual tool loop, portable to OpenAI/Gemini
│   └── index.ts           # public API + tiny CLI
└── README.md
```

### `package.json`

```json
{
  "name": "form43-agent-sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "form43-agent": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.69.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

> Add `"openai": "^4.0.0"` only if you wire the OpenAI fallback. Gemini:
> `"@google/generative-ai"`.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

### `.env.example`

```bash
ANTHROPIC_API_KEY=sk-ant-...
FORM43_MCP_URL=https://form43-app.office-351.workers.dev/mcp
FORM43_API_TOKEN=...        # the bearer for form43-app (sent separately)
# Optional fallbacks:
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=...
```

---

## 3. `src/mcp-client.ts` — the MCP JSON-RPC client

Used by the manual/portable path (the native Claude connector doesn't need it).

```ts
// Minimal Streamable-HTTP MCP client (JSON-RPC 2.0 over a single POST).
// form43-app returns application/json for POST /mcp.

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class McpClient {
  private id = 0;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (json.error) throw new Error(`MCP ${method} error ${json.error.code}: ${json.error.message}`);
    return json.result as T;
  }

  async listTools(): Promise<McpTool[]> {
    const r = await this.rpc<{ tools: McpTool[] }>("tools/list");
    return r.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return this.rpc<McpToolResult>("tools/call", { name, arguments: args });
  }
}
```

---

## 4. `src/agent-claude.ts` — PRIMARY (Claude native MCP connector)

This is the recommended path. Claude connects to the MCP server itself; you do
**zero** tool dispatch. Uses the beta `mcp-client-2025-11-20` header, prompt
caching on the system prompt, and a `pause_turn` loop for long server-side runs.

```ts
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You are the Form 43 assistant for Driven Waterproofing Solutions.
You help create QLD Form 43 certificates (Certificate of Compliance for
Waterproofing) using the connected form43 tools.

Rules:
- Driven is the COMPETENT PERSON (waterproofing licensee, Licence 15214278) —
  NOT the building certifier. The certifier_ref / insp_date fields belong to the
  EXTERNAL building certifier; leave them blank if unknown, never invent them.
- Normalise site addresses with parse_address or address_verify before saving;
  the LGA is resolved for QLD addresses.
- Use form43_prefill to draft, confirm details with the user, then form43_save.
- Write tools need confirm:true on the second call — call once to preview, then
  again with confirm:true to commit.
- Check search_memory for builder defaults (membranes, preferences) before asking.
- form43_pdf returns the official QBCC certificate PDF (base64).`;

export interface ClaudeAgentOpts {
  apiKey?: string;
  mcpUrl: string;
  mcpToken: string;
  model?: string;
}

export class ClaudeAgent {
  private client: Anthropic;
  private model: string;
  private mcpUrl: string;
  private mcpToken: string;

  constructor(opts: ClaudeAgentOpts) {
    this.client = new Anthropic({ apiKey: opts.apiKey }); // falls back to ANTHROPIC_API_KEY
    this.model = opts.model ?? "claude-opus-4-8";
    this.mcpUrl = opts.mcpUrl;
    this.mcpToken = opts.mcpToken;
  }

  /** Run one user turn to completion; Claude drives the form43 tools itself. */
  async ask(prompt: string): Promise<string> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: prompt },
    ];

    // Server-side tool loops can pause; re-send on pause_turn.
    for (let guard = 0; guard < 10; guard++) {
      const resp = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ["mcp-client-2025-11-20"],
        // Prompt caching: frozen system prompt cached across requests.
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        mcp_servers: [
          { type: "url", url: this.mcpUrl, name: "form43", authorization_token: this.mcpToken },
        ],
        tools: [{ type: "mcp_toolset", mcp_server_name: "form43" }],
        messages,
      });

      if (resp.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: resp.content });
        continue; // server resumes automatically
      }

      // Final turn — collect text blocks.
      return resp.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
    throw new Error("pause_turn loop exceeded");
  }
}
```

**Notes**
- The MCP tools run server-side; results arrive as `mcp_tool_use` /
  `mcp_tool_result` content blocks. You don't dispatch anything.
- The bearer goes in `authorization_token` on the `mcp_servers` entry —
  Anthropic injects it when connecting to form43-app.
- Verify caching with `resp.usage.cache_read_input_tokens` > 0 after the first
  call (the SDK exposes `usage` on the response).
- For multi-turn chat, keep `messages` around between `ask()` calls and append
  each `resp.content` + the next user message.

---

## 5. `src/agent-manual.ts` — FALLBACK (manual loop, provider-portable)

Use this when you want full control, or to run on OpenAI/Gemini. The MCP client
fetches the tool list and executes calls; the only provider-specific piece is
the chat call + tool-schema shape.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { McpClient, type McpTool } from "./mcp-client.js";

const SYSTEM = "You are the Form 43 assistant. Use the form43 tools to help.";

export class ManualClaudeAgent {
  private client: Anthropic;
  private model: string;
  private mcp: McpClient;
  private tools: Anthropic.Tool[] = [];

  constructor(opts: { apiKey?: string; mcpUrl: string; mcpToken: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? "claude-opus-4-8";
    this.mcp = new McpClient(opts.mcpUrl, opts.mcpToken);
  }

  /** Load the MCP tool catalogue once and convert to Claude tool format. */
  async init(): Promise<void> {
    const mcpTools: McpTool[] = await this.mcp.listTools();
    this.tools = mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  async ask(prompt: string): Promise<string> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

    while (true) {
      const resp = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: this.tools,
        messages,
      });

      if (resp.stop_reason !== "tool_use") {
        return resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
      }

      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          const result = await this.mcp.callTool(
            block.name,
            block.input as Record<string, unknown>,
          );
          const text = (result.content ?? []).map((c) => c.text).join("\n");
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: text,
            is_error: result.isError ?? false,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  }
}
```

### Porting the manual loop to OpenAI / Gemini

The MCP client (`listTools` / `callTool`) is provider-agnostic. Only swap the
chat call and the tool-schema mapping:

- **OpenAI (Chat Completions or Responses):** map each MCP tool to
  `{ type: "function", function: { name, description, parameters: inputSchema } }`.
  Loop while the response has `tool_calls`; for each, `mcp.callTool(name, JSON.parse(args))`,
  then append a `{ role: "tool", tool_call_id, content }` message.
  *(OpenAI's Responses API also has a native remote-MCP tool — `{type:"mcp", server_url, headers:{Authorization}}` — which removes the manual dispatch entirely, analogous to the Claude connector.)*
- **Gemini:** map to `functionDeclarations` with `parameters: inputSchema`; loop
  on `functionCall` parts, call `mcp.callTool`, reply with a `functionResponse` part.

Everything else — the MCP client, the confirm-on-write behaviour, the tool
catalogue — is identical across providers.

---

## 6. `src/index.ts` — public API + CLI

```ts
import { ClaudeAgent } from "./agent-claude.js";

const MCP_URL = process.env.FORM43_MCP_URL ?? "https://form43-app.office-351.workers.dev/mcp";
const MCP_TOKEN = process.env.FORM43_API_TOKEN;

if (!MCP_TOKEN) {
  console.error("Set FORM43_API_TOKEN (the form43-app bearer).");
  process.exit(1);
}

export { ClaudeAgent } from "./agent-claude.js";
export { ManualClaudeAgent } from "./agent-manual.js";
export { McpClient } from "./mcp-client.js";

// Tiny CLI: `tsx src/index.ts "make a Form 43 for Lot 1613 65 Bushland Cres Banya QLD 4551"`
if (import.meta.url === `file://${process.argv[1]}`) {
  const prompt = process.argv.slice(2).join(" ") || "List the last 5 saved Form 43 records.";
  const agent = new ClaudeAgent({ mcpUrl: MCP_URL, mcpToken: MCP_TOKEN });
  agent.ask(prompt).then((answer) => console.log(answer)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

---

## 7. Build & run

```bash
cd form43-agent-sdk
npm install
cp .env.example .env      # fill ANTHROPIC_API_KEY + FORM43_API_TOKEN
npm run typecheck

# Native connector (primary):
ANTHROPIC_API_KEY=... FORM43_API_TOKEN=... \
  npx tsx src/index.ts "Prefill a Form 43 for Lot 42, 25 Cameron Rd, Morayfield QLD 4506, bathroom + ensuite"
```

Expected: the agent calls `form43_prefill` (and likely `parse_address`),
resolves the LGA (Moreton Bay Regional Council), and returns a draft. Ask it to
"save it" and it will call `form43_save` twice (preview, then `confirm:true`).

---

## 8. Verification checklist

- [ ] `npm run typecheck` clean
- [ ] `GET /health` returns `{"success":true,...}` (sanity that the server's up)
- [ ] Native agent: "list recent Form 43 records" → returns rows via `form43_list`
- [ ] Native agent: "parse 25 Cameron Rd, Morayfield QLD 4506" → LGA = Moreton Bay
- [ ] Write path: "save this Form 43" → two tool calls (pending → confirm:true)
- [ ] `form43_pdf`: "generate the PDF" → base64 returned; decode and confirm `%PDF`
- [ ] Caching: second `ask()` shows `usage.cache_read_input_tokens > 0`
- [ ] Memory: "remember this builder prefers GCP Silcor 560HB" → `save_memory`;
      then "what membrane does this builder like?" → `search_memory` recalls it

---

## 9. Gotchas (real, will bite)

- **Model IDs are exact** — `claude-opus-4-8`, `claude-sonnet-4-6`. Never append
  a date suffix.
- **Adaptive thinking only** — `thinking: {type:"adaptive"}`. `budget_tokens`
  is removed on Opus 4.8 and returns 400.
- **Don't break the cache** — keep the `SYSTEM` string byte-stable. No
  timestamps/UUIDs in it. Volatile context goes in the user turn.
- **The bearer is the only lock** on form43-app — keep it in env, never commit it.
  Rotate with `wrangler secret put FORM43_API_TOKEN` if it leaks.
- **Native connector requires the server to be publicly reachable** (it is) —
  Anthropic connects to the MCP URL server-side, so localhost won't work for the
  native path; use the manual path against a local form43-app (`npm run local`).
- **Semantic memory has a ~30–60s indexing lag** after a new `save_memory`
  (Vectorize); literal search covers the gap, so don't treat an immediate empty
  semantic result as a failure.

---

## 10. Source pointers (in the take-off repo)

- MCP tool catalogue (authoritative): `form43-app/src/mcp/tools.ts`
- The deployed worker entry: `form43-app/src/index.ts`
- Local (off-cloud) build to test against: `form43-app/local/` (`npm run local`)
- This app's own README: `form43-app/README.md`
```
