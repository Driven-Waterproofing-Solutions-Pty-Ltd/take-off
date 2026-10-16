# Wire Driven Takeoff MCP into Copilot Studio as a Power Apps custom connector

End-to-end click-through. Run once per Power Platform environment. Assumes
the worker is deployed and reachable at the host listed in the YAML.

## Prerequisites

1. The Cloudflare worker is deployed via Workers Builds (see `DEPLOY.md`)
   and the custom domain (`takeoff.drivenwp.com` by default) is bound.
2. `MCP_BOOTSTRAP_TOKEN` secret is set in the Cloudflare dashboard.
3. You can reach `https://<host>/health` and it returns `{"ok":true}`.
4. You're signed into Power Apps and Copilot Studio with the same Microsoft
   365 account, in the environment where you want the connector to live.

## 1. Mint a Copilot-Studio-specific MCP token

One token per connector install. Don't reuse Claude Desktop's token —
revoking one shouldn't kill the other.

```bash
curl -X POST https://<host>/admin/mcp/tokens \
  -H "Authorization: Bearer $MCP_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"copilot-studio"}'
```

Response:
```json
{ "id": "uuid-here", "token": "long-random-string" }
```

Save the `token` — you can't recover it. Server only stores the SHA-256.

## 2. Import the OpenAPI YAML into Power Apps

1. Open <https://make.powerapps.com> and pick the right environment
   (top-right environment selector).
2. Left nav → **More** → **Discover all** → **Custom connectors**.
3. Top-right **+ New custom connector** → **Import an OpenAPI file**.
4. Connector name: `Driven Takeoff MCP`.
5. Upload `copilot-studio-mcp-connector.yaml` from this folder.
6. The wizard lands on **General**. Verify:
   - Scheme: `HTTPS`
   - Host: matches your worker domain
   - Base URL: `/`
7. **Security** step:
   - Authentication type: **API Key**
   - Parameter label: `Bearer token`
   - Parameter name: `Authorization`
   - Parameter location: `Header`
8. **Definition** step — should already show one POST operation:
   - Operation ID: `InvokeMCP`
   - Confirm the **Swagger Editor** shows `x-ms-agentic-protocol: mcp-streamable-1.0` on the POST.
9. Top-right **Create connector**.

## 3. Add the connector to a Copilot Studio agent

1. Open <https://copilotstudio.microsoft.com>, same environment.
2. Open (or create) the agent that should use the takeoff tools.
3. **Tools** tab → **+ Add a tool** → **Model Context Protocol** →
   pick **Driven Takeoff MCP** from the connector list.
4. **Create a new connection** → in the API key prompt paste the entire
   string `Bearer <token-from-step-1>` (yes, including the word "Bearer"
   and a space).
5. **Add to agent**.

Copilot Studio probes `tools/list` immediately. All 14 tools should
populate — set_scale_*, add_area/linear/count/arc, snap_to_vector,
list_items, search_projects, recall_customer, list_assemblies,
apply_assembly, build_quote, push_to_xero.

## 4. Smoke test from the agent chat

In the **Test your agent** pane:

> Search projects for "smith"

The orchestrator should pick `search_projects` and return whatever's in
the memory layer. If you get a 401, the API-key value is missing the
`Bearer ` prefix.

For a full end-to-end run (create project → set scale → add area → quote
→ DRAFT to Xero), follow the same packet documented in
`mcp-live-proof.md` — the conversation prompts work identically through
Copilot Studio because both clients hit the same `/mcp` surface.

## Caveats

- **DLP policies**: Power Platform admins can block custom connectors via
  DLP. If `tools/list` works in the Test pane but throws when published,
  ask the tenant admin to allow this connector in the Business data group
  (or move all required connectors into the same group).
- **Per-user vs shared connection**: by default each Copilot Studio user
  creates their own connection (their own API key). If you want one shared
  key for everyone, build the connector as a [certified][connector-cert]
  or [solution-aware][solution-aware] connector — out of scope here.
- **Token rotation**: revoking the token deletes the `mcp_clients` row
  by hash. The Copilot connection then 401s; users re-enter a new key in
  the connection's edit pane.
- **Blast radius**: this token can `push_to_xero` (DRAFT only — hard-coded
  on the worker side, see `apps/worker/src/tools/xero.ts`). Same risk
  surface as any other MCP client install.

[connector-cert]: https://learn.microsoft.com/connectors/custom-connectors/submit-certification
[solution-aware]: https://learn.microsoft.com/connectors/custom-connectors/customer-managed-keys
